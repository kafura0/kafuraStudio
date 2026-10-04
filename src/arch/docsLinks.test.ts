/**
 * Every path a document names must exist, or the document is lying.
 *
 * The failure this exists to catch is specific and has happened twice: `ARCHITECTURE.md`
 * cited `src/core/render/render.test.ts` as the home of the determinism test, and
 * `DATA_MODEL.md` cited `src/core/document/invariants.test.ts`. Neither file existed, and
 * because both citations read like ordinary prose, nobody could tell they were fiction.
 * A test suite is exactly the thing a reader trusts, so a document pointing at a test that
 * is not there is a small lie told in the most convincing voice available.
 *
 * ## The two tiers
 *
 * The documents are not all the same kind of thing, and holding them to one rule would be
 * wrong in both directions.
 *
 * **Current-state documents** - everything except the spec - describe what is built. A path
 * in one of those is a claim that the file is there. No exemptions; a missing path fails.
 *
 * **`ARCHITECTURE_SPEC.md`** is a design record, and it deliberately describes phases that
 * have not been built: `src/core/commands/`, `src/ai/`, `src/arch/`. Those paths are allowed
 * to be missing, but only if they appear in {@link PLANNED_PATHS} with the phase that
 * introduces them. An unlisted missing path in the spec still fails, because a typo in a
 * forward reference is still a wrong path.
 *
 * ## The list clears itself
 *
 * The rule that keeps this from being bookkeeping: a planned path that has come into
 * existence **fails** until its exemption is deleted. When Phase 16 lands
 * `src/core/commands/`, this test starts complaining, and the complaint is the reminder to
 * stop describing it as a plan. A list that only ever grows is a list nobody reads, and an
 * unmaintained list of "things that are fine not to exist" is a hole with a comment on it.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '..', '..');
const DOCS = join(ROOT, 'docs');

/**
 * Paths the spec names as future work, with the phase that introduces each.
 *
 * Adding a row here is a claim that the path is planned rather than mistaken. That claim
 * needs a phase number, because "it will exist someday" is not a claim anybody can check.
 */
const PLANNED_PATHS: Record<string, string> = {
  // Phase 14 - series and asset scope.
  'src/ui/SeriesBrowser.tsx': '14',
  // Phase 15 - engine correctness and render performance.
  'src/core/render/perf.test.ts': '15',
  // Phase 16 - commands, transactions and provenance.
  'src/core/commands/': '16',
  'src/core/commands/types.ts': '16',
  'src/core/commands/registry.ts': '16',
  'src/core/commands/compile.ts': '16',
  // Phase 17 - plans, validation and compilation.
  'src/core/plans/': '17',
  'src/core/planDiff.ts': '17',
  'src/core/continuity/': '17',
  'src/data/plans/': '17',
  'src/ui/panels/PlanEditor.tsx': '17',
  'src/ui/panels/PlanReviewPanel.tsx': '17',
  'src/state/planStore.ts': '17',
  'src/core/persistence/plans.ts': '17',
  // Phase 18 - plan review workflow.
  'src/ui/SettingsPanel.tsx': '18',
  // Phase 19 - the AI boundary.
  'src/ai/': '19',
  'src/ai/types.ts': '19',
  'src/ai/provider/': '19',
  'src/ai/capabilities/scenePlanner.ts': '19',
  // Phase 20 and later - content depth.
  'src/core/render/index.ts': '20',
  'src/core/persistence/series': '14',
  // Architecture gates named for phases 15-19.
  'src/arch/layering.test.ts': '15',
  'src/arch/contentBlindness.test.ts': '15',
  'src/arch/planIsolation.test.ts': '17',
  'src/arch/commandCoverage.test.ts': '16',
  'src/arch/mutationPath.test.ts': '16',
  'src/arch/multiseries.test.ts': '14',
};

/**
 * Paths a document discusses *as* absent, with why.
 *
 * This is not an exemption from the rule; it is the rule with the awkward case written down.
 * The spec's Phase 13 audit exists to record two citations of a test file that was never
 * written, and a document cannot make that point without naming the file. Quoting a false
 * claim is not making one. Each entry has to say which it is, because the difference is the
 * whole point: a quotation is about a file, a claim is for one.
 */
const ABSENT_BY_DESIGN: Record<string, string> = {
  'src/core/render/render.test.ts':
    "Quoted by the spec's Phase 13 audit as a citation that was never real. Corrected in ARCHITECTURE.md:251.",
};

/** The design record. Exempt from "must exist", subject to {@link PLANNED_PATHS}. */
const SPEC = 'ARCHITECTURE_SPEC.md';

function markdownFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return markdownFiles(full);
    return entry.isFile() && entry.name.endsWith('.md') ? [full] : [];
  });
}

