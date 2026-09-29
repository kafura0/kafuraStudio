/**
 * Is there actually a recording behind an audio asset?
 *
 * RULE 9, and the Phase 8 gate in `docs/PLAN.md`: the audio library ships *declared
 * slots* with `src: null`, because recording the cast is a production task, not an
 * engineering one. A slot with no file is a promise of a recording, not a recording.
 * The engine plays silence for one — see `audioEngine.browser.ts` — and this is the one
 * predicate the UI asks when it has to say so on screen, so the two cannot disagree
 * about what "missing" means.
 */
import type { AudioDef } from '../types';

/**
 * Whether `asset` points at a playable file.
 *
 * An empty string counts as missing: it is what a file input yields when nothing was
 * chosen, and treating it as a path would hand the fetcher a URL of the current page.
 */
export function hasRecording(asset: AudioDef | null | undefined): boolean {
  if (!asset) return false;
  return typeof asset.src === 'string' && asset.src.trim() !== '';
}
