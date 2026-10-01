/**
 * Measuring an audio file before it is attached.
 *
 * `audioPlan` bounds every segment by `asset.duration`, so attaching a file without
 * measuring it produces a slot that is saved, listed as attached, reloads correctly — and
 * plays silence, because the plan cuts the segment to zero length. Measuring here is what
 * makes the difference between "stored" and "audible".
 *
 * An `OfflineAudioContext` does the decoding. That is deliberate: it is a pure buffer
 * transform with no output device, so it is not one of the handful of hardware contexts a
 * browser caps per page (the F6 bug), and it needs no user gesture to construct — attaching
 * a file must not require the AudioContext autoplay unlock that playback waits for.
 *
 * It decodes a **copy** of the buffer. `decodeAudioData` detaches what it is given, and the
 * caller needs those exact bytes to store the file; see `decode.browser.ts` for what
 * happens when it forgets.
 */
import { decodeAudioDataCopy } from './decode.browser';

interface OfflineWindow {
  OfflineAudioContext?: typeof OfflineAudioContext;
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
}

/** Enough frames to decode a short file; the length is irrelevant offline. */
const PROBE_FRAMES = 1;

/**
 * Seconds of audio in `bytes`, or `null` if it cannot be decoded.
 *
 * `null` rather than `0` for failure, so the caller can tell "unreadable" from "empty" and
 * say so instead of recording a length that will mute the clip. A zero-length decode is a
 * real answer and is reported as `0`.
 */
export async function probeAudioDuration(bytes: ArrayBuffer): Promise<number | null> {
  const windowWithAudio = globalThis as OfflineWindow;
  const Ctor = windowWithAudio.OfflineAudioContext ?? windowWithAudio.webkitOfflineAudioContext;
  if (!Ctor) return null;
  try {
    const context = new Ctor(1, PROBE_FRAMES, 44100);
    const buffer = await decodeAudioDataCopy(context, bytes);
    return Number.isFinite(buffer.duration) ? buffer.duration : null;
  } catch {
    // Not audio, truncated, or a codec this browser cannot decode. The caller reports it;
    // guessing a length here would produce a slot that is quietly wrong.
    return null;
  }
}
