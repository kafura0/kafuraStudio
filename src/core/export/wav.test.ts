/**
 * Encoding a rendered buffer as a file.
 *
 * `mixdown.browser.ts` is split because rendering needs a real `OfflineAudioContext` and
 * `vitest` has no Web Audio. `encodeWav` is the other half, and it needs only a buffer, so
 * it can be checked here byte for byte.
 *
 * The tests below decode the produced file back rather than trusting the header numbers
 * the encoder wrote about itself. A wrong `data` size or a channel-interleaving mistake
 * produces a file that opens and plays the wrong length of garbage, and an encoder that
 * only asserts its own fields cannot see either.
 */

import { describe, expect, it } from 'vitest';
import { encodeWav, MIXDOWN_MIME_TYPE } from './mixdown.browser';
import { fakeBuffer, readWav } from './wavTestHelpers';

describe('encodeWav', () => {
  it('writes a valid RIFF/WAVE header', () => {
    const wav = readWav(encodeWav(fakeBuffer(128)));
    expect(wav.riff).toBe('RIFF');
    expect(wav.wave).toBe('WAVE');
    expect(wav.fmt).toBe('fmt ');
    expect(wav.format).toBe(1); // PCM
    expect(wav.channels).toBe(2);
    expect(wav.sampleRate).toBe(48_000);
    expect(wav.bitsPerSample).toBe(16);
  });

  it('declares a data size that matches the frames it wrote', () => {
    const frames = 256;
    const channels = 2;
    const wav = readWav(encodeWav(fakeBuffer(frames, channels)));
    expect(wav.dataSize).toBe(frames * channels * 2);
    // RIFF's size field counts everything after itself, so it is data + 36.
    expect(wav.riffSize).toBe(wav.dataSize + 36);
    // Interleaved, so the parsed sample count is frames * channels, not frames.
    expect(wav.samples.length).toBe(frames * channels);
  });

  it('interleaves channels in the order they were given', () => {
    // A distinctive value per channel makes an interleaving bug visible: if the encoder
    // wrote whole channels instead of interleaving, every sample pair would match instead
    // of alternating.
    const buffer = fakeBuffer(4, 2, 48_000);
    const left = buffer.getChannelData(0);
    const right = buffer.getChannelData(1);
    for (let i = 0; i < 4; i++) {
      left[i] = 0.1 * (i + 1);
      right[i] = -0.1 * (i + 1);
    }

    const wav = readWav(encodeWav(buffer));
    for (let i = 0; i < 4; i++) {
      expect(wav.samples[i * 2]).toBeCloseTo(left[i] ?? 0, 4);
      expect(wav.samples[i * 2 + 1]).toBeCloseTo(right[i] ?? 0, 4);
    }
  });

  it('round-trips silence exactly', () => {
    const wav = readWav(encodeWav(fakeBuffer(16)));
    for (const sample of wav.samples) expect(sample).toBe(0);
  });

  it('clamps samples above full scale rather than wrapping them', () => {
    // A gain above 1 on float audio is legal. Writing 4.0 straight to int16 wraps to about
    // -1, which is the loud click at the end of a track that a whole mixdown would carry.
    const buffer = fakeBuffer(4, 1, 48_000);
    const data = buffer.getChannelData(0);
    data[0] = 0.5;
    data[1] = -0.5;
    data[2] = 4;
    data[3] = -4;

    const wav = readWav(encodeWav(buffer));
    expect(wav.samples[0]).toBeCloseTo(0.5, 3);
    expect(wav.samples[1]).toBeCloseTo(-0.5, 3);
    // Clamped to the rails, and positive: a wrap would have produced a large negative.
    expect(wav.samples[2]).toBeGreaterThan(0.9);
    expect(wav.samples[3]).toBeLessThan(-0.9);
  });

  it('handles a single-channel buffer', () => {
    const wav = readWav(encodeWav(fakeBuffer(8, 1)));
    expect(wav.channels).toBe(1);
    expect(wav.samples.length).toBe(8);
  });

  it('handles an empty buffer without producing a malformed file', () => {
    // A zero-length data chunk is legal, and a mixdown of a cut that resolved to nothing
    // would hit this. The file must still be a readable 44-byte header.
    const wav = readWav(encodeWav(fakeBuffer(0)));
    expect(wav.riff).toBe('RIFF');
    expect(wav.dataSize).toBe(0);
    expect(wav.samples).toEqual([]);
  });

  it('is byte-identical for the same samples', () => {
    const build = (): AudioBuffer => {
      const buffer = fakeBuffer(32, 2);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < 32; i++) data[i] = Math.sin(i / 4);
      return buffer;
    };
    expect(Array.from(encodeWav(build()))).toEqual(Array.from(encodeWav(build())));
  });

  it('names a MIME type that needs no codec to play', () => {
    // Asserted because the panel offers this file for download, and a type the browser
    // cannot play is a download that fails after the export reported success.
    expect(MIXDOWN_MIME_TYPE).toBe('audio/wav');
  });
});
