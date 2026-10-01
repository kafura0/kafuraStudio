/**
 * Import, export and duplication.
 *
 * The three operations are distinguished by which ids they mint, so that is what most of
 * these tests check. An id bug here is silent and expensive: two nodes sharing an id
 * makes selection and keyframe lookup address the wrong thing, and the symptom shows up
 * in someone else's scene, ten minutes later.
 */

import { describe, expect, it } from 'vitest';
import { duplicateProject, exportProject, importProject, snapshotProject } from './projectIo';
import { CURRENT_FORMAT_VERSION, ProjectParseError, parseProject } from '../serialize';
import { SEED_PROJECT } from '../../data/seed';
import type { Id, Project, Scene } from '../types';

/** Every id defined inside a scene. Two scenes in one project must not share any. */
function sceneLocalIds(scene: Scene): Id[] {
  return [
    scene.id,
    ...scene.actors.map((a) => a.id),
    ...scene.props.map((p) => p.id),
    ...scene.dialogue.map((d) => d.id),
    ...scene.tracks.flatMap((t) => [
      t.id,
      ...t.clips.flatMap((c) => [c.id, ...c.keyframes.map((k) => k.id)]),
    ]),
  ];
}

const allSceneLocalIds = (project: Project): Id[] => project.scenes.flatMap(sceneLocalIds);

/**
 * The extension this product ships under. Supplied by the caller because it is a product
 * decision, not a domain one — the test states it so the default is exercised too.
 */
const BRANDED = { extension: '.zanza.json' } as const;

