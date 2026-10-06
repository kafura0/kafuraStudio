/**
 * THE WEB AUDIO ENGINE — the only browser-coupled part of Phase 8.
 *
 * A scheduler, nothing more. The pure `audioPlan()` decides what should be audible;
 * this class plays buffers for the segments that resolve to real media and skips the
 * rest. That skip is honest silence (RULE 9): the seed project declares audio slots
 * with `src: null`, so playback is silent for content reasons, and any project that
 * wires real buffers through its resolver plays.
 *
 * Scheduling is start-time relative to the playhead the store already owns. The
 * engine never keeps its own clock; it is fed the scene time, like the stage and the
 * timeline playhead, so the three cannot drift apart (PLAN.md, "Why audio is after
 * the timeline").
 *
 * Tests in this file drive a fake `AudioPort`, so the engine is verified without a
 * live AudioContext.
 */
import { audioPlan, type AudioSegment } from './audioPlan';
import { decodeAudioDataCopy } from './decode.browser';
import type { Id, Scene, SceneContext } from '../types';

/** The slice of the Web Audio API the engine touches, so a test can fake it. */
export interface AudioPort {
  readonly currentTime: number;
  readonly destination: unknown;
  createGain(): {
    gain: { value: number };
    connect(destination: unknown): void;
    disconnect(): void;
  };
  createBufferSource(): {
    buffer: unknown;
    loop: boolean;
    connect(node: unknown): void;
    start(when: number, offset?: number, duration?: number): void;
    stop(when?: number): void;
    onended: unknown;
  };
}

/** Resolves an asset id to a playable buffer, or null for honest silence. */
export type AudioResolver = (audioId: Id) => Promise<unknown>;

/** Seconds ahead of the playhead the engine will schedule. */
const LOOKAHEAD = 0.6;

export class AudioEngine {
  private readonly port: AudioPort;
  private readonly resolver: AudioResolver;
  private readonly cache = new Map<Id, unknown>();
  private readonly scheduled = new Set<Id>();
  private readonly live = new Set<object>();
  private lastTime = -Infinity;

  constructor(port: AudioPort, resolver: AudioResolver) {
    this.port = port;
    this.resolver = resolver;
  }

  /**
   * Schedule every segment starting within `LOOKAHEAD` seconds of `time`. Call once
   * per frame while playing. A non-monotonic `time` (scrub backwards, or the scene
   * looping to zero) clears the schedule so nothing replays out of order.
   */
  schedule(context: SceneContext, scene: Scene, time: number): void {
    if (time < this.lastTime) {
      this.stop();
      this.lastTime = time;
    } else {
      this.lastTime = time;
    }

    for (const segment of audioPlan(context, scene)) {
      if (this.scheduled.has(segment.clipId)) continue;
      const startIn = segment.start - time;
      if (startIn < 0 || startIn > LOOKAHEAD) continue;
      // Mark as scheduled before the async resolve so repeat calls do not double it.
      this.scheduled.add(segment.clipId);
      void this.play(segment, startIn);
    }
  }

  /** Stop everything and forget every clip, so the next schedule is a clean slate. */
  stop(): void {
    for (const handle of this.live) {
      // A live handle holds the pair { source, gain }; tearing it down on stop() is
      // the one place we know the clock is being rewound or paused.
      (handle as unknown as { cancel(): void }).cancel();
    }
    this.live.clear();
    this.scheduled.clear();
  }

  /**
   * Play one asset once, ignoring the timeline. Returns whether a file was started.
   *
   * Used to check an attachment, so it reports failure rather than silently doing nothing:
   * `false` means "no bytes", which is the one thing the operator needs to be told.
   */
  async preview(context: SceneContext, audioId: Id): Promise<boolean> {
    const buffer = await this.bufferFor(audioId);
    if (!buffer) return false;
    const def = context.assets.audio.find((a) => a.id === audioId);
    const duration = def && Number.isFinite(def.duration) && def.duration > 0 ? def.duration : 0;
    try {
      const source = this.port.createBufferSource();
      source.buffer = buffer;
      source.loop = false;
      const gain = this.port.createGain();
      // A preview is a monitoring action, so it plays at unity gain rather than at the
      // asset's timeline gain, which is frequently zero for an ambience bed under dialogue.
      gain.gain.value = 1;
      source.connect(gain);
      gain.connect(this.port.destination);

      const when = this.port.currentTime;
      // A zero `duration` would mean "play nothing", which is why attach probes the real
      // length. Playing the buffer unbounded is the safe fallback: an unmeasured file is
      // still heard, rather than being cut to silence.
      source.start(when, 0, duration > 0 ? duration : undefined);
      source.onended = () => this.live.delete(handle);
      const handle: object = {
        cancel: () => {
          source.onended = null;
          try {
            source.stop();
          } catch {
            // already stopped
          }
          gain.disconnect();
        },
      };
      this.live.add(handle);
      return true;
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('AudioEngine could not start a preview', error);
      }
      return false;
    }
  }

  dispose(): void {
    this.stop();
    this.cache.clear();
  }

  private async play(segment: AudioSegment, startIn: number): Promise<void> {
    const buffer = await this.bufferFor(segment.audioId);
    if (!buffer) return; // missing recording: honest silence, not a facade

    let handle: object;
    try {
      const source = this.port.createBufferSource();
      source.buffer = buffer;
      source.loop = segment.loop;
      const gain = this.port.createGain();
      gain.gain.value = clampGain(segment.gain);
      source.connect(gain);
      gain.connect(this.port.destination);

      const when = this.port.currentTime + startIn;
      source.start(when, 0, segment.loop ? undefined : segment.duration);
      if (segment.loop) source.stop(when + segment.duration);
      source.onended = () => {
        this.live.delete(handle);
        this.scheduled.delete(segment.clipId);
      };
      handle = {
        cancel: () => {
          source.onended = null;
          try {
            source.stop();
          } catch {
            // already stopped; stopping twice throws and the node is dead anyway
          }
          gain.disconnect();
          this.scheduled.delete(segment.clipId);
        },
      };
      this.live.add(handle);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn('AudioEngine could not start a segment', error);
      }
      this.scheduled.delete(segment.clipId);
    }
  }

  private async bufferFor(audioId: Id): Promise<unknown> {
    if (this.cache.has(audioId)) return this.cache.get(audioId) ?? null;
    const buffer = await this.resolver(audioId);
    this.cache.set(audioId, buffer);
    return buffer;
  }
}

