"""知账本地语音识别服务（Paraformer / SenseVoice / faster-whisper）。"""

from __future__ import annotations

import base64
import re
import os
import sys
import tempfile
from pathlib import Path
from typing import Optional

import av
import numpy as np
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from faster_whisper import WhisperModel

# Windows 下直接用 uvicorn 启动时，PyTorch 的原生 DLL 不一定在 PATH 中；
# 预先加入虚拟环境的 torch/lib，避免 FunASR 导入时出现 DLL load failed。
_torch_lib = Path(sys.prefix) / "Lib" / "site-packages" / "torch" / "lib"
if _torch_lib.exists() and hasattr(os, "add_dll_directory"):
    os.add_dll_directory(str(_torch_lib))
    os.environ["PATH"] = str(_torch_lib) + os.pathsep + os.environ.get("PATH", "")

try:
    from funasr import AutoModel as FunASRAutoModel
except ImportError:  # FunASR 是可选引擎，Whisper 仍可独立运行
    FunASRAutoModel = None


ASR_ENGINE = os.getenv("ASR_ENGINE", "paraformer").lower()
MODEL_NAME = os.getenv("ASR_MODEL_NAME", "medium")
MODEL_DIR = Path(os.getenv("ASR_MODEL_DIR", Path(__file__).resolve().parent / "models"))
DEVICE = os.getenv("ASR_DEVICE", "cuda")
COMPUTE_TYPE = os.getenv("ASR_COMPUTE_TYPE", "float16" if DEVICE == "cuda" else "int8")

app = FastAPI(title="Zhizhang Local ASR", version="1.0.0")
model: Optional[object] = None
active_engine = ASR_ENGINE
active_device = DEVICE


class TranscribeRequest(BaseModel):
    audioBase64: str = Field(min_length=1)
    mimeType: str = "audio/mp4"


@app.on_event("startup")
def load_model() -> None:
    global model, active_engine, active_device
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    if ASR_ENGINE in {"paraformer", "sensevoice"} and FunASRAutoModel is not None:
        try:
            model_id = os.getenv(
                "ASR_FUNASR_MODEL",
                "damo/speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch"
                if ASR_ENGINE == "paraformer"
                else "iic/SenseVoiceSmall",
            )
            # 已下载的 ModelScope 权重优先使用本地目录；不存在时由 FunASR 自动下载。
            local_candidates = {
                "paraformer": MODEL_DIR / "damo" / "speech_paraformer-large_asr_nat-zh-cn-16k-common-vocab8404-pytorch",
                "sensevoice": MODEL_DIR / "iic" / "SenseVoiceSmall",
            }
            local_model = local_candidates[ASR_ENGINE]
            model_path = str(local_model) if (local_model / "model.pt").exists() else model_id
            funasr_device = os.getenv("ASR_FUNASR_DEVICE", "cuda:0" if DEVICE == "cuda" else "cpu")
            kwargs: dict[str, object] = {"model": model_path, "device": funasr_device, "disable_update": True}
            if ASR_ENGINE == "sensevoice":
                kwargs.update({"trust_remote_code": True})
            model = FunASRAutoModel(**kwargs)
            active_engine = ASR_ENGINE
            active_device = funasr_device
            return
        except Exception as exc:  # noqa: BLE001 - 本地模型不可用时自动回退 Whisper
            print(f"FunASR 引擎 {ASR_ENGINE} 加载失败，回退 faster-whisper: {exc}")

    # faster-whisper 会把 Hugging Face 权重缓存到指定目录，模型只在本机保存。
    model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE_TYPE, download_root=str(MODEL_DIR))
    active_engine = "whisper"
    active_device = DEVICE


@app.get("/health")
def health() -> dict[str, str]:
    model_name = MODEL_NAME if active_engine == "whisper" else os.getenv("ASR_FUNASR_MODEL", active_engine)
    return {"status": "ok", "engine": active_engine, "model": model_name, "device": active_device}


