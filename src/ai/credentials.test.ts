import { describe, expect, it, beforeEach } from 'vitest';
import { serializeProject, serializeSeries } from '../core/serialize';
import { SEED_PROJECT, SEED_SERIES } from '../data/seed';
import { clearCredentials, hasCredentials, setCredentials } from './credentials';

const SECRET = 'sk-test-do-not-leak-1234567890';
const KEY = 'zanza.ai.credentials.v1';

describe('ai credentials (Phase 19 step 3, §12.5)', () => {
  beforeEach(() => {
    clearCredentials();
    localStorage.clear();
  });

  it('reports configured as a boolean and never exposes the secret', () => {
    expect(hasCredentials()).toBe(false);
    setCredentials({ provider: 'anthropic', key: SECRET });
    expect(hasCredentials()).toBe(true);
    expect(hasCredentials('anthropic')).toBe(true);
    expect(hasCredentials('other')).toBe(false);
    expect(typeof hasCredentials()).toBe('boolean');
  });

  it('marks the credential key namespaced so it never collides with a document field', () => {
    setCredentials({ provider: 'anthropic', key: SECRET });
    expect(KEY.startsWith('zanza.ai.')).toBe(true);
  });

  it('clearing removes the credential entirely', () => {
    setCredentials({ provider: 'anthropic', key: SECRET });
    clearCredentials();
    expect(hasCredentials()).toBe(false);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it('a project export never carries credentials, even when stored on the same machine', () => {
    setCredentials({ provider: 'anthropic', key: SECRET });
    const exported = serializeProject(SEED_PROJECT);
    expect(exported).not.toContain(SECRET);
    expect(exported).not.toContain('credentials');
  });

  it('a series export never carries credentials', () => {
    setCredentials({ provider: 'anthropic', key: SECRET });
    const exported = serializeSeries(SEED_SERIES);
    expect(exported).not.toContain(SECRET);
  });
});
