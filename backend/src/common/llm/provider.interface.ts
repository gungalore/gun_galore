import type {
  LlmProvider,
  LlmRequest,
  LlmResponse,
  LlmStreamEvent,
} from './llm.types';

/**
 * What LlmService needs from a provider, and nothing else.
 *
 * ⚠️ Deliberately NOT in llm.types.ts. That file is the contract the call
 * sites read, and a call site must never see a provider object — if it can
 * reach one it can special-case one, which is the coupling the adapter
 * exists to remove. This interface is internal to this folder.
 *
 * A provider does the mapping and the retrying. The ledger, the logging and
 * the model default all live in LlmService, so a second provider cannot
 * forget them.
 */
export interface LlmProviderClient {
  readonly name: LlmProvider;

  /** A key (and, for Anthropic, a model) is present. */
  isConfigured(): boolean;

  /** The model used when a request does not name one. */
  defaultModel(): string;

  complete(req: LlmRequest): Promise<LlmResponse>;

  stream(req: LlmRequest): AsyncGenerator<LlmStreamEvent>;
}
