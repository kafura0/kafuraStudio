/**
 * Golden draw logs for the acceptance scene (ARCHITECTURE_SPEC.md §18.5).
 *
 * Five beats of `EP001 "RENT IS DUE"` Scene 1 — the times listed in `docs/MVP.md` §1 —
 * each pinned as a committed, line-per-op fixture under `src/data/fixtures/golden/`.
 * A renderer change that alters a golden is either intended (regenerate and say why in
 * the commit) or a regression. The fixture is text precisely so review can *see* which
 * ops moved: a golden that is not diffable in review is a tautology, not a gate.
 *
 * Regenerate after an intended renderer change:
 *
 *   $env:REGENERATE_GOLDEN='1'; npx vitest run src/data/goldenRender.test.ts
 */

import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { SEED_PROJECT, seedContext } from './seed';
import { renderToRecording } from '../test/recordingContext';

const scene1 = SEED_PROJECT.scenes[0]!;
// Vitest runs from the repo root; jsdom's `import.meta.url` is not a file URL.
const FIXTURE_DIR = join(process.cwd(), 'src', 'data', 'fixtures', 'golden');

/**
 * The five beats, as `docs/MVP.md` §1 lists them:
 * the opening frame, Kito's walk-on landed, a subtitled line mid camera push,
 * Nia's expression change, and the final beat near the camera's pushed-in end.
 */
const GOLDEN_TIMES: readonly number[] = [0, 1.6, 3, 3.9, 9.5];

function serialise(calls: readonly { op: string; args: unknown[] }[]): string {
  return `${calls.map((c) => `${c.op} ${JSON.stringify(c.args)}`).join('\n')}\n`;
}

/** Compare as lines so a failure names the first op that moved, not a wall of text. */
function firstDivergence(actual: string, expected: string): string | null {
  const a = actual.split('\n');
  const e = expected.split('\n');
  const at = Math.max(a.length, e.length);
  for (let i = 0; i < at; i += 1) {
    if (a[i] !== e[i]) {
      return `line ${i + 1}:\n  expected: ${e[i] ?? '<end of file>'}\n  received: ${a[i] ?? '<end of file>'}`;
    }
  }
  return null;
}

describe('golden draw logs (MVP.md §1)', () => {
  for (const time of GOLDEN_TIMES) {
    it(`scene 1 at t=${time} matches its committed golden`, () => {
      const actual = serialise(renderToRecording(seedContext(), scene1, time).calls);
      const file = join(FIXTURE_DIR, `scene1-t${time}.log`);

      if (process.env.REGENERATE_GOLDEN) {
        mkdirSync(FIXTURE_DIR, { recursive: true });
        writeFileSync(file, actual, 'utf8');
      }

      const expected = readFileSync(file, 'utf8');
      const divergence = firstDivergence(actual, expected);
      if (divergence) {
        throw new Error(
          `${file} no longer matches the renderer.\n${divergence}\n` +
            'If this change is intended, regenerate the fixture (see this file\'s header) ' +
            'and explain the diff in the commit message.',
        );
      }
      expect(actual).toBe(expected);
    });
  }

  /**
   * Draw-op ceiling (ARCHITECTURE_SPEC.md §24.6).
   *
   * The golden logs say *which* ops paint a frame; this says *how many*. Baselines
   * measured when Phase 15 opened, plus ~5% headroom: an accidental double pass or
   * a per-actor loop turning into per-op work lands far above it, while legitimate
   * renderer work (R4's index is a pure refactor) does not move the count at all.
   * Raises need the same written reason a golden change does.
   */
  it('stays under the draw-op ceiling for every golden time', () => {
    const ceilings = new Map<number, number>([
      [0, 1450],
      [1.6, 1900],
      [3, 1900],
      [3.9, 1900],
      [9.5, 1900],
    ]);
    for (const time of GOLDEN_TIMES) {
      const ops = renderToRecording(seedContext(), scene1, time).calls.length;
      expect(ops, `scene 1 at t=${time}`).toBeLessThanOrEqual(ceilings.get(time)!);
    }
  });
});
