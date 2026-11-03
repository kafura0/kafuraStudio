import type { AIProvider } from './AIProvider';

const providers = new Map<string, AIProvider>();

export function registerProvider(provider: AIProvider): void {
  providers.set(provider.id, provider);
}

export function getProvider(id: string): AIProvider | undefined {
  return providers.get(id);
}

export function listProviders(): AIProvider[] {
  return Array.from(providers.values());
}

export function clearProviders(): void {
  providers.clear();
}
