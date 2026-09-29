/**
 * THE AUDIO PLAN — pure core.
 *
 * Turns the timeline into a list of audible segments. The Web Audio engine in
 * `audioEngine.browser.ts` is only a scheduler: it asks this module "what should be
 * audible, where, for how long, at what gain" and plays buffers for the segments that
 * resolve to real media. No DOM, no browser globals — the plan is deterministic and
 * unit-testable.
 *
 * Honesty rule (RULE 9): an audio asset whose `src` is absent or whose file cannot
 * be fetched resolves to silence. This module reports the *window* either way; the
 * engine decides what it can actually play. The seed project declares slots with
 * `src: null` (see `docs/MVP.md` §3: recordings are a production task), so the demo
 * is silent for content reasons, not because the mechanism is a placeholder.
 *
 * A segment's duration is bounded by its clip, by its scene, and by the asset's
 * declared length. Muted or locked audio tracks are dropped entirely.
 */
import type { AudioDef, Clip, Id, Project, Scene, Track } from '../types';

export interface AudioSegment {
  audioId: Id;
  clipId: Id;
  trackId: Id;
  /** Seconds on the scene timeline at which the sound starts. */
  start: number;
  /** Seconds the segment is audible (clip window ∩ scene ∩ asset length). */
  duration: number;
  /** Linear gain from the clip, applied by the engine's gain node. */
  gain: number;
  /** Ambience assets loop inside their clip window; everything else plays once. */
  loop: boolean;
}

/** Collect every audible window on a scene's audio and dialogue tracks. */
export function audioPlan(project: Project, scene: Scene): AudioSegment[] {
  const audioById = new Map(project.assets.audio.map((a) => [a.id, a]));

  const segments: AudioSegment[] = [];
  for (const track of scene.tracks) {
    if (track.muted || track.locked) continue;
    if (track.kind === 'audio' || track.kind === 'dialogue') {
      segments.push(...segmentsForTrack(track, scene, audioById));
    }
  }
  // Clips are already sorted per track; sorting the whole plan keeps playback order
  // one pass over a single clock.
  return segments.sort((a, b) => a.start - b.start || a.trackId.localeCompare(b.trackId));
}

function segmentsForTrack(
  track: Track,
  scene: Scene,
  audioById: Map<Id, AudioDef>,
): AudioSegment[] {
  const out: AudioSegment[] = [];
  for (const clip of track.clips) {
    const audioId = audioIdFor(track, clip, scene);
    if (!audioId) continue;
    const asset = audioById.get(audioId);
    if (!asset) continue; // references an undeclared slot: not our problem to invent

    const clipEnd = clip.start + clip.duration;
    const start = Math.max(clip.start, 0);
    const end = Math.min(clipEnd, scene.duration, start + asset.duration);
    if (end <= start) continue;

    out.push({
      audioId,
      clipId: clip.id,
      trackId: track.id,
      start,
      duration: end - start,
      gain: clip.gain,
      loop: asset.kind === 'ambience',
    });
  }
  return out;
}

/** The audio asset a clip draws on: 'audio' clips carry it directly, dialogue clips
 * resolve their line's voice. A dialogue clip pointing at a missing line is silent. */
function audioIdFor(track: Track, clip: Clip, scene: Scene): Id | null {
  if (track.kind === 'audio') return clip.audioId;
  if (track.kind === 'dialogue' && clip.dialogueLineId) {
    const line = scene.dialogue.find((l) => l.id === clip.dialogueLineId);
    return line?.voiceAudioId ?? null;
  }
  return null;
}