/**
 * G2 — the content-blind renderer gate (ARCHITECTURE_SPEC.md §33 G2, Phase 14).
 *
 * The renderer and everything under `src/core/**` contains no show-specific identifiers and
 * no magic rig slot names. The grep makes the property continuous rather than a one-time
 * observation, and it is the direct regression gate for F2, the hardcoded `mouth` slot.
 *
 * Scope, stated precisely:
 *
 * - The scan covers **implementation** files under `src/core` (recursively), excluding
 *   `*.test.ts`, the same boundary `src/core/animation/frame.invariants.test.ts` uses: comments
 *   are stripped, because comments legitimately discuss the rules by name, and test files are
 *   test doubles, not content. A fixture that embeds *show content* belongs in `src/data/` — a test that
 *   needs such a fixture in `src/core` would itself be the violation this gate exists to
 *   catch, and `src/data/rule3.test.ts` + `src/arch/multiseries.test.ts` prove what goes
 *   where behaviourally.
 * - "Any episode or scene id literal" means a hardcoded id in the generated shapes
 *   (`proj_`, `ep_`, `scene_`, `char.`, `env.`, …). The migration's two generic sentinels,
 *   `proj_imported` and `series_imported`, are format defaults for an unreadable id, not
 *   content, and are pinned to `serialize.ts`.
 * - The hardcoded slot name `'mouth'` is the one documented default: `mouthSlot` has not been
 *   authored yet (Phase 15), so the talk-pulse widens the part whose slot is literally
 *   `'mouth'` at `src/core/render/resolve.ts`. Every other rig-slot literal — arm/hand/thigh
 *   and the rest — is forbidden everywhere; the moment `mouthSlot` lands, no `'mouth'`
 *   literal may remain either.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const CORE_DIR = join(ROOT, 'src', 'core');

function coreFiles(dir = CORE_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...coreFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function codeOf(file: string): string {
  const source = readFileSync(file, 'utf8');
  // Comments legitimately discuss the rules by name; only code is checked.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function label(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/');
}

/** Every offending (file, line) whose line matches `banned`, with comments stripped. */
function offenders(banned: RegExp): string[] {
  const found: string[] = [];
  for (const file of coreFiles()) {
    const lines = codeOf(file).split('\n');
    lines.forEach((line, index) => {
      banned.lastIndex = 0;
      if (banned.test(line)) found.push(`${label(file)}:${index + 1} ${line.trim()}`);
    });
  }
  return found;
}

describe('G2 — the renderer is content-blind', () => {
  it('every banned token actually lives in src/data, so the gate is not vacuous', () => {
    const seed = codeOf(join(ROOT, 'src', 'data', 'seed.ts'));
    expect(seed).toMatch(/\bzanza\b/i);
    expect(seed).toMatch(/\bnia\b/i);
    expect(seed).toMatch(/2097/);
    expect(seed).toMatch(/proj_zanza/);
  });

  it('contains no show-specific token in src/core code', () => {
    const banned = /\b(?:nia|kito|zanza|sheng|nairobi|kilimani|proj_zanza)\w*|\b2097\b/gi;
    expect(offenders(banned)).toEqual([]);
  });

  it('contains no hardcoded episode or scene id literal', () => {
    const ID_LITERAL =
      /['"]((?:proj|series|ep|scene)_[a-z0-9_]+|(?:char|env|pose|expr|prop|audio|anchor|propdef)\.[a-z0-9._]+)['"]/g;
    // Format defaults in the migration: the id the document should have had, but could not
    // be read. Generic, not content — and pinned to the one file that computes them.
    const MIGRATION_SENTINELS = new Map([
      ['proj_imported', 'serialize.ts'],
      ['series_imported', 'serialize.ts'],
    ]);
    const found: string[] = [];
    for (const file of coreFiles()) {
      const lines = codeOf(file).split('\n');
      lines.forEach((line, index) => {
        const matches = [...line.matchAll(ID_LITERAL)];
        for (const match of matches) {
          const value = match[1];
          if (value === undefined) continue;
          const sentinelHome = MIGRATION_SENTINELS.get(value);
          if (sentinelHome === undefined || relative(CORE_DIR, file).includes(sentinelHome) === false) {
            found.push(`${label(file)}:${index + 1} ${line.trim()}`);
          }
        }
      });
    }
    expect(found).toEqual([]);
  });

  it('contains no magic rig slot name outside the one documented default', () => {
    // F2's regression gate. The only rig-slot literal the engine may hold is the `mouth`
    // default at resolve.ts, which exists until Phase 15 authors `mouthSlot`.
    const RIG_SLOT =
      /['"]((?:arm|thigh|shin|forearm|hand|foot|eye|brow|ear)[LR]|(?:head|torso|neck|nose|mouth|hairFront|hairBack))['"]/g;
    const DOCUMENTED_DEFAULT = 'mouth';
    const DEFAULT_HOME = 'src/core/render/resolve.ts';

    const offenders: string[] = [];
    for (const file of coreFiles()) {
      const lines = codeOf(file).split('\n');
      lines.forEach((line, index) => {
        const matches = [...line.matchAll(RIG_SLOT)];
        for (const match of matches) {
          const name = match[1];
          if (name === DOCUMENTED_DEFAULT && label(file) === DEFAULT_HOME) continue;
          offenders.push(
            `${label(file)}:${index + 1} ${line.trim()} — rig slot name outside the documented default`,
          );
        }
      });
    }
    // And the documented default must still exist where it is claimed to — a gate that
    // passes because the engine lost its talk-pulse would be a wrong kind of green.
    const resolveCode = codeOf(join(ROOT, DEFAULT_HOME));
    expect(resolveCode).toMatch(/\bslot\s*===\s*'mouth'/);
    expect(offenders).toEqual([]);
  });
});