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
import type { AudioDef, Project } from './types';
import { validateProject } from './document/invariants';
import { emptyAssetLibrary } from './document/factories';

// Re-exported so callers have one obvious place to ask "what version is current?", and
// so the import graph stays acyclic. Defined in `constants` because the project factory
// needs it too and `serialize` already depends on `factories`.
export { CURRENT_FORMAT_VERSION } from './constants';

export interface ProjectFile {
  formatVersion: number;
  project: Project;
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

export function serializeProject(project: Project, pretty = true): string {
  const file: ProjectFile = { formatVersion: CURRENT_FORMAT_VERSION, project };
  return JSON.stringify(file, null, pretty ? 2 : 0);
}

/* ------------------------------------------------------------------ */
/* Read                                                                */
/* ------------------------------------------------------------------ */

export function parseProject(input: string | unknown): Project {
  return readProjectFile(input).project;
}

export interface ParsedProject {
  project: Project;
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
 */
export function readProjectFile(input: string | unknown): ParsedProject {
  let raw: unknown;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      throw new ProjectParseError(
        `Not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    raw = input;
  }

  const file = asRecord(raw, 'root');
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

  const project = migrateProject(rawProject, version);
  const issues = validateProject(project);
  if (issues.length > 0) {
    throw new ProjectParseError(
      `Project failed validation (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
      issues.slice(0, 12).map((i) => `${i.path}: ${i.message}`),
    );
  }
  return { project, warnings };
}

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

type Migration = (project: Record<string, unknown>, from: number) => Record<string, unknown>;

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
    };
  },
];

/** Apply every migration needed to bring a project to the current version. */
export function migrateProject(project: unknown, fromVersion: number): Project {
  let current = asRecord(project, 'project');
  for (let version = fromVersion; version < CURRENT_FORMAT_VERSION; version += 1) {
    const migration = MIGRATIONS[version - 1];
    if (migration) current = migration(current, version);
  }
  return normaliseProject(current);
}

/**
 * Fill in anything a hand-edited file omitted.
 *
 * This is intentionally forgiving: unknown extra keys are preserved, missing
 * optional collections become empty, and numeric fields fall back to a sane
 * default. Validation runs afterwards and still rejects a structurally wrong file.
 */
export function normaliseProject(raw: Record<string, unknown>): Project {
  const assetsRaw = asRecord(raw.assets ?? {}, 'project.assets');
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
    settings: {
      width: asNumber(settingsRaw.width, STAGE_WIDTH),
      height: asNumber(settingsRaw.height, STAGE_HEIGHT),
      fps: asNumber(settingsRaw.fps, STAGE_FPS),
      autosave: typeof settingsRaw.autosave === 'boolean' ? settingsRaw.autosave : true,
    },
    assets: {
      ...emptyAssetLibrary(),
      characters: asArray(assetsRaw.characters, 'assets.characters'),
      environments: asArray(assetsRaw.environments, 'assets.environments'),
      poses: asArray(assetsRaw.poses, 'assets.poses'),
      expressions: asArray(assetsRaw.expressions, 'assets.expressions'),
      props: asArray(assetsRaw.props, 'assets.props'),
      audio: asArray(assetsRaw.audio, 'assets.audio').map(normaliseAudioDef),
    },
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
