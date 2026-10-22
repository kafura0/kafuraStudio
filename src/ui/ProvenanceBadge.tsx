/**
 * The AI provenance badge (ARCHITECTURE_SPEC.md §24.10, §9.4 — Phase 19 step 6).
 *
 * A record is "AI-authored" when `provenance.actor === 'ai'`. The badge is the honest,
 * visible mark of that: it appears beside a scene that contains AI-created cast or lines,
 * and it names the provider and model when the record carries them. A human edit carries no
 * provenance, so absence means human — the badge is never shown for work nobody attributed
 * to a model.
 *
 * Content-agnostic: it reads only `provenance`, never a character or show name.
 */
import type { Provenance } from '../core/types';
import { isAIProvenance } from '../lib/provenance';

export function ProvenanceBadge({ provenance, title }: { provenance?: Provenance; title?: string }): React.JSX.Element | null {
  if (!isAIProvenance(provenance)) return null;
  const detail = [
    'AI',
    provenance!.provider ? `× ${provenance!.provider}` : null,
    provenance!.model ? `· ${provenance!.model}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <span
      className="ml-1 rounded bg-ink-800 px-1 py-px font-mono text-[9px] uppercase text-ink-300"
      title={title ?? `Authored by a model${provenance!.provider ? ` (${provenance!.provider})` : ''}`}
    >
      {detail}
    </span>
  );
}
