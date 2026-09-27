/**
 * Id generation.
 *
 * Ids must be stable, sortable-ish and human-readable in a JSON file. A short
 * prefixed random id is enough: collisions are checked at insertion time.
 */

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

function randomChunk(length: number): string {
  let out = '';
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  for (let i = 0; i < length; i += 1) {
    const byte = bytes[i] ?? 0;
    out += ALPHABET[byte % ALPHABET.length];
  }
  return out;
}

/** `char_ab12cd34` — prefixed so a raw id in a JSON file is self-describing. */
export function createId(prefix: string): string {
  return `${prefix}_${randomChunk(8)}`;
}

export const ID_PREFIX = {
  project: 'proj',
  episode: 'ep',
  scene: 'scene',
  actor: 'actor',
  propInstance: 'prop',
  prop: 'propdef',
  part: 'part',
  track: 'track',
  clip: 'clip',
  keyframe: 'kf',
  dialogue: 'line',
  character: 'char',
  environment: 'env',
  pose: 'pose',
  expression: 'expr',
  audio: 'audio',
  anchor: 'anchor',
} as const;
