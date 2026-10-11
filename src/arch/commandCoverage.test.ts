/**
 * G6 — the command coverage gate (ARCHITECTURE_SPEC.md §33 G6, Phase 16 and every phase after).
 *
 * "Every user-visible mutation is a named command, and every command is reachable." The gate
 * has three clauses, each enforced continuously:
 *
 *  (a) no `src/ui/**` module imports a *mutating* function from `src/core/document/*Ops`;
 *      read-only lookups are permitted (see `READ_ONLY_OPS`);
 *  (b) every `commit()` call site outside `src/core/` is the store's `dispatch` seam — the one
 *      place a command's result is written to history;
 *  (c) every command registered in the vocabulary is dispatched by a UI action or the store,
 *      or emitted by `compilePlan` once the plan layer exists.
 *
 * The `src/ai`/plan checks become live from the phase those trees exist.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..', '..');

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFiles(full));
    else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function implementation(dir: string): string[] {
  return tsFiles(dir).filter((file) => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'));
}

function srcCode(file: string): string {
  const source = readFileSync(file, 'utf8');
  // Comments may discuss the rules; code is what must obey them.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function label(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/');
}

/** The ops whose results are data, not document edits. UI may import these (§33 G6). */
const READ_ONLY_OPS = new Set(['cameraClips', 'MIN_CLIP_DURATION', 'snapToEdges']);

const OPS_IMPORT = /import\s+(type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]*core\/document\/[A-Za-z]+Ops)['"]/g;

describe('G6 (a) — no UI module imports a mutating document operation', () => {
  it('UI imports only read-only lookups from document/*Ops', () => {
    const offenders: string[] = [];
    for (const file of implementation(join(ROOT, 'src', 'ui'))) {
      const code = srcCode(file);
      for (const match of code.matchAll(OPS_IMPORT)) {
        if (match[1]) continue; // `import type` — a type names the shape, it cannot mutate.
        for (const raw of (match[2] ?? '').split(',')) {
          const text = raw.trim();
          if (!text || text.startsWith('type ')) continue;
          const name = text.split(/\s+as\s+/)[0]?.trim() ?? '';
          if (name && !READ_ONLY_OPS.has(name)) {
            offenders.push(`${label(file)} imports mutating op "${name}" from ${match[3]}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('G6 (b) — every commit() outside core is the dispatch seam', () => {
  const DOCTOR = 'src/state/editorStore.ts';

  it('no file outside src/core calls commit() except the store dispatch action', () => {
    const offenders: string[] = [];
    for (const file of implementation(join(ROOT, 'src'))) {
      if (label(file).startsWith('src/core/')) continue;
      const code = srcCode(file);
      if (!/\bcommit\s*\(/.test(code)) continue;
      if (label(file) !== DOCTOR) {
        offenders.push(`${label(file)} calls commit() outside the dispatch seam`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the store commit() lives inside the dispatch action that applies a command', () => {
    const code = srcCode(join(ROOT, 'src', 'state', 'editorStore.ts'));
    const dispatchAt = code.search(/^ {4}dispatch:\s*\(/m);
    expect(dispatchAt, 'editorStore must expose a `dispatch` action').toBeGreaterThan(-1);
    // The action ends at the next 4-space-indented top-level key of the store object.
    const after = code.slice(dispatchAt + 1);
    const nextKeys = [...after.matchAll(/^ {4}[A-Za-z_]\w*:\s*[(']/gm)];
    const end = nextKeys[0] ? dispatchAt + 1 + (nextKeys[0].index ?? 0) : code.length;

    const commits: number[] = [];
    for (const match of code.matchAll(/\bcommit\s*\(/g)) {
      commits.push(match.index ?? -1);
    }
    expect(commits.length, 'the dispatch seam must be the only commit()').toBeGreaterThan(0);
    for (const at of commits) {
      expect(at).toBeGreaterThan(dispatchAt);
      expect(at).toBeLessThan(end);
    }
    // And it really is a command dispatch, not a bare commit.
    expect(code.slice(dispatchAt, end)).toMatch(/applyCommand/);
  });
});

describe('G6 (c) — every command in the vocabulary is reachable', () => {
  /**
   * Kinds registered as reference vocabulary before their editing surface exists. Each entry is
   * a deliberate, temporary exemption — remove it the phase its UI lands, or the gate stops
   * meaning "reachable". `SetActorPose` is the §7.6 reference command; pose editing is not part
   * of Phase 16.
   */
  const NOT_YET_SURFACED = new Set<string>(['SetActorPose']);

  function registeredKinds(): Set<string> {
    const kinds = new Set<string>();
    for (const file of implementation(join(ROOT, 'src', 'core', 'commands'))) {
      const code = srcCode(file);
      for (const match of code.matchAll(/defineCommand(?:\s*<[^>]*>)?\s*\(\s*'([A-Za-z]+)'/g)) {
        kinds.add(match[1] as string);
      }
    }
    return kinds;
  }

  function dispatchSurface(): string {
    const roots = ['ui', 'state', 'core/plans'];
    return roots
      .map((dir) => implementation(join(ROOT, 'src', dir)).map((file) => srcCode(file)).join('\n'))
      .join('\n');
  }

  it('every registered kind is dispatched by UI/state, emitted by a plan, or declared pending', () => {
    const surface = dispatchSurface();
    const missing = [...registeredKinds()].filter(
      (kind) => !new RegExp(`kind\\s*:\\s*['"]${kind}['"]`).test(surface) && !NOT_YET_SURFACED.has(kind),
    );
    expect(missing).toEqual([]);
  });

  it('the pending set never names a kind the registry does not define', () => {
    const kinds = registeredKinds();
    for (const kind of NOT_YET_SURFACED) expect(kinds.has(kind)).toBe(true);
  });
});
