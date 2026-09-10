import type {
  LlmImageRequest,
  LlmImageResponse,
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

  /**
   * Make a picture.
   *
   * ⚠️ OPTIONAL, AND ABSENT MEANS ABSENT. The Anthropic path is rollback
   * insurance and has no image model at all; giving it a method that throws
   * would put the "can this provider do it" question inside the provider,
   * where LlmService cannot answer it before spending a call. A provider that
   * cannot draw simply does not define this, and the adapter raises
   * `unsupported` with the provider named.
   */
  generateImage?(req: LlmImageRequest): Promise<LlmImageResponse>;

  /** The image model used when a request does not name one. */
  defaultImageModel?(): string;
}
