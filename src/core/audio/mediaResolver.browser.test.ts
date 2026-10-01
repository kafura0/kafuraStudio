/**
 * Resolving an *attached* audio file, as opposed to fetching a URL.
 *
 * This is the test that would have caught the original gap. A local `src` is a media id
 * like `media_ab12cd34`, and `fetch()` of that resolves against the current document and
 * fails — so an attachment could be stored, listed as attached, survive a reload, and still
 * be inaudible. The `srcKind` field is what makes the two cases distinguishable, and these
 * tests pin that it is honoured.
 *
 * A fake decode context stands in for `BaseAudioContext`; the point is which bytes reach
 * `decodeAudioData` and from where, not that a real codec ran.
 */
import { describe, expect, it, vi } from 'vitest';
import { createMediaStoreResolver, type AudioSourceRef } from './audioEngine.browser';

interface FakeContext {
  decodeAudioData(bytes: ArrayBuffer): Promise<{ decoded: true; byteLength: number }>;
  decoded: number[];
}

function fakeContext(): FakeContext {
  const decoded: number[] = [];
  return {
    decoded,
    decodeAudioData(bytes: ArrayBuffer) {
      decoded.push(bytes.byteLength);
      return Promise.resolve({ decoded: true, byteLength: bytes.byteLength });
    },
  };
}

function bytes(length: number): ArrayBuffer {
  return new ArrayBuffer(length);
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('createMediaStoreResolver', () => {
  it('decodes local media by reading bytes from the media store, not fetching', async () => {
    const context = fakeContext();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const sources = new Map<string, AudioSourceRef>([
      ['vo_1', { src: 'media_ab12cd34', srcKind: 'local' }],
    ]);
    const load = vi.fn(async (id: string) => (id === 'media_ab12cd34' ? bytes(512) : null));

    const resolver = createMediaStoreResolver(
      context as unknown as BaseAudioContext,
      (id) => sources.get(id) ?? null,
      load,
    );
    const buffer = await resolver('vo_1');
    await tick();

    expect(load).toHaveBeenCalledWith('media_ab12cd34');
    // The whole point: a media id is never handed to fetch().
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(context.decoded).toEqual([512]);
    expect(buffer).toMatchObject({ decoded: true, byteLength: 512 });
    vi.unstubAllGlobals();
  });

  it('fetches an external src, which is a path the operator supplied', async () => {
    const context = fakeContext();
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => bytes(256),
    }));
    vi.stubGlobal('fetch', fetchSpy);
    const sources = new Map<string, AudioSourceRef>([
      ['vo_1', { src: '/media/line-1.wav', srcKind: 'external' }],
    ]);
    const load = vi.fn();

    const resolver = createMediaStoreResolver(
      context as unknown as BaseAudioContext,
      (id) => sources.get(id) ?? null,
      load,
    );
    await resolver('vo_1');
    await tick();

    expect(fetchSpy).toHaveBeenCalledWith('/media/line-1.wav');
    expect(load).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('is silent for a slot that claims media the store does not have', async () => {
    const context = fakeContext();
    const sources = new Map<string, AudioSourceRef>([
      ['vo_1', { src: 'media_gone', srcKind: 'local' }],
    ]);
    const resolver = createMediaStoreResolver(
      context as unknown as BaseAudioContext,
      (id) => sources.get(id) ?? null,
      async () => null,
    );
    expect(await resolver('vo_1')).toBeNull();
    // Nothing was decoded, because there was nothing to decode.
    expect(context.decoded).toEqual([]);
  });

  it('is silent for an empty slot, without touching the store', async () => {
    const context = fakeContext();
    const sources = new Map<string, AudioSourceRef>([['vo_1', { src: null, srcKind: null }]]);
    const load = vi.fn();
    const resolver = createMediaStoreResolver(
      context as unknown as BaseAudioContext,
      (id) => sources.get(id) ?? null,
      load,
    );
    expect(await resolver('vo_1')).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });

  it('is silent when the store read throws, rather than rejecting into the scheduler', async () => {
    const context = fakeContext();
    const sources = new Map<string, AudioSourceRef>([
      ['vo_1', { src: 'media_x', srcKind: 'local' }],
    ]);
    const resolver = createMediaStoreResolver(
      context as unknown as BaseAudioContext,
      (id) => sources.get(id) ?? null,
      async () => {
        throw new Error('IndexedDB read failed');
      },
    );
    expect(await resolver('vo_1')).toBeNull();
  });

  it('is silent for an id that is not in the library at all', async () => {
    const context = fakeContext();
    const resolver = createMediaStoreResolver(
      context as unknown as BaseAudioContext,
      () => null,
      async () => bytes(10),
    );
    expect(await resolver('nope')).toBeNull();
    expect(context.decoded).toEqual([]);
  });
});
