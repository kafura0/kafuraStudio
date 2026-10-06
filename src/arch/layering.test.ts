/**
 * G12 — the layer rule gate: core stays pure (ARCHITECTURE_SPEC.md §33 G12, every phase).
 *
 * Imports flow downward only: `ui -> state -> core -> (nothing)`. Enforced continuously:
 *
 *  - no module under `src/core/**` (implementation; test files are test doubles and are
 *    allowed to import the seed, but they must never import state/ui) imports from
 *    `src/state`, `src/ui`, `src/ai`, `src/data`, or from React;
 *  - the only DOM / browser surface in core lives in files explicitly suffixed
 *    `.browser.ts` (see `docs/ARCHITECTURE.md` §The core is pure). `window.`, `document.`,
 *    `indexedDB`, and `React` are banned everywhere else. `globalThis.crypto` is not in the
 *    ban list, so the RNG and id generator stay in ordinary core files.
 *
 * The `src/ai` checks become live the phase the directory is created; until then they are
 * skipped so the gate green is meaningful rather than founded on a nonexistent tree.
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
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function srcCode(file: string): string {
  const source = readFileSync(file, 'utf8');
  // Comments may discuss the rules; code is what must obey them.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function label(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/');
}

const UPWARD_IMPORT =
  /from\s+['"](?:\.{0,2}\/|\.{2}\/)*[^'"]*(?:\/(?:state|ui|ai|data)\/)[^'"]*['"]/;
const REACT_IMPORT = /from\s+['"]react(['"]|\/)/;
const BROWSER_GLOBAL = /\b(?:window|document)\s*\.|indexedDB|\bReact\b/;

function offenders(files: string[], banned: RegExp): string[] {
  const found: string[] = [];
  for (const file of files) {
    const lines = srcCode(file).split('\n');
    lines.forEach((line, index) => {
      banned.lastIndex = 0;
      if (banned.test(line)) found.push(`${label(file)}:${index + 1} ${line.trim()}`);
    });
  }
  return found;
}

describe('G12 — imports flow downward', () => {
  const coreFiles = tsFiles(join(ROOT, 'src', 'core'));

  it('core never imports state, ui, ai, data, or React (implementation)', () => {
    const implementation = coreFiles.filter((file) => !file.endsWith('.test.ts'));
    expect(offenders(implementation, UPWARD_IMPORT)).toEqual([]);
    expect(offenders(implementation, REACT_IMPORT)).toEqual([]);
  });

  it('core never imports state, ui, ai, or data from test doubles either', () => {
    expect(offenders(coreFiles, /from\s+['"][^'"]*(?:\/(?:state|ui|ai)\/)[^'"]*['"]/)).toEqual([]);
  });

  it('browser globals exist only in explicitly-named *.browser.ts modules', () => {
    const implementation = coreFiles.filter((file) => !file.endsWith('.test.ts'));
    expect(offenders(implementation, BROWSER_GLOBAL).filter((m) => !/\.browser\.ts:\d/.test(m))).toEqual(
      [],
    );
  });

  it('data never imports state or ui', () => {
    const dataFiles = tsFiles(join(ROOT, 'src', 'data'));
    expect(dataFiles.length).toBeGreaterThan(0);
    expect(offenders(dataFiles, /from\s+['"][^'"]*(?:\/(?:state|ui)\/)[^'"]*['"]/)).toEqual([]);
  });

  it('ai respects the same boundary from the phase it exists', () => {
    const aiDir = join(ROOT, 'src', 'ai');
    if (!existsSync(aiDir)) return;
    const aiFiles = tsFiles(aiDir);
    expect(offenders(aiFiles, /from\s+['"][^'"]*(?:\/(?:state|ui)\/)[^'"]*['"]/)).toEqual([]);
  });
});