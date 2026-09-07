import { Injectable } from '@nestjs/common';
import {
  LlmError,
  type LlmPing,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmStreamEvent,
} from './llm.types';

// ⚠️ STUB. The real adapter (Gemini first, Anthropic behind LLM_PROVIDER for
// rollback, usage ledger, ping) is being written in this same change. This
// file exists so the call sites can be migrated against the interface in
// llm.types.ts before the adapter lands. Every method throws.
@Injectable()
export class LlmService {
  /** Which provider is live, from LLM_PROVIDER (default 'gemini'). */
  get provider(): LlmProvider {
    return process.env.LLM_PROVIDER === 'anthropic' ? 'anthropic' : 'gemini';
  }

  /** The model every call takes unless it overrides. */
  get model(): string {
    return process.env.LLM_MODEL || 'gemini-2.5-flash-lite';
  }

  /** A key is present for the live provider. Call sites gate on this. */
  isConfigured(): boolean {
    return false;
  }

  async complete(_req: LlmRequest): Promise<LlmResponse> {
    throw new LlmError('not_configured', 'LlmService adapter not built yet');
  }

  async *stream(_req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    throw new LlmError('not_configured', 'LlmService adapter not built yet');
  }

  async ping(): Promise<LlmPing> {
    return {
      ok: false,
      provider: this.provider,
      model: this.model,
      error: 'adapter not built yet',
      latencyMs: 0,
    };
  }
}