@app.post("/transcribe")
def transcribe(request: TranscribeRequest) -> dict[str, object]:
    if model is None:
        raise HTTPException(status_code=503, detail="语音识别模型尚未加载")

    try:
        audio = base64.b64decode(request.audioBase64, validate=True)
    except (ValueError, base64.binascii.Error) as exc:
        raise HTTPException(status_code=400, detail="音频 Base64 数据无效") from exc
    if not audio:
        raise HTTPException(status_code=400, detail="音频数据为空")

    # 使用临时文件交给 ffmpeg 解码 m4a/aac 等手机录音格式。
    suffix = ".m4a"
    if "/" in request.mimeType:
        ext = request.mimeType.split("/", 1)[1].split(";", 1)[0].strip().lower()
        suffix = {"aac": ".aac", "mpeg": ".mp3", "mp3": ".mp3", "wav": ".wav", "ogg": ".ogg", "webm": ".webm"}.get(ext, ".m4a")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as handle:
        handle.write(audio)
        path = handle.name

    try:
        audio_samples, duration, raw_rms = decode_and_normalize_audio(path)
        # 先拦截纯静音/录音空帧，避免 Whisper 对无声输入产生固定幻觉文本。
        if raw_rms < float(os.getenv("ASR_MIN_RMS", "0.004")):
            raise HTTPException(status_code=422, detail="未检测到有效语音")

        if active_engine in {"paraformer", "sensevoice"}:
            text = transcribe_funasr(audio_samples)
            if not text:
                raise HTTPException(status_code=422, detail="未识别到语音内容")
            return {"text": text, "language": "zh", "duration": duration}

        text, score, info, _ = transcribe_candidate(audio_samples, use_vad=True)
        # 两字短句最容易被 Whisper 混淆；再跑一次不裁剪 VAD 的候选，避免句首/句尾被切掉。
        if (len(text) <= 2 or score < -0.55) and not (not text and raw_rms < 0.012):
            retry_text, retry_score, retry_info, _ = transcribe_candidate(audio_samples, use_vad=False)
            if retry_score > score or not text:
                text, score, info = retry_text, retry_score, retry_info
        if not text:
            raise HTTPException(status_code=422, detail="未识别到语音内容")
        return {"text": text, "language": info.language, "duration": duration or info.duration}
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def transcribe_candidate(audio_samples: np.ndarray, use_vad: bool):
    """运行一轮解码并返回文本、平均置信度和识别信息。"""
    options = {
        "language": "zh",
        "task": "transcribe",
        "beam_size": 8 if not use_vad else 5,
        # 不设置 initial_prompt，避免短句复述业务提示词。
        "condition_on_previous_text": False,
        "temperature": 0.0,
        "no_speech_threshold": 0.45,
        "log_prob_threshold": -1.0,
        "compression_ratio_threshold": 2.4,
        "vad_filter": use_vad,
    }
    if use_vad:
        options["vad_parameters"] = {
            "threshold": 0.25,
            "min_speech_duration_ms": 80,
            "min_silence_duration_ms": 700,
            "speech_pad_ms": 450,
        }
    segments, info = model.transcribe(audio_samples, **options)
    items = list(segments)
    text = "".join(segment.text for segment in items).strip()
    scores = [float(segment.avg_logprob) for segment in items if segment.avg_logprob is not None]
    score = sum(scores) / len(scores) if scores else -10.0
    no_speech = [float(segment.no_speech_prob) for segment in items if segment.no_speech_prob is not None]
    no_speech_score = sum(no_speech) / len(no_speech) if no_speech else 1.0
    # VAD 仍可能因环境底噪产出片段；高无语音概率时丢弃该轮结果。
    if use_vad and no_speech_score >= 0.72:
        text = ""
        score = -10.0
    return text, score, info, no_speech_score


def transcribe_funasr(audio_samples: np.ndarray) -> str:
    """调用中文 FunASR，并统一清理 SenseVoice 的控制标签。"""
    if model is None:
        return ""
    if active_engine == "sensevoice":
        result = model.generate(input=audio_samples, fs=16000, language="zh", use_itn=True)
    else:
        result = model.generate(input=audio_samples, fs=16000)
    if not result:
        return ""
    text = str(result[0].get("text", ""))
    # SenseVoice 输出 <|zh|><|Speech|> 等标签，不能直接展示给用户。
    text = re.sub(r"<\|[^|]+\|>", "", text)
    return re.sub(r"\s+", "", text).strip(" ，。！？,.!? ")


def decode_and_normalize_audio(path: str) -> tuple[np.ndarray, float, float]:
    """解码手机录音并做轻量响度修复，避免轻声和句首句尾被截断。"""
    frames: list[np.ndarray] = []
    sample_rate = 16000
    with av.open(path) as container:
        stream = container.streams.audio[0]
        source_rate = int(stream.rate or 44100)
        resampler = av.audio.resampler.AudioResampler(
            format="fltp",
            layout="mono",
            rate=sample_rate,
        )
        for frame in container.decode(stream):
            for converted in resampler.resample(frame):
                array = converted.to_ndarray()
                frames.append(np.asarray(array, dtype=np.float32).reshape(-1))

    if not frames:
        raise HTTPException(status_code=422, detail="音频没有可解码的内容")

    audio = np.concatenate(frames)
    # 录音端可能返回很低的幅度；只对低响度音频增益，避免正常录音过度放大噪声。
    rms = float(np.sqrt(np.mean(np.square(audio))))
    raw_rms = rms
    peak = float(np.max(np.abs(audio)))
    if rms > 0.0005 and rms < 0.08:
        gain = min(8.0, 0.08 / rms)
        audio = audio * gain
    if peak > 0.95:
        audio = audio / peak * 0.95

    # 预留 350ms 首尾上下文，降低 VAD 对轻声起始和收尾的截断。
    padding = np.zeros(int(sample_rate * 0.35), dtype=np.float32)
    audio = np.concatenate((padding, np.clip(audio, -1.0, 1.0), padding))
    return audio, len(audio) / sample_rate, raw_rms
