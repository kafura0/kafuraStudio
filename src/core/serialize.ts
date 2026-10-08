/**
 * Project serialization.
 *
 * The on-disk shape is `{ formatVersion, project }`. Version 1 is the shape in
 * `docs/DATA_MODEL.md`. `migrateProject` is an ordered list of forward migrations,
 * so a project saved by an older build keeps opening.
 *
 * Parsing is defensive: an untrusted or hand-edited file must never crash the
 * editor, and must never enter it in a state that violates an invariant.
 */

import { CURRENT_FORMAT_VERSION, STAGE_FPS, STAGE_HEIGHT, STAGE_WIDTH } from './constants';
import type { AssetLibrary, AudioDef, CharacterDef, Project, SeriesDef, SubtitleStyle } from './types';
import { validateProject, validateSeries, type ValidationMode } from './document/invariants';
import { emptyAssetLibrary } from './document/factories';
import { DEFAULT_MOUTH_SLOT } from './render/resolve';
import { DEFAULT_SUBTITLE_STYLE } from './render/render';

// Re-exported so callers have one obvious place to ask "what version is current?", and
// so the import graph stays acyclic. Defined in `constants` because the project factory
// needs it too and `serialize` already depends on `factories`.
export { CURRENT_FORMAT_VERSION } from './constants';

export interface ProjectFile {
  formatVersion: number;
  project: Project;
  /**
   * The series the project draws from, when it has one.
   *
   * Optional because a free project names none, and because a row written by the repository
   * does not need to repeat what the workspace already holds. A file *meant to travel* should
   * always carry it — see `serializeProjectFile`.
   */
  series?: SeriesDef;
}

export class ProjectParseError extends Error {
  readonly issues: string[];

  constructor(message: string, issues: string[] = []) {
    super(message);
    this.name = 'ProjectParseError';
    this.issues = issues;
  }
}

/* ------------------------------------------------------------------ */
/* Write                                                               */
/* ------------------------------------------------------------------ */

/**
 * Serialise one production document.
 *
 * The series is **not** written here, and that is not an oversight. It is the whole of
 * §5.5: a project file is portable on its own terms, and the series it names is adopted from
 * the destination library when it imports. Writing the series inline would turn every
 * export into a second copy of a shared library and make importing two projects of one show
 * silently fork it.
 */
export function serializeProject(project: Project, pretty = true): string {
  const file: ProjectFile = { formatVersion: CURRENT_FORMAT_VERSION, project };
  return JSON.stringify(file, null, pretty ? 2 : 0);
}

/**
 * Serialise a project *together with the series it depends on*, for a file meant to travel.
 *
 * A file carrying only the project is not portable, and portability is the whole point of
 * exporting one. Since Phase 14 the project holds almost nothing: the library it draws from
 * lives on its series, so a v3 project written on its own reopens as an empty stage on any
 * machine that does not already have that exact series — with no error, because every id in
 * the document resolves, just not to anything.
 *
 * This is the same reason the repository stores the project on its own. There, the series is
 * always present in the workspace that reads the row back; here, it may not be.
 *
 * Throws when the project names a series and no series is supplied. The alternative — writing
 * the file anyway, minus the library — is the silent failure above.
 */
export function serializeProjectFile(
  project: Project,
  series: SeriesDef | null,
  pretty = true,
): string {
  if (project.seriesId !== null && series === null) {
    throw new ProjectParseError(
      `Refusing to export "${project.id}" without the series it names (${project.seriesId}); ` +
        `the file would reopen as an empty stage.`,
    );
  }
  const file: ProjectFile = { formatVersion: CURRENT_FORMAT_VERSION, project };
  if (series !== null) file.series = series;
  return JSON.stringify(file, null, pretty ? 2 : 0);
}

