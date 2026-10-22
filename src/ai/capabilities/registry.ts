import type { AICapability } from '../types';

const capabilities = new Map<string, AICapability>();

export function registerCapability(capability: AICapability): void {
  capabilities.set(capability.id, capability);
}

export function getCapability(id: string): AICapability | undefined {
  return capabilities.get(id);
}

export function listCapabilities(): AICapability[] {
  return Array.from(capabilities.values());
}

export function clearCapabilities(): void {
  capabilities.clear();
}
