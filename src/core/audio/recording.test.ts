/**
 * The recording predicate — pure core.
 *
 * Small, and load-bearing: it is the only thing standing between the UI and a claim
 * that a file exists when it does not (RULE 9). Every branch it can take is pinned.
 */
import { describe, expect, it } from 'vitest';
import { hasRecording } from './recording';
import type { AudioDef } from '../types';

function slot(src: string | null): AudioDef {
  return { id: 'a', name: 'A', kind: 'dialogue', src, srcKind: null, duration: 1, tags: [] };
}

describe('hasRecording', () => {
  it('is false for a declared slot with no file, which is how the library ships', () => {
    expect(hasRecording(slot(null))).toBe(false);
  });

  it('is true once a slot points at a file', () => {
    expect(hasRecording(slot('audio/ep001/nia-line1.wav'))).toBe(true);
  });

  it('treats an empty or blank path as missing, not as a URL of the current page', () => {
    expect(hasRecording(slot(''))).toBe(false);
    expect(hasRecording(slot('   '))).toBe(false);
  });

  it('is false for no asset at all, so a dangling voice reference reads as missing', () => {
    expect(hasRecording(null)).toBe(false);
    expect(hasRecording(undefined)).toBe(false);
  });
});
