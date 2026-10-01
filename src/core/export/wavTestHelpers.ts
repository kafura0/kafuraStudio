/**
 * Test helpers for reading a WAV file back.
 *
 * Kept out of the test file so `mixdown.browser.test.ts` and `wav.test.ts` can both use
 * them, and so the reader is obviously independent of the encoder: it parses the bytes
 * from scratch rather than asking the encoder what it thinks it wrote.
 */

/** An `AudioBuffer` stand-in for encoding, which never touches Web Audio. */
export function fakeBuffer(frames: number, channels = 2, sampleRate = 48_000): AudioBuffer {
  const data: Float32Array[] = [];
  for (let c = 0; c < channels; c++) data.push(new Float32Array(frames));
  return {
    numberOfChannels: channels,
    length: frames,
    sampleRate,
    duration: frames / sampleRate,
    getChannelData: (c: number) => data[c] ?? new Float32Array(frames),
  } as unknown as AudioBuffer;
}

export interface ParsedWav {
  riff: string;
  riffSize: number;
  wave: string;
  fmt: string;
  format: number;
  channels: number;
  sampleRate: number;
  byteRate: number;
  blockAlign: number;
  bitsPerSample: number;
  data: string;
  dataSize: number;
  /** Interleaved samples, scaled back to [-1, 1]. */
  samples: number[];
}

/** Chunk tag at an offset, as the four characters the file actually stores. */
function fourCC(view: DataView, offset: number): string {
  let out = '';
  for (let i = 0; i < 4; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

/**
 * Parse a 16-bit PCM WAV, walking the chunk list rather than assuming the 44-byte header
 * layout. A parser that hard-codes offsets would pass on a file the encoder wrote and fail
 * on one from anywhere else, which is not a useful check.
 */
export function parseWav(bytes: ArrayBuffer): ParsedWav {
  const view = new DataView(bytes);
  // 'WAVE' is the form type sitting directly after the RIFF size, not a chunk. Reading it
  // as a chunk would make the whole parse start one field late.
  const out: Partial<ParsedWav> = {
    riff: fourCC(view, 0),
    riffSize: view.getUint32(4, true),
    wave: fourCC(view, 8),
  };

  let offset = 12;
  while (offset + 8 <= bytes.byteLength) {
    const id = fourCC(view, offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;

    if (id === 'fmt ') {
      out.fmt = id;
      out.format = view.getUint16(body, true);
      out.channels = view.getUint16(body + 2, true);
      out.sampleRate = view.getUint32(body + 4, true);
      out.byteRate = view.getUint32(body + 8, true);
      out.blockAlign = view.getUint16(body + 12, true);
      out.bitsPerSample = view.getUint16(body + 14, true);
    } else if (id === 'data') {
      out.data = id;
      out.dataSize = size;
      const samples: number[] = [];
      const count = Math.min(size, bytes.byteLength - body) / 2;
      for (let i = 0; i < count; i++) {
        const raw = view.getInt16(body + i * 2, true);
        samples.push(raw < 0 ? raw / 0x8000 : raw / 0x7fff);
      }
      out.samples = samples;
    }

    // Chunks are word-aligned, so an odd size is followed by a pad byte.
    offset = body + size + (size % 2);
  }

  return out as ParsedWav;
}

/**
 * `parseWav` for the encoder's `Uint8Array`.
 *
 * Takes bytes rather than a `Blob` because jsdom's `Blob` has no `arrayBuffer()`, so a
 * `Blob`-shaped encoder could not be parsed back at all — and an encoder that cannot be
 * parsed back can only be checked against the header numbers it wrote about itself.
 */
export function readWav(bytes: Uint8Array): ParsedWav {
  return parseWav(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
  );
}
