/**
 * The mixdown: the episode's audio as one file.
 *
 * Step 5 of Phase 12. `episodeAudioPlan` already answers "what is audible when, in episode
 * time", and this module is the only thing that plays it: it opens an
 * `OfflineAudioContext` of exactly the episode's length, places every segment, and reads
 * one buffer back. That is a pure buffer transform with no output device, so it needs no
 * user gesture, hits no per-page context cap, and is *faster than real time* — which is
 * what makes an offline mixdown preferable to recording the transport.
 *
 * ## Why the plan is not re-derived
 *
 * Nothing here walks tracks, looks up clips, or computes an offset. Every window comes
 * from `mixdownPlan`, which is a pure projection of `episodeAudioPlan` (built in Phase 10
 * for exactly this, per §19.5). If the mixdown had its own idea of when a scene starts, it
 * would be a second source of truth for the same fact, and a mixdown that drifts from the
 * picture by one scene offset is precisely the failure nobody catches by listening to a
 * single scene. The decision is therefore split out and testable, and this module only
 * executes it.
 *
 * ## Looping, honestly
 *
 * `segment.loop` means ambience repeats to fill its clip window. A mixdown has to
 * actually repeat the samples, and `AudioBufferSourceNode.loop` does that in one line
 * rather than by copying audio into the destination. The `duration` is left unset on a
 * looping source for that reason: setting it would cap the loop at the clip length and
 * truncate a 10s ambience bed that a 3s window should have filled.
 *
 * The exception is a loop whose asset is *shorter* than the window, which is a
 * mis-authored clip rather than a request, and where looping the same short buffer would
 * produce a perceptible stutter. That case is reported rather than quietly rendered.
 */

import { decodeAudioDataCopy } from '../audio/decode.browser';
import { exportTimeline } from './resolveFrame';
import { mixdownPlan, type MixdownPlacement } from './mixdownPlan';
import type { Id, Project } from '../types';

/** Reads the bytes behind a media id. Async because the store is IndexedDB. */
export type MixdownByteSource = (mediaId: Id) => Promise<ArrayBuffer | null>;

export interface MixdownResult {
  /** The rendered audio, `episodeDuration` seconds long. */
  buffer: AudioBuffer;
  /** A playable file of `buffer`, for download or for a video mux. */
  blob: Blob;
  /** Segments that were audible and placed. */
  placed: number;
  /**
   * Segments the plan said should be heard but which are not in the mix, each with why.
   * A mixdown that silently drops a cue is worse than one that fails, so this is
   * reported to the caller and surfaced by the panel rather than swallowed.
   */
  missing: MissingSegment[];
}

export interface MissingSegment {
  audioId: Id;
  sceneId: Id;
  /** Episode time the segment should have started at. */
  episodeStart: number;
  reason: 'no-source' | 'undecodable' | 'loop-shorter-than-window';
}

/** A mixdown of a silent episode is still a valid file, so this is not an error. */
const MIXDOWN_SAMPLE_RATE = 48_000;
const MIXDOWN_CHANNELS = 2;

/** Encoder for the downloadable file. WAV: no dependency, no codec, byte-exact samples. */
const MIXDOWN_MIME = 'audio/wav';

interface OfflineWindow {
  OfflineAudioContext?: typeof OfflineAudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
}

/**
 * The length of the mixdown in seconds, which is the episode's own duration.
 *
 * Exported so a caller can report "3.2s of audio" without decoding the result back.
 */
export function mixdownDuration(project: Project, episodeId: Id): number {
  return exportTimeline(project, episodeId)?.duration ?? 0;
}

/**
 * Render an episode's audio to a single buffer and a WAV file.
 *
 * `loadBytes` is required rather than optional: without it, attached recordings cannot
 * be read, and a mixdown that silently contained only the ambience would be reported as a
 * complete export.
 */
export async function mixdownEpisode(
  project: Project,
  episodeId: Id,
  loadBytes: MixdownByteSource,
): Promise<MixdownResult> {
  const timeline = exportTimeline(project, episodeId);
  if (!timeline) throw new Error(`Unknown episode: ${episodeId}`);

  const duration = timeline.duration;
  if (duration <= 0) {
    throw new Error('Cannot mix down an episode with no playable scenes');
  }

  const Ctor = offlineCtor();
  if (!Ctor) throw new Error('OfflineAudioContext unavailable');

  const context = new Ctor(
    MIXDOWN_CHANNELS,
    Math.ceil(duration * MIXDOWN_SAMPLE_RATE),
    MIXDOWN_SAMPLE_RATE,
  );

  const plan = mixdownPlan(project, episodeId);
  if (!plan) throw new Error(`Unknown episode: ${episodeId}`);

  const audioById = new Map(project.assets.audio.map((a) => [a.id, a]));
  const missing: MissingSegment[] = [];
  let placed = 0;

  for (const placement of plan.placements) {
    const outcome = await placePlacement(context, placement, audioById, loadBytes);
    if (outcome === 'placed') {
      placed++;
    } else {
      missing.push({
        audioId: placement.audioId,
        sceneId: placement.sceneId,
        episodeStart: placement.start,
        reason: outcome,
      });
    }
  }

  const buffer = await context.startRendering();
  const bytes = encodeWav(buffer);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: MIXDOWN_MIME });

  return { buffer, blob, placed, missing };
}

