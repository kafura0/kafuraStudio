import type { AICompletion, AIRequest } from '../types';
import type { AIProvider } from './AIProvider';

export const nullProvider: AIProvider = {
  id: 'null',
  models: async () => [],
  complete: async (_request: AIRequest): Promise<AICompletion> => ({
    unavailable: true,
    reason: 'not-configured',
    message: 'No AI provider is configured. Add a provider in Settings to enable generation.',
  }),
  isConfigured: () => false,
};