/**
 * Path-shaped tokens, wherever they appear.
 *
 * Backticks are not required: several claims are made in table cells and bare prose, which
 * is precisely where a reader is most likely to believe them. Globs are skipped, because a
 * glob is a pattern to be searched rather than a file to be opened.
 */
function referencedPaths(text: string): { path: string; line: number; context: string }[] {
  const found: { path: string; line: number; context: string }[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    // Strip fenced code blocks: a path in a command line is an example, not a claim.
    const line = raw.replace(/```[\s\S]*/, '');
    const matches = [...line.matchAll(/(?<![\w./-])((?:src|docs)\/[A-Za-z0-9_./-]*)/g)];
    matches.forEach((match, position) => {
      const candidate = match[1] ?? '';
      if (candidate === '' || candidate.includes('*')) return;
      // The context is the text between this reference and its neighbours on the same line,
      // which is the window an absence claim has to land in to count for this path.
      const previous = matches[position - 1];
      const start = (previous?.index ?? 0) + (previous?.[1]?.length ?? 0);
      const next = matches[position + 1];
      const end = next?.index ?? line.length;
      found.push({ path: candidate, line: index + 1, context: line.slice(start, end).toLowerCase() });
    });
  });
  return found;
}

/**
 * Language that turns a path reference into a declaration that the file is *absent*.
 *
 * "See `render.test.ts` for the determinism test" claims a file is there. "`layering.test.ts`
 * does not exist yet" says the opposite, and a document has to be able to name its own gaps
 * - that is most of what an honest status section is for.
 *
 * The check is scoped to the **text between this path and its neighbours on the line**, not
 * the line and not the document. Coarser scoping was tried and rejected twice:
 *
 * - Document-scoped lets one candid sentence launder a whole file.
 * - Line-scoped lets one honest caveat excuse every other path beside it, so a false claim
 *   can hide next to a true one.
 * - Clause-scoped (splitting on `;` and em-dashes) is tighter still, but it fights ordinary
 *   writing: "the test that would enforce it does not exist yet; it is `foo.test.ts`" is one
 *   thought about one file, and the semicolon does not make it two.
 *
 * Bounding by the neighbouring path references instead keeps the window as wide as the
 * author's actual sentence about that path, and no wider. A marker only excuses a path if
 * it sits in the text immediately around that path, so a document cannot excuse a false
 * claim by sitting next to an honest one - it has to say, about that path, that it is not
 * there.
 */
const ABSENCE_MARKERS = [
  'planned',
  'plan to',
  'does not exist',
  'do not exist',
  'not exist',
  'no such',
  'unenforced',
  'unimplemented',
  'not implemented',
  'not built',
  'would enforce',
  'would be added',
  'gap',
  'future phase',
  'later phase',
  'not yet',
  'absent',
  'missing',
];

/**
 * Whether the prose immediately around this path declares it absent or planned.
 *
 * `context` is the text on the line between this path and its neighbours, so a marker has to
 * sit next to the path it is excusing. See the note on `ABSENCE_MARKERS` for why the window
 * is bounded this way rather than by sentence, clause, line or document.
 */
function declaresAbsence(reference: { path: string; context: string }): boolean {
  // The markers are phrases about the document, so the paths themselves are removed before
  // searching. Otherwise a file called `missing.test.ts` would vouch for itself.
  const withoutPaths = reference.context
    .replace(/src\/[a-z0-9_./-]*/g, '')
    .replace(/docs\/[a-z0-9_./-]*/g, '');
  return ABSENCE_MARKERS.some((marker) => withoutPaths.includes(marker));
}

const documents = markdownFiles(DOCS).map((file) => {
  const relative = file.slice(DOCS.length + 1);
  return {
    relative,
    isSpec: relative === SPEC,
    references: referencedPaths(readFileSync(file, 'utf8')),
  };
});

function toAbsolute(repoRelative: string): string {
  return join(ROOT, ...repoRelative.split('/'));
}

/**
 * Whether a path is listed as future work.
 *
 * A directory reference loses its trailing slash in prose - `src/ai/` is usually written
 * `src/ai` - so both spellings are accepted. Anything looser than that would let a typo pass
 * by being near a real entry.
 */
function isPlanned(path: string): boolean {
  return path in PLANNED_PATHS || `${path}/` in PLANNED_PATHS;
}

describe('the docs point at files that exist', () => {
  it('found the documents to check, or this test is quietly passing on nothing', () => {
    // A path-filtering bug that matched no documents would make every other test here
    // vacuously true. The count is the guard against that.
    expect(documents.length).toBeGreaterThanOrEqual(8);
    expect(documents.reduce((n, d) => n + d.references.length, 0)).toBeGreaterThan(100);
  });

  it.each(documents.map((d) => [d.relative] as const))(
    '%s names no path that does not exist',
    (relative) => {
      const doc = documents.find((d) => d.relative === relative);
      if (!doc) throw new Error('unreachable');
      const missing = doc.references.filter((ref) => !existsSync(toAbsolute(ref.path)));
      const unexplained = missing
        .filter((ref) => !declaresAbsence(ref))
        .filter((ref) => (doc.isSpec ? !isPlanned(ref.path) && !(ref.path in ABSENT_BY_DESIGN) : true));
      expect(
        unexplained.map((ref) => `line ${ref.line}: ${ref.path}`),
        doc.isSpec
          ? `${relative} names a path that does not exist and is neither listed in PLANNED_PATHS nor declared absent on the line. A forward reference has to say which phase builds it.`
          : `${relative} names a path that does not exist without saying so. Either it is a claim the file is there, or the line has to state that it is planned or absent.`,
      ).toEqual([]);
    },
  );

  it('every planned path is listed with a phase number, and every absent-by-design path with a reason', () => {
    // A planned path with no phase is a path somebody hoped for. The number is what makes
    // the claim checkable, and this is where that gets enforced. The same goes for a path a
    // document calls absent: the reason is the claim, and it has to be written down.
    const unphased = Object.entries(PLANNED_PATHS)
      .filter(([, phase]) => !/^\d+$/.test(phase))
      .map(([path]) => path);
    expect(unphased).toEqual([]);
    const unreasoned = Object.entries(ABSENT_BY_DESIGN)
      .filter(([, reason]) => reason.trim().length < 10)
      .map(([path]) => path);
    expect(unreasoned).toEqual([]);
  });

  it('a planned path that now exists has had its exemption removed', () => {
    // The rule that makes the list worth reading. When the phase lands, the file is real and
    // the spec is history, so the exemption has to go with it.
    const arrived = Object.keys(PLANNED_PATHS)
      .filter((path) => existsSync(toAbsolute(path)))
      .map((path) => `${path} (phase ${PLANNED_PATHS[path]})`);
    expect(
      arrived,
      'These files exist, so the spec no longer describes them as future work. Delete the exemption and, where the doc text still calls them planned, correct the text.',
    ).toEqual([]);
  });

  it('nothing is excused as absent while it also exists', () => {
    // The same self-clearing rule as for planned paths. A file cannot be both "was never
    // written" and sitting in the tree.
    const resurrected = Object.keys(ABSENT_BY_DESIGN)
      .filter((path) => existsSync(toAbsolute(path)))
      .map((path) => path);
    expect(resurrected).toEqual([]);
  });

  it('names no path outside the repository', () => {
    // A `src/...` reference is repo-relative by definition. A path that escapes the tree is
    // a typo, and `existsSync` would answer "no" for the wrong reason - which would surface
    // as a confusing "path does not exist" rather than "you wrote a bad path".
    //
    // `path.relative` is the correct containment test. Comparing prefixes looks like it works
    // and does not: `C:\repo-2` starts with `C:\repo`, so a sibling directory whose name
    // extends the repository's own would pass a `startsWith(ROOT)` check.
    const escaped = documents
      .flatMap((d) => d.references)
      .filter((ref) => {
        const rel = relative(ROOT, toAbsolute(ref.path));
        return rel.startsWith('..') || isAbsolute(rel);
      })
      .map((ref) => `${ref.path} (line ${ref.line})`);
    expect(escaped).toEqual([]);
  });

  it('an absence claim excuses only the path it sits beside', () => {
    // The regression this guards is subtle enough to be worth pinning. Scoping the absence
    // markers to the whole line let one honest caveat excuse every other path on that line,
    // so a document could claim a file exists while the same sentence said a different file
    // was planned.
    const line =
      '`docs/real.md` points at `src/nope.ts`; `docs/also-planned.md` is still planned.';
    const byPath = (path: string) => {
      const reference = referencedPaths(line).find((r) => r.path === path);
      if (reference === undefined) throw new Error(`no reference to ${path} in the fixture`);
      return reference;
    };

    // The false claim is on the left, its neighbour's honest marker on the right. The
    // marker must not carry across.
    expect(declaresAbsence(byPath('src/nope.ts'))).toBe(false);
    expect(declaresAbsence(byPath('docs/real.md'))).toBe(false);
    // The marker is in this path's own window, so it is excused.
    expect(declaresAbsence(byPath('docs/also-planned.md'))).toBe(true);
  });

  it('accepts a semicolon-joined sentence about one missing file', () => {
    // The reason the window is bounded by neighbouring paths rather than by clause
    // boundaries. This is one thought about one file, and a semicolon does not split it.
    const line = '`src/arch/layering.test.ts` does not exist yet; it is named as planned.';
    const reference = referencedPaths(line)[0];
    if (reference === undefined) throw new Error('no reference parsed from the fixture');
    expect(reference.path).toBe('src/arch/layering.test.ts');
    expect(declaresAbsence(reference)).toBe(true);
  });
});
