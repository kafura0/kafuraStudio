/**
 * `decodeAudioData` destroys the buffer it is given.
 *
 * This suite exists because of a defect that every other test missed. `attachAudioFile`
 * reads a picked file into one buffer, probes its length, then stores it. `decodeAudioData`
 * detaches its input — specified behaviour, and what real Chrome does — so by the time the
 * store tried to clone those bytes it was holding a zero-length detached view, and the put
 * threw `DataCloneError`. Attaching a file, the entire point of the phase, did not work.
 *
 * Nothing caught it because the fakes in the other suites hand back a stub and never
 * detach. The fake here detaches for real, via a `structuredClone` transfer, which is the
 * same mechanism a browser uses. That is the difference between a test that describes the
 * code and a test that would have stopped this shipping.
 */
import { describe, expect, it, vi } from 'vitest';
import { decodeAudioDataCopy } from './decode.browser';
import { probeAudioDuration } from './probe.browser';
import { createMediaStoreResolver } from './audioEngine.browser';

/**
 * A decode context that behaves like the browser: it takes ownership of the bytes.
 *
 * `structuredClone(x, { transfer: [x] })` detaches `x` in place, exactly as
 * `decodeAudioData` is specified to, so a buffer handed here is unusable afterwards.
 */
function detachingContext(): { decodeAudioData: (b: ArrayBuffer) => Promise<unknown>; seen: number[] } {
  const seen: number[] = [];
  return {
    seen,
    decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
      seen.push(bytes.byteLength);
      // Capture the length first: afterwards the caller's view is gone.
      const duration = bytes.byteLength / 44_100;
      const copy = structuredClone(bytes, { transfer: [bytes] });
      if (copy.byteLength !== seen.at(-1)) throw new Error('transfer did not take the bytes');
      return Promise.resolve({ duration });
    },
  };
}

describe('decodeAudioDataCopy', () => {
  it('leaves the caller\'s buffer intact, where a direct decode would empty it', async () => {
    const context = detachingContext();
    const bytes = new ArrayBuffer(2048);

    await decodeAudioDataCopy(context as unknown as BaseAudioContext, bytes);

    // The whole point. A bare `context.decodeAudioData(bytes)` leaves this at 0.
    expect(bytes.byteLength).toBe(2048);
    // And the decoder really was given the same number of bytes.
    expect(context.seen).toEqual([2048]);
  });

  it('gives the decoder a distinct buffer, so detaching cannot reach the original', async () => {
    const context = detachingContext();
    const bytes = new ArrayBuffer(64);
    let received: ArrayBuffer | null = null;
    const spy = {
      decodeAudioData: (b: ArrayBuffer) => {
        received = b;
        return context.decodeAudioData(b);
      },
    };

    await decodeAudioDataCopy(spy as unknown as BaseAudioContext, bytes);

    expect(received).not.toBe(bytes);
    expect(bytes.byteLength).toBe(64);
  });
});

describe('probeAudioDuration', () => {
  it('measures the file and returns its length', async () => {
    const context = detachingContext();
    vi.stubGlobal('OfflineAudioContext', class {
      constructor() {}
      decodeAudioData = context.decodeAudioData;
    });
    const bytes = new ArrayBuffer(44_100 * 2); // two seconds at 44.1 kHz

    const duration = await probeAudioDuration(bytes);

    expect(duration).toBeCloseTo(2, 5);
    vi.unstubAllGlobals();
  });

  it('does not consume the bytes the caller still has to store', async () => {
    // This is the regression, stated as a test: attaching used this probe and then put the
    // same buffer into IndexedDB, where a detached buffer cannot be cloned.
    const context = detachingContext();
    vi.stubGlobal('OfflineAudioContext', class {
      constructor() {}
      decodeAudioData = context.decodeAudioData;
    });
    const bytes = new ArrayBuffer(88_244); // a one-second wav, the size of a real file

    await probeAudioDuration(bytes);

    expect(bytes.byteLength).toBe(88_244);
    // What the store does next with those bytes, verbatim.
    expect(() => structuredClone(bytes)).not.toThrow();
    vi.unstubAllGlobals();
  });

  it('still reports null when the browser cannot decode the file', async () => {
    vi.stubGlobal('OfflineAudioContext', class {
      constructor() {}
      decodeAudioData(): Promise<never> {
        return Promise.reject(new Error('not audio'));
      }
    });
    expect(await probeAudioDuration(new ArrayBuffer(16))).toBeNull();
    vi.unstubAllGlobals();
  });
});

describe('createMediaStoreResolver', () => {
  it('does not detach the buffer it was handed by the media store', async () => {
    const context = detachingContext();
    const stored = new ArrayBuffer(4096);
    const resolver = createMediaStoreResolver(
      context as unknown as BaseAudioContext,
      () => ({ src: 'media_1', srcKind: 'local' }),
      async () => stored,
    );

    const buffer = await resolver('vo_1');

    expect(buffer).toMatchObject({ duration: expect.any(Number) });
    // A second read of the same record must still be usable: the resolver did not take
    // the store's bytes away from it.
    expect(stored.byteLength).toBe(4096);
  });
});
