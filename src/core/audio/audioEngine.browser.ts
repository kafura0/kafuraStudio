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
import type { Id, Project, Scene } from '../types';

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
  schedule(project: Project, scene: Scene, time: number): void {
    if (time < this.lastTime) {
      this.stop();
      this.lastTime = time;
    } else {
      this.lastTime = time;
    }

    for (const segment of audioPlan(project, scene)) {
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
 */
export function createFetchingResolver(getSrc: (audioId: Id) => string | null): AudioResolver {
  return async (audioId) => {
    const src = getSrc(audioId);
    if (!src) return null;
    try {
      const response = await fetch(src);
      if (!response.ok) return null;
      const bytes = await response.arrayBuffer();
      const windowWithAudio = globalThis as WebAudioWindow;
      const Ctor = windowWithAudio.AudioContext ?? windowWithAudio.webkitAudioContext;
      if (!Ctor) return null;
      const context = new Ctor();
      return await context.decodeAudioData(bytes);
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(`AudioEngine could not load "${audioId}" from "${src}"`, error);
      }
      return null;
    }
  };
}

/** Build the engine against the browser's real AudioContext, or null when absent. */
export function createBrowserAudioEngine(
  assets: readonly { id: Id; src: string | null }[],
): AudioEngine | null {
  const windowWithAudio = globalThis as WebAudioWindow;
  const Ctor = windowWithAudio.AudioContext ?? windowWithAudio.webkitAudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  const byId = new Map(assets.map((a) => [a.id, a]));
  return new AudioEngine(context, createFetchingResolver((id) => byId.get(id)?.src ?? null));
}