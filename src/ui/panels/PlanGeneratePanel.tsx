/**
 * The Generate affordance (ARCHITECTURE_SPEC.md §24.10, Phase 19 step 5).
 *
 * This is the only UI surface that reaches `src/ai/**`, and it does so through a **dynamic
 * import inside an event handler** — never a static import. That is what makes gate G3
 * true: deleting `src/ai/**` removes every AI code path from the build and leaves every
 * other test passing, because nothing statically depends on the module.
 *
 * The default provider is `nullProvider` (`isConfigured() === false`), so with no provider
 * the panel renders an honest, disabled reason rather than a broken button. Every path
 * that would call a provider short-circuits (`maybeComplete`).
 */
import { useState } from 'react';

export interface PlanGeneratePanelProps {
  /** Called with the raw JSON text of a generated plan, so the parent can load it. */
  onGenerated: (raw: string) => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'unavailable'; reason: string }
  | { kind: 'working' }
  | { kind: 'error'; message: string };

export function PlanGeneratePanel({ onGenerated }: PlanGeneratePanelProps): React.JSX.Element {
  const [brief, setBrief] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const generate = async (): Promise<void> => {
    setStatus({ kind: 'working' });
    try {
      // Dynamic import: the module is fetched only when the user asks for generation.
      const ai = await import('../../ai');
      const capability = ai.createScenePlannerCapability();
      const provider = ai.nullProvider;
      if (!provider.isConfigured()) {
        setStatus({
          kind: 'unavailable',
          reason: 'No AI provider is configured. Add a provider in Settings to enable generation.',
        });
        return;
      }
      const request = capability.buildRequest({
        brief,
        sceneId: '',
        sceneName: '',
        durationSeconds: 0,
        environment: { id: '', name: '', anchors: [] },
        characters: [],
        existingLines: [],
      });
      const completion = await provider.complete(request);
      if (ai.isAIUnavailable(completion)) {
        setStatus({ kind: 'unavailable', reason: completion.message });
        return;
      }
      onGenerated(completion.text);
      setStatus({ kind: 'idle' });
    } catch (error) {
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Generation failed.' });
    }
  };

  const disabled = brief.trim() === '' || status.kind === 'working';
  const reason =
    status.kind === 'unavailable'
      ? status.reason
      : brief.trim() === ''
        ? 'Write a brief first.'
        : null;

  return (
    <div className="space-y-1 border-t border-ink-800 pt-2">
      <div className="text-[10px] uppercase tracking-wider text-ink-500">Generate a plan</div>
      <textarea
        className="h-16 w-full rounded border border-ink-700 bg-ink-950 px-2 py-1 font-mono text-[11px] text-ink-200"
        aria-label="Scene brief"
        placeholder="Describe the scene..."
        value={brief}
        onChange={(event) => setBrief(event.target.value)}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => void generate()}
        className="w-full rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:border-zanza-500 hover:text-white disabled:opacity-40"
      >
        {status.kind === 'working' ? 'Generating…' : 'Generate plan'}
      </button>
      {reason && <div className="text-[10px] text-amber-400">{reason}</div>}
      {status.kind === 'error' && (
        <div role="status" className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[10px] text-red-300">
          {status.message}
        </div>
      )}
    </div>
  );
}
