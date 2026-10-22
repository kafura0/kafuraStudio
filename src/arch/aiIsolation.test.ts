/**
 * G3 — the AI isolation gate (ARCHITECTURE_SPEC.md §33 G3, §12.4, §24.10).
 *
 * Removing all AI code leaves the editor fully functional. Two properties make that true
 * and both are checked here, statically:
 *
 *  1. No module outside `src/ai/**` **statically** imports `src/ai/**`. AI-only UI uses a
 *     dynamic `import()`, which disappears from the build when the directory is gone.
 *  2. No provider name appears in any `src/core/**` type or switch: the engine depends on
 *     plan and command vocabulary, never on a vendor.
 *
 * The static check is the load-bearing one. Deleting `src/ai/**` and re-running the suite
 * is the manual confirmation; this test makes the failure a red gate instead of a surprise.
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

function label(file: string): string {
  return relative(ROOT, file).replace(/\\/g, '/');
}

/** Strip comments so prose that *discusses* AI does not read as an import. */
function code(file: string): string {
  return readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/** A static `import ... from '<path>/ai/...'` or `'../ai'`. Not `import()`. */
const STATIC_AI_IMPORT = /^\s*import\s[^;]*?from\s+['"](?:[^'"]*\/(?:ai)\/[^'"]*|[^'"]*\/ai)['"]/m;

const PROVIDER_NAMES = ['anthropic', 'openai', 'gemini', 'google', 'claude', 'gpt'];

describe('G3 — AI isolation', () => {
  it('no module outside src/ai/** statically imports src/ai/**', () => {
    const offenders: string[] = [];
    for (const dir of ['core', 'state', 'data', 'ui', 'lib']) {
      for (const file of tsFiles(join(ROOT, 'src', dir))) {
        const lines = code(file).split('\n');
        lines.forEach((line, index) => {
          if (STATIC_AI_IMPORT.test(line)) offenders.push(`${label(file)}:${index + 1} ${line.trim()}`);
        });
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no provider name appears in a src/core type or switch', () => {
    const offenders: string[] = [];
    // Test files are test doubles: a fixture may legitimately name a provider it stands in
    // for. The rule is about implementation — a type, a switch, a default, a branch.
    const implementation = tsFiles(join(ROOT, 'src', 'core')).filter((file) => !file.endsWith('.test.ts'));
    for (const file of implementation) {
      const source = code(file);
      for (const name of PROVIDER_NAMES) {
        const pattern = new RegExp(`['"\`]${name}`, 'i');
        if (pattern.test(source)) offenders.push(`${label(file)} names "${name}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('src/ai/** never imports src/state, src/ui, core/document, or the command registry', () => {
    const offenders: string[] = [];
    const banned = /from\s+['"][^'"]*(?:\/(?:state|ui)\/|core\/document\/|core\/commands\/(?:registry|index))[^'"]*['"]/;
    for (const file of tsFiles(join(ROOT, 'src', 'ai'))) {
      const lines = code(file).split('\n');
      lines.forEach((line, index) => {
        if (banned.test(line)) offenders.push(`${label(file)}:${index + 1} ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
