import { describe, expect, it } from 'vitest';
import { fixedClock, makeCountingAllocator } from './allocator';

describe('makeCountingAllocator', () => {
  it('hands out padded, sortable ids in call order', () => {
    const allocate = makeCountingAllocator();

    expect(allocate('scene')).toBe('scene_0001');
    expect(allocate('actor')).toBe('actor_0002');
    expect(allocate('clip')).toBe('clip_0003');
  });

  it('is independent per instance', () => {
    const first = makeCountingAllocator();
    const second = makeCountingAllocator();

    first('scene');
    expect(second('scene')).toBe('scene_0001');
  });

  it('honours a seed', () => {
    expect(makeCountingAllocator(7)('clip')).toBe('clip_0007');
  });
});

describe('fixedClock', () => {
  it('always returns the same instant', () => {
    const now = fixedClock('2026-10-16T00:00:00.000Z');

    expect(now()).toBe('2026-10-16T00:00:00.000Z');
    expect(now()).toBe(now());
  });
});