/**
 * Place one segment on the offline context.
 *
 * Returns `'placed'`, or the reason it was not. Every early return here is a distinct
 * real failure, which is why they are named rather than collapsed into one catch.
 */
async function placePlacement(
  context: OfflineAudioContext,
  placement: MixdownPlacement,
  audioById: Map<Id, { src: string | null; srcKind: 'local' | 'external' | null }>,
  loadBytes: MixdownByteSource,
): Promise<'placed' | MissingSegment['reason']> {
  const asset = audioById.get(placement.audioId);
  if (!asset?.src) return 'no-source';

  let buffer: AudioBuffer | null = null;
  if (asset.srcKind === 'local') {
    try {
      const bytes = await loadBytes(asset.src);
      if (!bytes) return 'no-source';
      buffer = await decodeAudioDataCopy(context, bytes);
    } catch {
      return 'undecodable';
    }
  } else {
    try {
      const response = await fetch(asset.src);
      if (!response.ok) return 'no-source';
      buffer = await decodeAudioDataCopy(context, await response.arrayBuffer());
    } catch {
      return 'undecodable';
    }
  }
  if (!buffer) return 'undecodable';

  if (placement.loop && buffer.duration < placement.minimumAssetDuration) {
    // A looping asset shorter than the window it must fill is a content error, not a
    // rendering one. Reported instead of rendered as an audible stutter.
    return 'loop-shorter-than-window';
  }

  const source = context.createBufferSource();
  source.buffer = buffer;
  source.loop = placement.loop;

  const gain = context.createGain();
  // Linear gain straight from the clip, exactly as the live engine applies it, so a
  // mixdown and a playback of the same clip agree on level.
  gain.gain.value = placement.gain;

  source.connect(gain);
  gain.connect(context.destination);

  if (placement.loop) {
    // No duration: a looping source would be capped at one pass and truncate a long
    // ambience bed instead of repeating to fill the window.
    source.start(placement.start, 0);
  } else {
    // A one-shot is bounded by what the asset holds, so it cannot run off its end and
    // produce the click an unbounded source would. A zero-length placement is dropped:
    // it is inaudible, and starting at the end of a zero buffer is a throw.
    const playable = Math.min(placement.duration ?? 0, buffer.duration);
    if (playable <= 0) return 'no-source';
    source.start(placement.start, 0, playable);
  }
  return 'placed';
}

function offlineCtor(): typeof OfflineAudioContext | null {
  const windowWithAudio = globalThis as OfflineWindow;
  return windowWithAudio.OfflineAudioContext ?? windowWithAudio.webkitOfflineAudioContext ?? null;
}

/**
 * Encode PCM as a WAV file, as bytes.
 *
 * Returns a `Uint8Array` rather than a `Blob` so the result can be parsed back and
 * asserted on. jsdom's `Blob` has no `arrayBuffer()`, so a `Blob`-returning encoder can
 * only be tested by trusting the header numbers it wrote about itself. The caller wraps
 * this in a `Blob` at the point of download, which is the only place the type matters.
 *
 * WAV rather than MP3 or AAC on purpose: the job is to prove the episode's audio mixes
 * down to one continuous file, and WAV needs no encoder dependency and no codec to be
 * present. It is large and every tool reads it. An encoder would be a later phase's
 * decision, and picking one here would be that decision made by accident.
 */
export function encodeWav(buffer: AudioBuffer): Uint8Array {
  const channels = buffer.numberOfChannels;
  const frames = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channels * bytesPerSample;
  const dataBytes = frames * blockAlign; // interleaved: frames * channels * bytesPerSample

  const view = new DataView(new ArrayBuffer(44 + dataBytes));
  const writeString = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM chunk size
  view.setUint16(20, 1, true); // format: PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 8 * bytesPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataBytes, true);

  // Read one channel at a time and interleave. The samples are copied rather than
  // referenced, so a mixdown that is handed on cannot be mutated by the context that
  // produced it.
  const channelsData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelsData.push(buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = channelsData[c]?.[i] ?? 0;
      // Clamped before scaling: float audio can exceed [-1, 1] after gain, and writing
      // those as 16-bit would wrap to a loud click at the end of the file.
      const clamped = Math.max(-1, Math.min(1, sample));
      view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
      offset += bytesPerSample;
    }
  }

  return new Uint8Array(view.buffer);
}

/** The MIME type of the file `encodeWav` produces. */
export const MIXDOWN_MIME_TYPE = MIXDOWN_MIME;
