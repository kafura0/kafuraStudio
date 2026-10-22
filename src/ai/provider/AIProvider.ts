import type { AICompletion, AIRequest } from '../types';

export interface AIProvider {
  /** Stable identifier, e.g. 'anthropic'. Not a type. Not an enum. */
  readonly id: string;
  /** Models this provider can serve, for the settings UI. */
  models(): Promise<string[]>;
  complete(request: AIRequest): Promise<AICompletion>;
  /** Whether credentials are configured. Never returns the credential. */
  isConfigured(): boolean;
}
