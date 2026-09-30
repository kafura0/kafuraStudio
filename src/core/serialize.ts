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

import { STAGE_FPS, STAGE_HEIGHT, STAGE_WIDTH } from './constants';
import type { Project } from './types';
import { validateProject } from './document/invariants';
import { emptyAssetLibrary } from './document/factories';

export const CURRENT_FORMAT_VERSION = 1;

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

  const project = migrateProject(file.project, version);
  const issues = validateProject(project);
  if (issues.length > 0) {
    throw new ProjectParseError(
      `Project failed validation (${issues.length} issue${issues.length === 1 ? '' : 's'}).`,
      issues.slice(0, 12).map((i) => `${i.path}: ${i.message}`),
    );
  }
  return project;
}

/* ------------------------------------------------------------------ */
/* Migrations                                                          */
/* ------------------------------------------------------------------ */

type Migration = (project: Record<string, unknown>, from: number) => Record<string, unknown>;

/**
 * Ordered forward migrations. Index i upgrades a project from version i+1 to i+2.
 * Append new steps; never edit or reorder existing ones.
 */
const MIGRATIONS: Migration[] = [
  // v1 -> v2 (reserved, example of the shape):
  // (project) => ({ ...project, someNewField: defaultValue }),
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
      audio: asArray(assetsRaw.audio, 'assets.audio'),
    },
    cameraPresets: asArray(raw.cameraPresets, 'project.cameraPresets'),
    episodes: asArray(raw.episodes, 'project.episodes'),
    scenes: asArray(raw.scenes, 'project.scenes'),
  };
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
