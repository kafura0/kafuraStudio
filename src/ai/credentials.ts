/**
 * Credentials adapter (ARCHITECTURE_SPEC.md §12.5, Phase 19 step 3).
 *
 * Credentials live in localStorage under a namespaced key, or in the OS keychain if one
 * is available. Never in a document, never in a SeriesDef, never in a Project, never in
 * an exported file. `isConfigured()` reports a boolean. There is no accessor that returns
 * the secret to application code.
 */

const KEY = 'zanza.ai.credentials.v1';

export interface StoredCredentials {
  provider: string;
  key: string;
  model?: string;
}

function canUseStorage(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    const test = '__zanza_ai_test__';
    localStorage.setItem(test, test);
    localStorage.removeItem(test);
    return true;
  } catch {
    return false;
  }
}

export function hasCredentials(provider?: string): boolean {
  if (!canUseStorage()) return false;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Partial<StoredCredentials>;
    if (provider) return parsed.provider === provider && typeof parsed.key === 'string' && parsed.key.length > 0;
    return typeof parsed.key === 'string' && parsed.key.length > 0;
  } catch {
    return false;
  }
}

export function clearCredentials(): void {
  if (!canUseStorage()) return;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

/**
 * Set credentials. Never logged. Never serialized into project/series/export.
 */
export function setCredentials(creds: StoredCredentials): void {
  if (!canUseStorage()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ provider: creds.provider, key: creds.key, model: creds.model }));
  } catch {
    // ignore
  }
}
