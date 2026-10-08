/**
 * The adaptive undo cap (ARCHITECTURE_SPEC.md §22.4).
 *
 * The store consumes `historyLimitFor` at every commit/undo/redo; these unit tests pin
 * the function's contract — ceiling stays at `HISTORY_LIMIT`, the floor keeps undo
 * usable at any document size, and the limit really does shrink as the document grows.
 */

import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT } from '../constants';
import { createProject } from './factories';
import { HISTORY_LIMIT_MIN, historyLimitFor } from './history';

const HISTORY_BUDGET_UNITS = 2_000_000;

describe('historyLimitFor', () => {
  it('keeps the full ceiling for a small document', () => {
    expect(historyLimitFor(createProject('tiny'))).toBe(HISTORY_LIMIT);
  });

  it('sits inside the intended range once a document is past the seed-with-settings size', () => {
    const mid = { ...createProject('mid'), description: 'x'.repeat(50_000) };
    expect(historyLimitFor(mid)).toBeGreaterThanOrEqual(HISTORY_LIMIT_MIN);
    expect(historyLimitFor(mid)).toBeLessThan(HISTORY_LIMIT);
  });

  it('shrinks the cap as the document grows', () => {
    const small = createProject('small');
    const growing = { ...createProject('growing'), description: 'x'.repeat(100_000) };
    expect(historyLimitFor(growing)).toBeLessThan(historyLimitFor(small));
  });

  it('never drops below the floor, however large the document gets', () => {
    const huge = { ...createProject('huge'), description: 'x'.repeat(HISTORY_BUDGET_UNITS) };
    expect(historyLimitFor(huge)).toBe(HISTORY_LIMIT_MIN);
  });

  it('leaves the document untouched', () => {
    const project = createProject('untouched');
    const before = JSON.stringify(project);
    historyLimitFor(project);
    expect(JSON.stringify(project)).toBe(before);
  });
});