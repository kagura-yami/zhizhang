import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { AIConfigService } from '../ai-config.service';
import {
  AIAdapter,
  ClaudeAdapter,
  OpenAIAdapter,
  DeepSeekAdapter,
  QwenAdapter,
} from '../adapters';
import { RetrospectiveEvidenceService } from './retrospective-evidence.service';
import type { RetrospectiveEvidence } from './retrospective-output';
import { generateBatchedReport } from './retrospective-batches';
import {
  RETROSPECTIVE_PROMPT,
  RETROSPECTIVE_PROMPT_VERSION,
} from './retrospective-output';

@Injectable()
export class RetrospectiveGeneratorService {
  private readonly adapters: Map<string, AIAdapter>;
  constructor(
    private readonly configs: AIConfigService,
    private readonly evidence: RetrospectiveEvidenceService,
    claude: ClaudeAdapter,
    openai: OpenAIAdapter,
    deepseek: DeepSeekAdapter,
    qwen: QwenAdapter,
  ) {
    this.adapters = new Map(
      [claude, openai, deepseek, qwen].map((adapter) => [
        adapter.provider,
        adapter,
      ]),
    );
  }

  /** Internal operation. The report job layer owns persistence/idempotency, never ChatService. */
  async generate(
    userId: string,
    kind: 'day' | 'month',
    period: string,
    configId?: number,
    signal?: AbortSignal,
    onEvidence?: (input: RetrospectiveEvidence) => Promise<void>,
  ) {
    const config =
      configId === undefined
        ? await this.configs.findDefault(userId)
        : await this.configs.findOneDetail(userId, configId);
    if (!config) throw new BadRequestException('请先配置用于复盘的 AI 模型');
    const adapter = this.adapters.get(config.provider);
    if (!adapter) throw new BadRequestException('该模型提供商暂不支持复盘');
    const input = await this.evidence.collect(userId, kind, period);
    if (onEvidence) {
      await onEvidence(input);
      const registered = await this.evidence.collect(userId, kind, period);
      if (registered.inputDigest !== input.inputDigest)
        throw new ConflictException('复盘证据授权已变化，请重试');
    }
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    const timeout = setTimeout(abort, 480000);
    try {
      if (controller.signal.aborted)
        throw new BadGatewayException('复盘生成已取消');
      let calls = 0;
      const generated = await generateBatchedReport(input, async (payload) => {
        if (controller.signal.aborted)
          throw new BadGatewayException('复盘生成超时或已取消，请重试');
        // The job fence is rechecked before EACH remote request, including reduction passes.
        if (onEvidence) await onEvidence(input);
        else if (calls) {
          const latest = await this.evidence.collect(userId, kind, period);
          if (latest.inputDigest !== input.inputDigest)
            throw new ConflictException(
              '复盘期间账单、评价或授权已变化，请重新生成',
            );
        }
        calls++;
        const callController = new AbortController();
        const abortCall = () => callController.abort();
        controller.signal.addEventListener('abort', abortCall, { once: true });
        if (controller.signal.aborted) callController.abort();
        const callTimeout = setTimeout(abortCall, 120000);
        try {
          const response = await adapter.chat(
            [
              { role: 'system', content: RETROSPECTIVE_PROMPT },
              { role: 'user', content: JSON.stringify(payload) },
            ],
            [],
            {
              apiKey: config.apiKey,
              apiBaseUrl: config.apiBaseUrl,
              model: config.model,
              signal: callController.signal,
              redactErrors: true,
            },
          );
          if (
            callController.signal.aborted ||
            response.stopReason !== 'end_turn' ||
            response.toolCalls.length
          ) {
            throw new BadGatewayException('模型未完成有效复盘，请重试');
          }
          return response.content;
        } catch (error) {
          if (error instanceof BadGatewayException) throw error;
          throw new BadGatewayException(
            callController.signal.aborted
              ? '复盘生成超时或已取消，请重试'
              : '模型暂时无法完成复盘，请重试',
          );
        } finally {
          clearTimeout(callTimeout);
          controller.signal.removeEventListener('abort', abortCall);
        }
      });
      // No stale authorization/hidden text may be accepted after an in-flight model response.
      const current = await this.evidence.collect(userId, kind, period);
      if (controller.signal.aborted)
        throw new BadGatewayException('复盘生成超时或已取消，请重试');
      if (current.inputDigest !== input.inputDigest)
        throw new ConflictException(
          '复盘期间账单、评价或授权已变化，请重新生成',
        );
      return {
        ...generated,
        sources: input.sources,
        inputDigest: input.inputDigest,
        capturedAt: input.capturedAt,
        generatedAt: new Date().toISOString(),
        provider: config.provider,
        model: config.model,
        promptVersion: RETROSPECTIVE_PROMPT_VERSION,
        ruleVersion: input.payload.facts.ruleVersion,
      };
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
    }
  }
}