function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 1;
  return Math.min(Math.max(gain, 0), 2);
}

interface WebAudioWindow {
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

/**
 * The default resolver: finds the asset by id and fetches + decodes its `src`.
 * A slot with no `src`, an unreachable file, or an undecodable buffer yields null —
 * the engine treats null as silence. Failures surface once in dev.
 *
 * `context` is the engine's own, borrowed for decoding rather than minted per file. An
 * `AudioContext` is a real, capped hardware resource — a browser allows only a handful per
 * page and starts suspending the rest — and a decoded buffer is held for as long as its
 * context is open. One context that both decodes and plays is the whole point of
 * `createBrowserAudioEngine` owning one.
 */
export function createFetchingResolver(
  context: BaseAudioContext,
  getSrc: (audioId: Id) => string | null,
): AudioResolver {
  return async (audioId) => {
    const src = getSrc(audioId);
    if (!src) return null;
    try {
      const response = await fetch(src);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      return await context.decodeAudioData(bytes);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(`AudioEngine could not load "${audioId}" from "${src}"`, error);
      }
      return null;
    }
  };
}

/** How a slot's `src` should be read: a media id in the store, or a URL. */
export interface AudioSourceRef {
  src: string | null;
  srcKind: 'local' | 'external' | null;
}

/** Reads the bytes behind a media id. Async because the store is (IndexedDB). */
export type MediaByteSource = (mediaId: Id) => Promise<ArrayBuffer | null>;

/**
 * The resolver for attached files: reads a media id out of the media store.
 *
 * This exists because a media id is not a URL. `fetch('media_ab12cd34')` resolves against
 * the current document's base and 404s, so an attachment stored through Phase 11's media
 * store could be saved, reloaded, listed as attached, and still be inaudible — the worst
 * possible failure, because every piece of it reports success. `srcKind` is what makes the
 * two cases distinguishable: `'local'` is an id to look up, `'external'` is a path to fetch.
 *
 * A slot claiming media the store does not have yields null, which the engine plays as
 * silence. That is the honest outcome and matches `mediaStore.ts`: the same three-way
 * agreement (`src` present, `srcKind: 'local'`, bytes present) decides there and here, so
 * the panel's "attached" and the engine's audibility cannot disagree.
 */
export function createMediaStoreResolver(
  context: BaseAudioContext,
  getSource: (audioId: Id) => AudioSourceRef | null,
  loadBytes: MediaByteSource,
): AudioResolver {
  const fetching = createFetchingResolver(context, (id) => {
    const source = getSource(id);
    return source?.srcKind === 'external' ? source.src : null;
  });
  return async (audioId) => {
    const source = getSource(audioId);
    if (!source?.src) return null;
    if (source.srcKind !== 'local') return fetching(audioId);
    try {
      const bytes = await loadBytes(source.src);
      if (!bytes) return null;
      return await decodeAudioDataCopy(context, bytes);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(`AudioEngine could not decode attached media "${source.src}"`, error);
      }
      return null;
    }
  };
}

/** Build the engine against the browser's real AudioContext, or null when absent. */
export function createBrowserAudioEngine(
  assets: readonly { id: Id; src: string | null; srcKind: 'local' | 'external' | null }[],
  loadBytes?: MediaByteSource,
): AudioEngine | null {
  const windowWithAudio = globalThis as WebAudioWindow;
  const Ctor = windowWithAudio.AudioContext ?? windowWithAudio.webkitAudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  const byId = new Map(assets.map((a) => [a.id, a]));
  const getSource = (id: Id): AudioSourceRef | null => byId.get(id) ?? null;
  // Without a byte source there is nothing to resolve local media against, so fall back to
  // the URL-only resolver rather than pretending attached files are loadable.
  const resolver = loadBytes
    ? createMediaStoreResolver(context, getSource, loadBytes)
    : createFetchingResolver(context, (id) => byId.get(id)?.src ?? null);
  return new AudioEngine(context, resolver);
}
