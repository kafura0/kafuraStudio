/**
 * The AI settings panel (ARCHITECTURE_SPEC.md §24.10, Phase 19 step 8).
 *
 * It is the only place that touches provider credentials in the UI, and it must **never**
 * expose a secret getter: `src/ai/credentials` only offers `hasCredentials`, `setCredentials`,
 * `clearCredentials`. Credentials live in `localStorage` under `zanza.ai.credentials.v1`.
 *
 * This module is imported statically by `App` today? We must check — to satisfy G3 the AI
 * UI must use dynamic imports where reaching into `src/ai/**` from panels that could be
 * tree-shaken or just to be safe. We import `src/ai` dynamically inside handlers.
 */
import { useEffect, useState } from 'react';

type Status = { kind: 'idle' } | { kind: 'saved' } | { kind: 'cleared' } | { kind: 'error'; message: string };

export function SettingsPanel(): React.JSX.Element {
  const [providerId, setProviderId] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const ai = await import('../ai');
        if (cancelled) return;
        setHasKey(ai.hasCredentials(providerId));
      } catch {
        // AI module may be missing in some test contexts; stay idle
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [providerId]);

  const save = async (): Promise<void> => {
    if (apiKey.trim() === '') {
      setStatus({ kind: 'error', message: 'Enter an API key.' });
      return;
    }
    try {
      const ai = await import('../ai');
      ai.setCredentials({ provider: providerId, key: apiKey.trim() });
      setApiKey('');
      setHasKey(true);
      setStatus({ kind: 'saved' });
      setTimeout(() => setStatus({ kind: 'idle' }), 1500);
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to save.' });
    }
  };

  const clear = async (): Promise<void> => {
    try {
      const ai = await import('../ai');
      ai.clearCredentials();
      setHasKey(false);
      setStatus({ kind: 'cleared' });
      setTimeout(() => setStatus({ kind: 'idle' }), 1500);
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Failed to clear.' });
    }
  };

  return (
    <section className="border-b border-ink-800">
      <div className="px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">AI</h2>
      </div>
      <div className="space-y-2 px-3 pb-3">
        <label className="block">
          <div className="mb-1 text-[11px] text-ink-400">Provider</div>
          <select
            className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 text-sm text-ink-200"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="openai">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label className="block">
          <div className="mb-1 text-[11px] text-ink-400">API key</div>
          <input
            type="password"
            autoComplete="off"
            className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-sm text-ink-200"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            placeholder={hasKey ? 'Key saved (enter to replace)' : 'sk-...'}
          />
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save()}
            disabled={apiKey.trim() === ''}
            className="rounded bg-ink-800 px-2 py-1 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-30"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => void clear()}
            disabled={!hasKey}
            className="rounded px-2 py-1 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100 disabled:opacity-30"
          >
            Clear
          </button>
          <span className="text-[11px] text-ink-500">
            {status.kind === 'saved'
              ? 'Saved'
              : status.kind === 'cleared'
                ? 'Cleared'
                : status.kind === 'error'
                  ? status.message
                  : hasKey
                    ? 'Configured'
                    : 'Not configured'}
          </span>
        </div>
        <p className="text-[10px] text-ink-600">Stored in localStorage only. Never exported.</p>
      </div>
    </section>
  );
}
