# 知账本地语音识别

这是一个常驻的中文语音识别服务，默认使用 FunASR Paraformer-zh（短中文指令速度快、对“你好/测试”等短词更稳定），也保留 faster-whisper 作为兜底。模型权重只保存在 `tools/local-asr/models/`，不会提交到 Git。

## 启动

在 PowerShell 中执行：

```powershell
cd D:\Dev\Projects\Zhizhang\tools\local-asr
.\start.ps1
```

首次启动需要下载依赖和模型，之后模型会常驻内存。健康检查：`http://127.0.0.1:8765/health`。

可通过环境变量切换引擎：

```powershell
$env:ASR_ENGINE = 'paraformer'  # 默认，中文记账指令
$env:ASR_ENGINE = 'sensevoice'  # 需要情绪/多语种时使用
$env:ASR_ENGINE = 'whisper'     # faster-whisper 兜底
```

FunASR 当前默认使用 CPU（`ASR_FUNASR_DEVICE=cpu`），避免没有 CUDA 版 PyTorch 时启动失败；有兼容的 CUDA PyTorch 时可改为 `cuda:0`。

## 接入 Docker 后端

在 `backend/.env` 中增加：

```env
ASR_LOCAL_URL=http://host.docker.internal:8765/transcribe
ASR_TIMEOUT_MS=120000
```

服务默认带有静音能量门控（`ASR_MIN_RMS=0.004`）和二次解码，避免不说话时输出幻觉文本；如果环境特别嘈杂，可适当提高该值。

配置后重启后端容器。`ASR_LOCAL_URL` 优先于外部 `ASR_API_URL`；删除该配置即可恢复原有外部 ASR。

## 停止

```powershell
.\stop.ps1
```

服务只监听 `127.0.0.1`，不会直接暴露到公网。运行产生的 `.venv/` 和 `models/` 均为本机运行文件，已加入忽略规则。
