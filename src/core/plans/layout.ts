/**
 * Dialogue cue layout (ARCHITECTURE_SPEC.md §11.2 — Phase 17).
 *
 * A plan line may name an explicit cue window, a start, both, or neither. This module
 * turns those four cases into concrete windows **once** — the validator reads the
 * windows to diagnose timing, the compiler reads the same windows to emit
 * `AddDialogueLine` — so the two can never disagree (§11.3 rule 4).
 *
 * The estimate is deliberately crude and deterministic: a syllable is about three
 * characters, and speech runs about 4.2 syllables a second. No clock, no corpus, no
 * randomness — a fixture must lay out identically on every machine (§9.3 rule 6).
 *
 * Two scene modes:
 * - `create` — a scene that does not exist yet may be **extended** to fit the last cue.
 * - `modify` — an existing scene is never resized by a dialogue cue; cues are
 *   **truncated** at the scene end instead (§10.3: clips must never cross the end).
 */
import type { PlannedLine, ResolvedCue, ScenePlan } from './types';
import { MIN_CLIP_DURATION } from '../document/trackOps';

/** Characters per syllable, for the duration estimate. */
export const DIALOGUE_CHARS_PER_SYLLABLE = 3;
/** Syllables per second of speech. */
export const DIALOGUE_SYLLABLES_PER_SECOND = 4.2;
/** Default silence between generated cues, in seconds. */
export const DIALOGUE_CUE_GAP = 0.25;
/** Default start of the first generated cue, in seconds. */
export const DIALOGUE_CUE_START = 0;
/** Two cues this close (or closer) to touching are not a diagnosable overlap. */
export const DIALOGUE_CUE_OVERLAP_TOLERANCE = 0.1;

export interface DialogueLayoutInput {
  lines: readonly PlannedLine[];
  /** Duration the scene will have when the cues play. */
  sceneDuration: number;
  mode: 'create' | 'modify';
  timing?: ScenePlan['timing'];
}

export interface DialogueLayout {
  /** One entry per `lines` entry, in plan order. */
  cues: ResolvedCue[];
  /** Possibly extended beyond `input.sceneDuration` — only in `create` mode. */
  sceneDuration: number;
  /** True when dialogue pushed a created scene past its requested duration. */
  extended: boolean;
  /** The effective defaults, after explicit `timing` overrides. */
  defaults: { start: number; gap: number };
  /** Indices whose final window touches its predecessor beyond the tolerance. */
  overlapIndices: number[];
}

/** Estimated spoken duration of a line, floored at a clip's minimum. */
export function estimateCueDuration(text: string): number {
  const seconds = text.length / DIALOGUE_CHARS_PER_SYLLABLE / DIALOGUE_SYLLABLES_PER_SECOND;
  return Math.max(MIN_CLIP_DURATION, seconds);
}

/**
 * Lay out every line's cue window. Total: explicit negative values are clamped here
 * and reported as `negative-value` diagnostics by the validator, which owns messaging.
 */
export function layoutDialogue(input: DialogueLayoutInput): DialogueLayout {
  const defaults = {
    start: Math.max(0, input.timing?.dialogueStart ?? DIALOGUE_CUE_START),
    gap: Math.max(0, input.timing?.dialogueGap ?? DIALOGUE_CUE_GAP),
  };

  const cues: ResolvedCue[] = [];
  let cursor = defaults.start;

  for (const line of input.lines) {
    const startGiven = line.start !== undefined;
    const durationGiven = line.duration !== undefined;
    const start = startGiven ? Math.max(0, line.start as number) : cursor;
    const duration = durationGiven
      ? Math.max(0, line.duration as number)
      : estimateCueDuration(line.text);
    cues.push({ start, duration, generated: !(startGiven && durationGiven), truncated: false });
    cursor = start + duration + defaults.gap;
  }

  let sceneDuration = input.sceneDuration;
  let extended = false;

  if (cues.length > 0 && input.mode === 'create') {
    const needed = Math.max(...cues.map((cue) => cue.start + cue.duration));
    if (needed > sceneDuration) {
      sceneDuration = needed;
      extended = true;
    }
  }

  if (input.mode === 'modify') {
    for (const cue of cues) {
      const end = cue.start + cue.duration;
      if (end > sceneDuration) {
        cue.truncated = true;
        if (cue.start >= sceneDuration) {
          // No room at the requested start: park the cue at the tail of the scene.
          const tail = Math.min(MIN_CLIP_DURATION, sceneDuration);
          cue.start = Math.max(0, sceneDuration - tail);
          cue.duration = sceneDuration - cue.start;
        } else {
          cue.duration = sceneDuration - cue.start;
        }
      }
    }
  }

  const overlapIndices: number[] = [];
  for (let i = 1; i < cues.length; i += 1) {
    const previous = cues[i - 1];
    const current = cues[i];
    if (previous && current && current.start + DIALOGUE_CUE_OVERLAP_TOLERANCE < previous.start + previous.duration) {
      overlapIndices.push(i);
    }
  }

  return { cues, sceneDuration, extended, defaults, overlapIndices };
}