/** Serialise a series, for the `SeriesRepository` row and for manual inspection. */
export function serializeSeries(series: SeriesDef, pretty = true): string {
  return JSON.stringify({ formatVersion: CURRENT_FORMAT_VERSION, series }, null, pretty ? 2 : 0);
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export function parseProject(input: string | unknown): Project {
  return readProjectFile(input).project;
}

/**
 * Read a series back out of its envelope.
 *
 * The counterpart to `serializeSeries`, and the only place that knows a series document is
 * `{ formatVersion, series }`. A repository that unwrapped the envelope itself would be one
 * more copy of that fact, and it would be the copy that breaks: handing the whole envelope to
 * `normaliseSeries` does not throw, it returns a series with a default id and an empty
 * library, and the failure then surfaces as a workspace that has lost a show.
 *
 * There is no migration ladder here on purpose. The format version is a property of the
 * project document, and a series is only ever read alongside the project that names it —
 * which was itself migrated. Migrating a series independently would let the two halves
 * disagree about a version they are supposed to share.
 */
export function parseSeries(input: string | unknown): SeriesDef {
  const file = asRecord(parseJson(input), 'root');
  const version = typeof file.formatVersion === 'number' ? file.formatVersion : 1;
  if (version > CURRENT_FORMAT_VERSION) {
    throw new ProjectParseError(
      `Series format version ${version} is newer than this build supports (${CURRENT_FORMAT_VERSION}).`,
    );
  }
  if (!('series' in file)) {
    throw new ProjectParseError('Missing `series` key.');
  }
  const series = normaliseSeries(asRecord(file.series, 'series'));
  const issues = validateSeries(series);
  if (issues.length > 0) {
    throw new ProjectParseError(
      `Series failed validation (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
      issues.slice(0, 12).map((i) => `${i.path}: ${i.message}`),
    );
  }
  return series;
}

export interface ParsedProject {
  project: Project;
  /**
   * The series a pre-v3 document implies, or `null` for one that already names its own.
   *
   * A v2 document kept its library inline, so on open there is a series to adopt and it
   * does not exist anywhere else. `null` here means "this document knows its own owner" —
   * not "there is no series", which for a free project is expressed by
   * `project.seriesId === null` instead.
   */
  series: SeriesDef | null;
  /**
   * Things that were recoverable and were corrected.
   *
   * Separate from `ProjectParseError.issues` on purpose: a warning is not a reason to
   * refuse a file. Discarding the distinction is how "the project opened but something
   * was wrong with it" becomes indistinguishable from "the project opened".
   */
  warnings: string[];
}

/**
 * Parse, migrate and validate, reporting anything that had to be corrected.
 *
 * `parseProject` keeps its narrower signature because it is called from three places and
 * only one of them can show a warning to a user. The version ladder is driven by the
 * *outer* `ProjectFile.formatVersion`, never the copy inside the project: the outer field
 * is written by the serializer on every save, so it is the one that is actually
 * trustworthy, and a hand-edited inner value must not be able to send a v1 document down
 * a v2 migration it was never written for.
 *
 * Validation runs against the *merged* library. A migrated project carries no assets of its
 * own, so validating it against `project.assets` would report every character in the show
 * as unknown — which is the correct answer to the wrong question.
 */
export function readProjectFile(
  input: string | unknown,
  options: { mode?: ValidationMode } = {},
): ParsedProject {
  const file = asRecord(parseJson(input), 'root');
  const version = typeof file.formatVersion === 'number' ? file.formatVersion : 1;
  if (version > CURRENT_FORMAT_VERSION) {
    throw new ProjectParseError(
      `Project format version ${version} is newer than this build supports (${CURRENT_FORMAT_VERSION}).`,
    );
  }
  if (!('project' in file)) {
    throw new ProjectParseError('Missing `project` key.');
  }

  const warnings: string[] = [];
  const rawProject = file.project;
  if (typeof rawProject === 'object' && rawProject !== null && !Array.isArray(rawProject)) {
    const inner = (rawProject as Record<string, unknown>).formatVersion;
    if (typeof inner === 'number' && inner !== version) {
      warnings.push(
        `The file declares format version ${version} but the project inside declares ` +
          `${inner}. Using ${version}; the inner value is more likely to be wrong.`,
      );
    }
  }

  const { project, series } = migrateProjectRecord(rawProject, version, file.series);
  // Default mode is `load`: a file arriving from the outside is refused unless it is
  // sound, and in `load` mode every colour-key issue is an error (§18.2 R3). The one
  // caller that re-reads the workspace's own rows — the IndexedDB repository — passes
  // `authoring` instead, so a document it wrote is never quarantined over a colour-key
  // warning: the warning is surfaced by IssuePanel once the project is open.
  const issues = validateProject(project, series, { mode: options.mode ?? 'load' });
  const errors = issues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new ProjectParseError(
      `Project failed validation (${errors.length} issue${errors.length === 1 ? '' : 's'}).`,
      errors.slice(0, 12).map((i) => `${i.path}: ${i.message}`),
    );
  }
  for (const issue of issues) {
    if (issue.severity === 'warning') warnings.push(`${issue.path}: ${issue.message}`);
  }
  return { project, series, warnings };
}

/**
 * Migrate a file and hand back both halves.
 *
 * This is the new entry point for the one caller that needs the series: the importer. §6.3
 * chose this over changing `parseProject`'s return type because that function has three
 * callers and only one of them has a use for the answer.
 *
 * `input` is a whole `ProjectFile`, not a bare project, because the ladder is driven by the
 * outer version field — see `readProjectFile`.
 */
export function migrateProjectFile(
  input: string | unknown,
  options: { mode?: ValidationMode } = {},
): ParsedProject {
  return readProjectFile(input, options);
}

function parseJson(input: string | unknown): unknown {
  if (typeof input !== 'string') return input;
  try {
    return JSON.parse(input);
  } catch (error) {
    throw new ProjectParseError(
      `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

/**
 * What one migration step produced.
 *
 * `series` is present only for the step that introduces the concept. A step that does not
 * touch it leaves it `undefined` and the running value is carried forward untouched, which
 * is what keeps the ladder composable: a v1 document climbs v1→v2→v3 and the series only
 * appears at the top.
 */
interface MigrationResult {
  project: Record<string, unknown>;
  series?: Record<string, unknown>;
}

type Migration = (project: Record<string, unknown>, from: number) => MigrationResult;

/**
 * Ordered forward migrations. Index i upgrades a project from version i+1 to i+2.
 * Append new steps; never edit or reorder existing ones.
 *
 * Every step must be additive and idempotent. A migration that renumbers an id or
 * rewrites a `Keyframe.time` would break the join keys a user may hold references to,
 * and one that is not idempotent would make a re-imported file land somewhere different
 * from the original.
 */
const MIGRATIONS: Migration[] = [
  /**
   * v1 -> v2: `AudioDef.srcKind` and `Project.metadata`.
   *
   * Two additive fields, both defaulting to the honest empty answer. A v1 record has no
   * `srcKind`, and the tempting thing is to infer it — a `src` that looks like a path is
   * `'external'`, anything else is `'local'`. That inference is exactly the bug this
   * field exists to prevent, so the migration refuses to guess: every pre-v2 slot comes
   * out `srcKind: null`, which the UI reports as "no file", which is what it is. An
   * operator re-attaches the recording and the slot is honest again.
   */
  (project) => {
    const assets = asRecord(project.assets ?? {}, 'project.assets');
    const audio = Array.isArray(assets.audio) ? assets.audio : [];

    return {
      project: {
        ...project,
        assets: {
          ...assets,
          audio: audio.map((def) => {
            if (typeof def !== 'object' || def === null || Array.isArray(def)) return def;
            const record = def as Record<string, unknown>;
            // Only fill it in. A record that already declares one is not second-guessed,
            // which is what makes re-running this a no-op.
            if ('srcKind' in record) return record;
            return { ...record, srcKind: null };
          }),
        },
        metadata: {
          archived: null,
          duplicatedFrom: null,
          snapshotOf: null,
          ...asRecord(project.metadata ?? {}, 'project.metadata'),
        },
      },
    };
  },

  /**
   * v2 -> v3: the asset library moves from the project to a series.
   *
   * The one step in the ladder that *moves* rather than adds, and the only one that can
   * produce a second document. Everything else in it is deliberately boring:
   *
   * - **Assets move, they are not copied.** `P'.assets` is empty, so nothing is duplicated
   *   and editing the series is what every project of that show sees.
   * - **The series id is derived, not minted.** `'series_' + id.replace(/^proj_/, '')` is a
   *   pure function of the project id, so migrating the same document twice — or importing
   *   it into two libraries — lands in one series rather than two half-shared ones. That is
   *   a correctness property, not a convenience.
   * - **Ids survive.** No asset id, scene id, keyframe time or track order is touched (§6.4).
   * - **The fallbacks are the ones `normaliseProject` uses.** A project with no `id` becomes
   *   `proj_imported`; if the migration guessed a different id the project would end up
   *   naming a series that nothing else agrees on.
   */
  (project) => {
    // Already migrated. Re-running must be free, and this is the only way that can be
    // guaranteed: a v3 document carries `seriesId` and the step below would otherwise
    // rebuild the series from an empty override library and *lose it*.
    if ('seriesId' in project) return { project };

    const projectId = asString(project.id, 'proj_imported');
    const seriesId = `series_${projectId.replace(/^proj_/, '')}`;

    return {
      project: {
        ...project,
        seriesId,
        assets: {},
      },
      series: {
        id: seriesId,
        name: asString(project.name, 'Untitled Project'),
        description: asString(project.description, ''),
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        formatVersion: CURRENT_FORMAT_VERSION,
        assets: project.assets ?? {},
        metadata: {},
      },
    };
  },
];

/**
 * Climb the ladder, collecting the series a migration produced.
 *
 * Kept separate from `migrateProject` so that the narrower, widely-used function can keep
 * returning only a project while callers that care about the series get it (§6.3, option ii).
 */
function migrateProjectRecord(
  project: unknown,
  fromVersion: number,
  /** A series carried by the file itself, if it declares one. */
  carried?: unknown,
): MigratedProject {
  let current = asRecord(project, 'project');
  let series: Record<string, unknown> | undefined;
  for (let version = fromVersion; version < CURRENT_FORMAT_VERSION; version += 1) {
    const migration = MIGRATIONS[version - 1];
    if (migration) {
      const result = migration(current, version);
      current = result.project;
      if (result.series !== undefined) series = result.series;
    }
  }
  // A carried series wins over a derived one, and only when the project actually names it.
  // The alternative — taking whichever was found last — would let a file claim a library the
  // project does not point at, and every reference in the document would then resolve against
  // the wrong one. A file that carries a series its project does not name is not an error: the
  // importer creates a fresh one and says so.
  if (carried !== undefined && carried !== null) {
    const fromFile = normaliseSeries(asRecord(carried, 'series'));
    if (current.seriesId === fromFile.id) series = { ...fromFile };
  }
  return {
    project: normaliseProject(current),
    series: series === undefined ? null : normaliseSeries(series),
  };
}

export interface MigratedProject {
  project: Project;
  series: SeriesDef | null;
}

/** Apply every migration needed to bring a project to the current version. */
export function migrateProject(project: unknown, fromVersion: number): Project {
  return migrateProjectRecord(project, fromVersion).project;
}

/**
 * Fill in anything a hand-edited file omitted.
 *
 * This is intentionally forgiving: unknown extra keys are preserved, missing
 * optional collections become empty, and numeric fields fall back to a sane
 * default. Validation runs afterwards and still rejects a structurally wrong file.
 */
export function normaliseProject(raw: Record<string, unknown>): Project {
  const settingsRaw = asRecord(raw.settings ?? {}, 'project.settings');
  const metadataRaw = asRecord(raw.metadata ?? {}, 'project.metadata');

  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();

  return {
    id: asString(raw.id, 'proj_imported'),
    name: asString(raw.name, 'Untitled Project'),
    description: asString(raw.description, ''),
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
    formatVersion: CURRENT_FORMAT_VERSION,
    seriesId: asNullableString(raw.seriesId),
    settings: {
      width: asNumber(settingsRaw.width, STAGE_WIDTH),
      height: asNumber(settingsRaw.height, STAGE_HEIGHT),
      fps: asNumber(settingsRaw.fps, STAGE_FPS),
      autosave: typeof settingsRaw.autosave === 'boolean' ? settingsRaw.autosave : true,
      // Carried only when the document declares one: the renderer falls back to its
      // defaults when the field is absent, so injecting one here would change nothing
      // on screen and churn every round-trip of a doc that never chose a style.
      ...(settingsRaw.subtitleStyle === undefined
        ? {}
        : { subtitleStyle: normaliseSubtitleStyle(settingsRaw.subtitleStyle) }),
    },
    assets: normaliseAssetLibrary(raw.assets),
    cameraPresets: asArray(raw.cameraPresets, 'project.cameraPresets'),
    episodes: asArray(raw.episodes, 'project.episodes'),
    scenes: asArray(raw.scenes, 'project.scenes'),
    metadata: {
      archived: asIsoDate(metadataRaw.archived),
      duplicatedFrom: asNullableString(metadataRaw.duplicatedFrom),
      snapshotOf: asNullableString(metadataRaw.snapshotOf),
    },
  };
}

/**
 * Fill in anything a hand-edited series record omitted.
 *
 * Deliberately shares `normaliseAssetLibrary` with the project rather than restating it. A
 * library that is forgiving on one scope and strict on the other would mean the same asset
 * is valid in a project and invalid in a series, and there is no sense in which that is
 * true.
 */
export function normaliseSeries(raw: Record<string, unknown>): SeriesDef {
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  return {
    id: asString(raw.id, 'series_imported'),
    name: asString(raw.name, 'Untitled Series'),
    description: asString(raw.description, ''),
    createdAt,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt,
    formatVersion: CURRENT_FORMAT_VERSION,
    assets: normaliseAssetLibrary(raw.assets),
    // Carried rather than dropped. Camera presets live on the series as the reusable layer
    // of the same choice, so a normaliser that omitted the field would quietly delete a
    // show's shot vocabulary on the first save of a series document — a loss that only
    // becomes visible next time somebody reaches for a shot and it is gone.
    ...(raw.cameraPresets === undefined
      ? {}
      : { cameraPresets: asArray(raw.cameraPresets, 'series.cameraPresets') }),
    metadata: asRecord(raw.metadata ?? {}, 'series.metadata'),
  };
}

function normaliseAssetLibrary(value: unknown): AssetLibrary {
  const assetsRaw = asRecord(value ?? {}, 'assets');
  return {
    ...emptyAssetLibrary(),
    characters: asArray(assetsRaw.characters, 'assets.characters').map(normaliseCharacter),
    environments: asArray(assetsRaw.environments, 'assets.environments'),
    poses: asArray(assetsRaw.poses, 'assets.poses'),
    expressions: asArray(assetsRaw.expressions, 'assets.expressions'),
    props: asArray(assetsRaw.props, 'assets.props'),
    audio: asArray(assetsRaw.audio, 'assets.audio').map(normaliseAudioDef),
  };
}

/**
 * Fill in the character defaults a document may legitimately omit.
 *
 * Only `mouthSlot` has a default to fill: `'mouth'` is the rig convention every
 * current character uses, and defaulting it here is what lets a pre-Phase-15
 * document open with no migration at all (ARCHITECTURE_SPEC.md §18.2 R2). The
 * constant is imported rather than restated so the literal slot name has exactly
 * one home in `src/core` — the G2 content-blindness gate allows it only there.
 */
function normaliseCharacter(value: unknown): CharacterDef {
  const record = asRecord(value, 'assets.characters[]');
  return {
    ...record,
    mouthSlot: asString(record.mouthSlot, DEFAULT_MOUTH_SLOT),
  } as CharacterDef;
}

/**
 * Fill in the subtitle style defaults a declared-but-partial object omitted.
 *
 * `ProjectSettings.subtitleStyle` is itself optional — a document that never mentions a
 * style renders with the renderer's defaults — so the style is only normalised when the
 * field is present (see `normaliseProject`), and this then gives that partial object the
 * fields its author skipped.
 */
function normaliseSubtitleStyle(value: unknown): SubtitleStyle {
  const raw = asRecord(value, 'project.settings.subtitleStyle');
  return {
    font: asString(raw.font, DEFAULT_SUBTITLE_STYLE.font),
    textColor: asString(raw.textColor, DEFAULT_SUBTITLE_STYLE.textColor),
    boxColor: asString(raw.boxColor, DEFAULT_SUBTITLE_STYLE.boxColor),
    boxOpacity: asNumber(raw.boxOpacity, DEFAULT_SUBTITLE_STYLE.boxOpacity),
    boxHeight: asNumber(raw.boxHeight, DEFAULT_SUBTITLE_STYLE.boxHeight),
    lineHeight: asNumber(raw.lineHeight, DEFAULT_SUBTITLE_STYLE.lineHeight),
    maxWidthRatio: asNumber(raw.maxWidthRatio, DEFAULT_SUBTITLE_STYLE.maxWidthRatio),
  };
}

/**
 * An audio slot, with `srcKind` coerced to a value the type admits.
 *
 * An unrecognised `srcKind` becomes `null` rather than passing through. The difference
 * matters: a slot with `srcKind: 'local'` and no media id would claim a recording exists
 * when none can be loaded, and every honest-reporting surface in the app asks
 * `hasRecording` first.
 */
function normaliseAudioDef(value: unknown): AudioDef {
  const record = asRecord(value, 'assets.audio[]');
  const srcKind = record.srcKind;
  return {
    ...record,
    src: typeof record.src === 'string' ? record.src : null,
    srcKind: srcKind === 'local' || srcKind === 'external' ? srcKind : null,
    duration: asNumber(record.duration, 0),
    tags: asArray<string>(record.tags, 'assets.audio[].tags'),
  } as AudioDef;
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function asIsoDate(value: unknown): string | null {
  const text = asNullableString(value);
  if (text === null) return null;
  return Number.isNaN(Date.parse(text)) ? null : text;
}

/* ------------------------------------------------------------------ */
/* Coercion helpers                                                    */
/* ------------------------------------------------------------------ */

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new ProjectParseError(`Expected an object at \`${path}\`.`);
  }
  return value as Record<string, unknown>;
}

function asArray<T>(value: unknown, path: string): T[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ProjectParseError(`Expected an array at \`${path}\`.`);
  }
  return value as T[];
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