describe('exportProject', () => {
  it('writes a file that reopens to the same document', () => {
    const { text, filename } = exportProject(SEED_PROJECT, BRANDED);
    expect(parseProject(text)).toEqual(SEED_PROJECT);
    expect(filename).toMatch(/\.zanza\.json$/);
  });

  it('changes nothing about the project', () => {
    const before = structuredClone(SEED_PROJECT);
    exportProject(SEED_PROJECT, BRANDED);
    expect(SEED_PROJECT).toEqual(before);
  });

  it('round trips a duplicate, ids and all', () => {
    // A duplicate has a different id from everything else in the database, and it has
    // to survive a save/load or "duplicate" is only a session-lifetime feature.
    const copy = duplicateProject(SEED_PROJECT);
    const { text } = exportProject(copy, BRANDED);
    expect(parseProject(text)).toEqual(copy);
  });

  it('refuses to write a project that is not at the current version', () => {
    // The only way to get here is to bypass the migration ladder, and a file this build
    // cannot reopen is worse than a loud failure.
    const stale = { ...SEED_PROJECT, formatVersion: CURRENT_FORMAT_VERSION - 1 };
    expect(() => exportProject(stale, BRANDED)).toThrow(ProjectParseError);
  });

  it('produces a filename that is safe on a filesystem', () => {
    const { filename } = exportProject({ ...SEED_PROJECT, name: 'A/B: "Pilot" <ep1>' }, BRANDED);
    expect(filename).not.toMatch(/[\\/:*?"<>|]/);
    expect(filename).toMatch(/\.zanza\.json$/);
  });

  it('defaults to a neutral extension, leaving the brand to the caller', () => {
    // RULE 3. The file extension is a product decision; core is told what to use.
    expect(exportProject(SEED_PROJECT).filename.endsWith('.json')).toBe(true);
    expect(exportProject(SEED_PROJECT).filename).not.toContain('zanza.');
  });

  it('falls back to a usable filename when the name is all punctuation', () => {
    expect(exportProject({ ...SEED_PROJECT, name: '///' }, BRANDED).filename).toBe('project.zanza.json');
  });
});

describe('importProject', () => {
  it('adopts neither the id nor the name from the file', () => {
    const { text } = exportProject(SEED_PROJECT, BRANDED);
    const { project } = importProject(text, 'ep003.zanza.json');
    expect(project.id).not.toBe(SEED_PROJECT.id);
    expect(project.id).toMatch(/^proj_/);
    expect(project.name).toBe('Ep003 (imported)');
  });

  it('is a distinct project every time, even from the same file', () => {
    const { text } = exportProject(SEED_PROJECT, BRANDED);
    const a = importProject(text, 'x.zanza.json');
    const b = importProject(text, 'x.zanza.json');
    expect(a.project.id).not.toBe(b.project.id);
  });

  it('keeps the content, so an exported project re-imports unchanged apart from identity', () => {
    const { text } = exportProject(SEED_PROJECT, BRANDED);
    const { project } = importProject(text, 'pilot.zanza.json');
    expect(project.scenes.map(sceneLocalIds)).toEqual(SEED_PROJECT.scenes.map(sceneLocalIds));
    expect(project.assets).toEqual(SEED_PROJECT.assets);
    expect(project.metadata).toEqual({ archived: null, duplicatedFrom: null, snapshotOf: null });
  });

  it('does not carry the source project archive state into the import', () => {
    const { text } = exportProject({ ...SEED_PROJECT, metadata: { archived: '2026-01-01T00:00:00.000Z', duplicatedFrom: null, snapshotOf: null } });
    const { project } = importProject(text, 'a.zanza.json');
    expect(project.metadata.archived).toBeNull();
  });

  it('reports when the file came from an older build', () => {
    const v1 = JSON.stringify({ formatVersion: 1, project: stripV2Fields(SEED_PROJECT) });
    const result = importProject(v1, 'old.zanza.json');
    expect(result.migratedFrom).toBe(1);
    expect(result.project.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it('reports no migration for a current file', () => {
    const { text } = exportProject(SEED_PROJECT, BRANDED);
    expect(importProject(text, 'new.zanza.json').migratedFrom).toBeNull();
  });

  it('passes parser warnings through instead of swallowing them', () => {
    const file = JSON.stringify({ formatVersion: 2, project: { ...SEED_PROJECT, formatVersion: 1 } });
    const result = importProject(file, 'mismatch.zanza.json');
    expect(result.warnings).toHaveLength(1);
  });

  it('names the import after the file, not after the project inside it', () => {
    // Re-importing a file this product wrote gives back the filename's stem, not the
    // name inside. The stem is lowercased by the slugger, so only the first letter is
    // restored — a deliberate trade for a filename that is safe on any filesystem. The
    // name is editable, and guessing at capitalisation would mangle names like `iPhone`.
    const { text, filename } = exportProject(SEED_PROJECT, BRANDED);
    const { project } = importProject(text, filename);
    expect(project.name).toBe('Zanza — pilot (imported)');
    expect(project.name).not.toContain('.json');
  });

  it('keeps a dotted name that is not an extension', () => {
    expect(importProject(exportProject(SEED_PROJECT, BRANDED).text, 'Ep.2.json').project.name).toBe(
      'Ep.2 (imported)',
    );
  });

  it('falls back to a generic name when the file is named after nothing', () => {
    expect(importProject(exportProject(SEED_PROJECT).text, '.json').project.name).toBe(
      'Untitled Project (imported)',
    );
  });

  it('returns nothing at all for a file that is not a project', () => {
    // The property that matters: a failed import must not leave a half-built project.
    expect(() => importProject('not json at all', 'junk.json')).toThrow(ProjectParseError);
    expect(() => importProject('{"formatVersion":1}', 'no-project.json')).toThrow(ProjectParseError);
    expect(() => importProject(JSON.stringify({ formatVersion: 99, project: {} }), 'future.json')).toThrow(ProjectParseError);
  });

  it('refuses a project that fails validation rather than importing a broken document', () => {
    const broken = { ...SEED_PROJECT, scenes: [], assets: { ...SEED_PROJECT.assets, environments: [] } };
    expect(() => importProject(JSON.stringify({ formatVersion: 2, project: broken }), 'broken.json')).toThrow(ProjectParseError);
  });
});

describe('duplicateProject', () => {
  it('gives the project a new id and a copy name', () => {
    const copy = duplicateProject(SEED_PROJECT);
    expect(copy.id).not.toBe(SEED_PROJECT.id);
    expect(copy.name).toBe('ZANZA — Pilot (copy)');
  });

  it('accepts an explicit name', () => {
    expect(duplicateProject(SEED_PROJECT, 'Episode 002').name).toBe('Episode 002');
  });

  it('remints every scene-local id', () => {
    const copy = duplicateProject(SEED_PROJECT);
    const original = new Set(allSceneLocalIds(SEED_PROJECT));
    const fresh = allSceneLocalIds(copy);
    expect(fresh.length).toBe(original.size);
    expect(fresh.filter((id) => original.has(id))).toEqual([]);
    // And no collisions inside the copy itself.
    expect(new Set(fresh).size).toBe(fresh.length);
  });

  it('preserves the shared asset library, which is the point of duplication', () => {
    const copy = duplicateProject(SEED_PROJECT);
    expect(copy.assets).toEqual(SEED_PROJECT.assets);
  });

  it('keeps actor tracks pointing at the same actor after the copy', () => {
    const copy = duplicateProject(SEED_PROJECT);
    copy.scenes.forEach((scene) => {
      const actorIds = new Set(scene.actors.map((a) => a.id));
      scene.tracks
        .filter((t) => t.kind === 'actor')
        .forEach((t) => {
          expect(actorIds.has(t.targetId)).toBe(true);
        });
    });
  });

  it('keeps dialogue lines pointing at the same actor after the copy', () => {
    const copy = duplicateProject(SEED_PROJECT);
    copy.scenes.forEach((scene) => {
      const actorIds = new Set(scene.actors.map((a) => a.id));
      scene.dialogue
        .filter((line) => line.actorId !== null)
        .forEach((line) => {
          expect(actorIds.has(line.actorId as Id)).toBe(true);
        });
    });
  });

  it('rewrites episode cut lists to the copied scenes', () => {
    const withEpisodes: Project = {
      ...SEED_PROJECT,
      episodes: [
        {
          ...SEED_PROJECT.episodes[0]!,
          id: 'ep_original',
          sceneIds: SEED_PROJECT.scenes.slice(0, 2).map((s) => s.id),
        },
      ],
    };
    const copy = duplicateProject(withEpisodes);
    const copySceneIds = copy.scenes.map((s) => s.id);
    expect(copy.episodes[0]?.id).not.toBe('ep_original');
    expect(copy.episodes[0]?.sceneIds.every((id) => copySceneIds.includes(id))).toBe(true);
    // Not a single dangling reference to a scene that stayed behind in the original.
    expect(copy.episodes[0]?.sceneIds).not.toContain(withEpisodes.scenes[0]?.id);
  });

  it('records where it came from and is not itself archived', () => {
    const copy = duplicateProject(SEED_PROJECT);
    expect(copy.metadata.duplicatedFrom).toBe(SEED_PROJECT.id);
    expect(copy.metadata.snapshotOf).toBeNull();
    expect(copy.metadata.archived).toBeNull();
  });

  it('leaves the original completely alone', () => {
    const before = structuredClone(SEED_PROJECT);
    duplicateProject(SEED_PROJECT);
    expect(SEED_PROJECT).toEqual(before);
  });

  it('produces a document that passes the same invariants as the original', () => {
    // Cheapest end-to-end check available in core: a duplicate that would not parse back
    // is a duplicate with a dangling id in it.
    const copy = duplicateProject(SEED_PROJECT);
    expect(() => parseProject(exportProject(copy, BRANDED).text)).not.toThrow();
  });

  it('stamps fresh timestamps, because a copy is new work', () => {
    const copy = duplicateProject(SEED_PROJECT);
    expect(Date.parse(copy.createdAt)).not.toBeNaN();
    expect(copy.createdAt).not.toBe(SEED_PROJECT.createdAt);
  });
});

describe('snapshotProject', () => {
  it('points at the project it copies, and names itself differently', () => {
    const snap = snapshotProject(SEED_PROJECT);
    expect(snap.metadata.snapshotOf).toBe(SEED_PROJECT.id);
    expect(snap.name).toBe('ZANZA — Pilot (snapshot)');
    expect(snap.id).not.toBe(SEED_PROJECT.id);
  });

  it('is independent to edit and to revert', () => {
    const snap = snapshotProject(SEED_PROJECT);
    expect(allSceneLocalIds(snap).some((id) => allSceneLocalIds(SEED_PROJECT).includes(id))).toBe(false);
  });
});

/** A v1-shaped copy of a project: no `srcKind`, no `metadata`. */
function stripV2Fields(project: Project): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(project)) as Record<string, unknown>;
  delete clone.metadata;
  clone.formatVersion = 1;
  const assets = clone.assets as Record<string, { srcKind?: string }[]>;
  for (const collection of Object.values(assets)) {
    for (const def of collection) delete def.srcKind;
  }
  return clone;
}
