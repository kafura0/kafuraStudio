/**
 * Project import, export and duplication.
 *
 * Three operations that look like one feature and are not. They differ entirely in
 * which ids they mint, and that difference is the whole point:
 *
 * - **Export** writes the document as it is. Nothing is renumbered, so an exported file
 *   re-opens to the same document byte for byte.
 * - **Import** adopts nothing. The file's identity is discarded — a new project id, a
 *   default name — and its scene-local ids are left alone, because the imported file is
 *   a standalone document that will not be sitting next to another copy of itself.
 * - **Duplicate** copies a project that *is* already in this database, so every
 *   scene-local id is reminted to keep selection, keyframe lookup and per-scene address
 *   unambiguous. Asset ids are shared on purpose: a duplicated project reusing the same
 *   character is the reuse the product is built around, and cloning assets would double
 *   the file for no benefit.
 *
 * Everything here is pure. No file handles, no clipboard, no browser globals — those
 * belong in the UI, which hands this module a string and takes a string back.
 */

import { createId, ID_PREFIX } from '../id';
import { CURRENT_FORMAT_VERSION, ProjectParseError, readProjectFile, serializeProject } from '../serialize';
import type { Episode, Id, Project, Scene, Track } from '../types';

/** Suffix appended to a duplicated project's name. */
const COPY_SUFFIX = ' (copy)';

/** Suffix appended to an imported project's name. */
const IMPORTED_SUFFIX = ' (imported)';

export interface ExportResult {
  /** The file contents. Written to disk by the caller, which owns the browser API. */
  text: string;
  /** Suggested filename, extension included. */
  filename: string;
}

export interface ExportOptions {
  /**
   * File extension including the dot, e.g. `.json`.
   *
   * Passed in rather than hardcoded because the extension is a product decision, not a
   * domain one — the branded form this product ships is chosen by the UI layer. Core
   * stays content-blind and simply does what it is told.
   */
  extension?: string;
}

const DEFAULT_EXTENSION = '.json';

export interface ImportResult {
  project: Project;
  /** Anything the parser had to correct. Surfaced to the user rather than swallowed. */
  warnings: string[];
  /**
   * True when the file came from a build older than this one and was migrated.
   * Worth a line in the UI: a silent version bump hides the fact that something moved.
   */
  migratedFrom: number | null;
}

/**
 * Serialise a project to a file.
 *
 * Rejects a project that is not at the current format version rather than writing a file
 * this build would not read back. That can only happen if a caller bypassed the
 * migration ladder, and a file that cannot be reopened is worse than a loud failure.
 */
export function exportProject(project: Project, options: ExportOptions = {}): ExportResult {
  if (project.formatVersion !== CURRENT_FORMAT_VERSION) {
    throw new ProjectParseError(
      `Refusing to export a project at format version ${project.formatVersion}; this build ` +
        `writes ${CURRENT_FORMAT_VERSION}.`,
    );
  }
  return { text: serializeProject(project), filename: filenameFor(project, options) };
}

/**
 * Read a file into a new project.
 *
 * `sourceName` is the filename, used only for the default name. A file called
 * `ep003.zanza.json` becomes "Ep003 (imported)" — something the user recognises as
 * *this* file, not the name the other machine happened to give it.
 *
 * Throws `ProjectParseError` if the file is not a readable project. Nothing is returned
 * in that case, so a failed import cannot half-create a project.
 */
export function importProject(text: string, sourceName = 'Untitled'): ImportResult {
  const { project, warnings } = readProjectFile(text);
  const declaredVersion = declaredFormatVersion(text);
  return {
    project: {
      ...project,
      // The file's identity is never adopted. Two imports of the same file are two
      // projects, and a project id from another machine means nothing here.
      id: createId(ID_PREFIX.project),
      name: defaultImportName(sourceName),
      createdAt: now(),
      updatedAt: now(),
      metadata: { archived: null, duplicatedFrom: null, snapshotOf: null },
    },
    warnings,
    migratedFrom: declaredVersion !== null && declaredVersion < CURRENT_FORMAT_VERSION
      ? declaredVersion
      : null,
  };
}

/**
 * Copy a project.
 *
 * The copy gets a new project id, a new name, and new ids for everything that lives
 * inside a scene or an episode. Asset definitions keep their ids: they are the shared
 * library, and a duplicate that quietly forked the character library would be a
 * different product.
 */
export function duplicateProject(project: Project, name?: string): Project {
  const scenes: Scene[] = [];
  /** Old scene id -> new scene id, needed to rewrite the episode cut lists. */
  const sceneIdMap = new Map<Id, Id>();

  for (const source of project.scenes) {
    const copy = copySceneWithFreshIds(source);
    sceneIdMap.set(source.id, copy.id);
    scenes.push(copy);
  }

  const episodes: Episode[] = project.episodes.map((episode) => ({
    ...structuredClone(episode),
    id: createId(ID_PREFIX.episode),
    sceneIds: episode.sceneIds.map((id) => sceneIdMap.get(id) ?? id),
  }));

  const stamp = now();
  return {
    ...structuredClone(project),
    id: createId(ID_PREFIX.project),
    name: name ?? `${project.name}${COPY_SUFFIX}`,
    createdAt: stamp,
    updatedAt: stamp,
    scenes,
    episodes,
    // Provenance about the *new* project, not inherited from the old one.
    metadata: {
      archived: null,
      duplicatedFrom: project.id,
      snapshotOf: project.metadata.snapshotOf,
    },
  };
}

