import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class AsrService {
  private readonly logger = new Logger(AsrService.name);

  /**
   * 转写音频为文字
   *
   * 使用阿里千问 qwen3-asr-flash 模型，通过 OpenAI 兼容的 chat/completions 接口
   * 将音频 base64 作为 input_audio 内容块发送
   */
  async transcribe(audioBase64: string, mimeType: string = 'audio/mp4'): Promise<string> {
    const localUrl = process.env.ASR_LOCAL_URL?.trim();
    const apiUrl = process.env.ASR_API_URL;
    const apiKey = process.env.ASR_API_KEY;
    const model = process.env.ASR_MODEL || 'qwen3-asr-flash';

    if (localUrl) {
      try {
        return await this.transcribeLocal(localUrl, audioBase64, mimeType);
      } catch (error: any) {
        // 本地服务暂时不可用时，若仍配置了外部服务则自动兜底，避免语音记账中断。
        if (!apiUrl || !apiKey) throw error;
        this.logger.warn(`[本地 ASR 不可用] ${error?.message || error}，切换外部 ASR`);
      }
    }

    if (!apiUrl || !apiKey) {
      throw new Error('ASR 服务未配置，请设置 ASR_API_URL 和 ASR_API_KEY 环境变量');
    }

    const startTime = Date.now();
    const buffer = Buffer.from(audioBase64, 'base64');
    this.logger.log(`[ASR 开始] 音频大小: ${(buffer.length / 1024).toFixed(1)}KB, MIME: ${mimeType}, 模型: ${model}`);

    const body = {
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'input_audio',
              input_audio: {
                data: `data:${mimeType};base64,${audioBase64}`,
              },
            },
          ],
        },
      ],
      stream: false,
      asr_options: {
        language: 'zh',
        enable_itn: true,
      },
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const fetchDone = Date.now();
    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`[ASR 失败] ${response.status} 耗时: ${fetchDone - startTime}ms ${errorText}`);
      throw new Error(`语音识别服务返回错误: ${response.status}`);
    }

    const data = await response.json();
    const totalTime = Date.now() - startTime;
    this.logger.debug('ASR API 响应:', JSON.stringify(data));

    const text = data?.choices?.[0]?.message?.content?.trim();
    const usage = data?.usage;
    if (!text) {
      this.logger.warn(`[ASR 无结果] 耗时: ${totalTime}ms，原始响应:`, JSON.stringify(data));
      throw new Error('语音识别未返回结果');
    }

    this.logger.log(
      `[ASR 完成] 耗时: ${totalTime}ms | 结果: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"` +
      (usage ? ` | tokens: ${usage.total_tokens ?? '-'}` : ''),
    );
    return text;
  }

  /**
   * 调用本机常驻的 faster-whisper 服务。
   * 服务只监听本机地址，使用 JSON 传输 Base64，避免后端容器内还要安装音频编解码依赖。
   */
  private async transcribeLocal(localUrl: string, audioBase64: string, mimeType: string): Promise<string> {
    const startTime = Date.now();
    const buffer = Buffer.from(audioBase64, 'base64');
    this.logger.log(`[本地 ASR 开始] 音频大小: ${(buffer.length / 1024).toFixed(1)}KB, MIME: ${mimeType}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(process.env.ASR_TIMEOUT_MS || 120000));
    try {
      const response = await fetch(localUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        this.logger.error(`[本地 ASR 失败] ${response.status} 耗时: ${Date.now() - startTime}ms`);
        throw new Error(payload?.detail || payload?.message || `本地语音识别服务返回错误: ${response.status}`);
      }
      const text = payload?.text || payload?.data?.text || payload?.result?.text;
      if (!text || typeof text !== 'string') {
        throw new Error('本地语音识别未返回结果');
      }
      this.logger.log(`[本地 ASR 完成] 耗时: ${Date.now() - startTime}ms | 结果: "${text.substring(0, 80)}${text.length > 80 ? '...' : ''}"`);
      return text.trim();
    } catch (error: any) {
      if (error?.name === 'AbortError') {
        throw new Error('本地语音识别超时，请稍后重试');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}