/**
 * A point-in-time copy, for trying something without risking the original.
 *
 * Shares the asset library with the original and mints its own scene-local ids, so the
 * snapshot is independent to edit and revert while the characters stay shared.
 */
export function snapshotProject(project: Project, name?: string): Project {
  const copy = duplicateProject(project, name ?? `${project.name} (snapshot)`);
  return {
    ...copy,
    metadata: {
      archived: null,
      duplicatedFrom: project.metadata.duplicatedFrom,
      snapshotOf: project.id,
    },
  };
}

/**
 * Copy a scene with every id inside it reminted.
 *
 * Remapping is the subtle part. An id is only safe to keep if nothing inside the copied
 * scene points at it, so the rule is by track kind:
 *
 * - `actor` -> a `SceneActor`, so the track follows the actor to its new id.
 * - `dialogue` -> a `DialogueLine`, so the track *and* the clip's `dialogueLineId` follow
 *   the line. Missing this one is easy: a duplicated scene then has dialogue clips
 *   pointing at lines that do not exist, and it fails validation on the next save.
 * - `prop`, `camera`, `audio` -> shared assets or a literal, which keep their ids.
 */
function copySceneWithFreshIds(source: Scene): Scene {
  const copy: Scene = {
    ...structuredClone(source),
    id: createId(ID_PREFIX.scene),
  };

  const actorIdMap = new Map<Id, Id>();
  copy.actors = copy.actors.map((actor) => {
    const nextId = createId(ID_PREFIX.actor);
    actorIdMap.set(actor.id, nextId);
    return { ...actor, id: nextId };
  });

  copy.props = copy.props.map((prop) => ({ ...prop, id: createId(ID_PREFIX.propInstance) }));

  const dialogueIdMap = new Map<Id, Id>();
  copy.dialogue = copy.dialogue.map((line) => {
    const nextId = createId(ID_PREFIX.dialogue);
    dialogueIdMap.set(line.id, nextId);
    return { ...line, id: nextId, actorId: line.actorId ? (actorIdMap.get(line.actorId) ?? null) : null };
  });

  copy.tracks = copy.tracks.map((track) => ({
    ...track,
    id: createId(ID_PREFIX.track),
    targetId: remapTarget(track, actorIdMap, dialogueIdMap),
    clips: track.clips.map((clip) => ({
      ...clip,
      id: createId(ID_PREFIX.clip),
      keyframes: clip.keyframes.map((kf) => ({ ...kf, id: createId(ID_PREFIX.keyframe) })),
      dialogueLineId: clip.dialogueLineId
        ? (dialogueIdMap.get(clip.dialogueLineId) ?? clip.dialogueLineId)
        : null,
    })),
  }));

  return copy;
}

/** Where a track points once the scene it lives in has been copied. */
function remapTarget(
  track: Track,
  actorIdMap: ReadonlyMap<Id, Id>,
  dialogueIdMap: ReadonlyMap<Id, Id>,
): Id {
  if (track.kind === 'actor') return actorIdMap.get(track.targetId) ?? track.targetId;
  if (track.kind === 'dialogue') return dialogueIdMap.get(track.targetId) ?? track.targetId;
  return track.targetId;
}

/**
 * Copy a scene with fresh ids, for `duplicateScene` in the same project.
 *
 * Exported rather than duplicated so the rule above has one definition. Two copies of
 * id-remapping logic is how `duplicateScene` came to leave dialogue tracks pointing at
 * lines that no longer existed.
 */
export function duplicateSceneWithFreshIds(source: Scene): Scene {
  return copySceneWithFreshIds(source);
}

/** `my-episode-project.json` -> `My Episode Project`. */
function defaultImportName(sourceName: string): string {
  const stem = stripExtension(sourceName).replace(/[-_]+/g, ' ').trim();
  const base = stem === '' ? 'Untitled Project' : stem;
  return `${base[0]?.toUpperCase() ?? ''}${base.slice(1)}${IMPORTED_SUFFIX}`;
}

/**
 * Strip trailing extension segments from a filename.
 *
 * Loops, because this product's own export is compound (`ep003.zanza.json`) and
 * re-importing a file we wrote should give back the name, not `Ep003.zanza`. A segment
 * counts as an extension only if it is short and lowercase, so `Ep.2.json` keeps its
 * `2` and comes back as `Ep.2`.
 */
function stripExtension(name: string): string {
  let stem = name;
  for (;;) {
    const segment = /\.([a-z][a-z0-9]{0,7})$/.exec(stem);
    if (segment === null) return stem;
    stem = stem.slice(0, -segment[0].length);
  }
}

/** A filesystem-safe stem. The extension is what makes it openable by double-click. */
function filenameFor(project: Project, options: ExportOptions): string {
  const stem = project.name
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  const extension = options.extension ?? DEFAULT_EXTENSION;
  return `${stem === '' ? 'project' : stem}${extension}`;
}

/** The version the file claims, without parsing it twice for the same reason. */
function declaredFormatVersion(text: string): number | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const version = (raw as Record<string, unknown>).formatVersion;
    return typeof version === 'number' ? version : null;
  } catch {
    return null;
  }
}

function now(): string {
  return new Date().toISOString();
}
