/**
 * The document format ladder.
 *
 * A migration is the one piece of code in this repository that runs on data the user
 * cares about and cannot regenerate. That makes three properties worth more than the
 * feature it enables, and each has a test below:
 *
 * 1. **Additive.** A v1 record must come out the same document, plus new fields.
 * 2. **Idempotent.** Re-running a migration must land in the same place, or a project
 *    that is exported, imported and exported again would drift.
 * 3. **Honest.** The one judgement call available in v1 -> v2 is whether to guess what a
 *    pre-v2 `src` string meant. The migration must refuse to guess, because a wrong
 *    guess reports a recording that cannot be loaded.
 */

import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORMAT_VERSION,
  migrateProject,
  normaliseProject,
  parseProject,
  ProjectParseError,
  readProjectFile,
  serializeProject,
} from './serialize';
import { createProject, emptyAssetLibrary } from './document/factories';
import { SEED_PROJECT } from '../data/seed';
import { renderToRecording } from '../test/recordingContext';
import type { Project, Scene } from './types';

describe('document format version', () => {
  it('is 2, and the seed writes the current version', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(2);
    expect(SEED_PROJECT.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });
});

/**
 * A v1 project: no `srcKind` anywhere, no `metadata`, version 1 throughout.
 *
 * Built on the seed's asset library rather than empty libraries, because a valid
 * document needs a character and an environment and because a real old file is a real
 * project — the migration has to cope with a populated document, not a toy one.
 */
function v1Project(): Record<string, unknown> {
  return {
    id: 'proj_legacy',
    name: 'Legacy',
    description: '',
    createdAt: '2025-06-01T00:00:00.000Z',
    updatedAt: '2025-06-02T00:00:00.000Z',
    formatVersion: 1,
    settings: { width: 1280, height: 720, fps: 30, autosave: true },
    assets: {
      ...SEED_PROJECT.assets,
      audio: [
        ...SEED_PROJECT.assets.audio,
        { id: 'audio_legacy_vo', name: 'VO', kind: 'dialogue', src: null, duration: 3, tags: [] },
        {
          id: 'audio_legacy_theme',
          name: 'Theme',
          kind: 'music',
          // A v1 file could hold anything in `src`, including something path-shaped.
          src: '/Users/someone/Desktop/theme.wav',
          duration: 90,
          tags: [],
        },
      ],
    },
    cameraPresets: [],
    episodes: [],
    scenes: [],
  };
}

const v1File = (): string => JSON.stringify({ formatVersion: 1, project: v1Project() });
const audioById = (project: Project, id: string) => project.assets.audio.find((a) => a.id === id);

/** Every timing number in a scene, flattened, so a migration cannot move one unnoticed. */
function sceneTimes(scene: Scene): number[] {
  return [
    scene.duration,
    ...scene.tracks.flatMap((track) =>
      track.clips.flatMap((clip) => [clip.start, clip.duration, ...clip.keyframes.map((k) => k.time)]),
    ),
  ];
}

/**
 * A v1 document that actually contains the pilot's scenes.
 *
 * `v1Project()` above is deliberately empty of scenes, because most of what the migration
 * adds is on assets and metadata. Render-neutrality is a different question and needs the
 * opposite fixture: the same scenes, the same clips, the same keyframes — and none of the
 * v2 fields. If the migration changed anything the renderer reads, the draw logs diverge.
 */
function populatedV1File(): string {
  const project = structuredClone(SEED_PROJECT) as unknown as Record<string, unknown>;
  project.formatVersion = 1;
  delete project.metadata;
  project.assets = {
    ...SEED_PROJECT.assets,
    audio: SEED_PROJECT.assets.audio.map((audio) => {
      const { srcKind, ...rest } = audio;
      void srcKind;
      return { ...rest, src: null };
    }),
  };
  return JSON.stringify({ formatVersion: 1, project });
}

describe('v1 -> v2 migration', () => {
  it('renders a migrated document identically to the current one', () => {
    // The G4 render-neutrality gate, applied to the migration that actually shipped. A
    // migration is allowed to add fields and to say what they mean; it is not allowed to
    // move a pixel. Comparing recorded draw calls rather than a PNG is what makes this
    // exact — a frame that differs in one fill colour is caught, and the failure names the
    // scene and the time it happened at.
    const migrated = parseProject(populatedV1File());
    // The v1 form has no `srcKind` and no `metadata`; both must be defaulted rather than
    // required, and the renderer must not care.
    expect(migrated.scenes).toHaveLength(SEED_PROJECT.scenes.length);

    for (const scene of SEED_PROJECT.scenes) {
      const migratedScene = migrated.scenes.find((s) => s.id === scene.id);
      if (!migratedScene) throw new Error(`Migration dropped scene ${scene.id}`);

      // Sample across the whole scene rather than at t=0, so a keyframed value that the
      // migration nudged is caught wherever it drifts.
      for (const time of [0, scene.duration / 4, scene.duration / 2, scene.duration - 0.01]) {
        const before = renderToRecording(SEED_PROJECT, scene.id, time).calls;
        const after = renderToRecording(migrated, scene.id, time).calls;
        // Guard against a vacuous pass: two empty logs are equal, and an equal pair of
        // empty logs would mean this test proved nothing at all.
        expect(before.length).toBeGreaterThan(0);
        expect(after.length).toBeGreaterThan(0);
        expect(after, `scene ${scene.id} at ${time}s drew differently after migrating`).toEqual(
          before,
        );
      }
    }
  });

  it('opens a v1 document', () => {
    const project = parseProject(v1File());
    expect(project.name).toBe('Legacy');
    expect(project.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });

  it('leaves every id in the document alone', () => {
    // An id is a join key a user may hold references to. A migration that renumbers one
    // is not a migration, it is a different document wearing the same name.
    const project = parseProject(v1File());
    expect(project.id).toBe('proj_legacy');
    expect(audioById(project, 'audio_legacy_theme')).toBeDefined();
    expect(project.assets.audio).toHaveLength(SEED_PROJECT.assets.audio.length + 2);
  });

  it('defaults every audio slot to "no file" rather than guessing what src meant', () => {
    const project = parseProject(v1File());
    // The path-shaped `src` above is exactly the case that must not be resolved to
    // 'external' by inference. A migration that guessed would claim a recording exists.
    expect(project.assets.audio.every((a) => a.srcKind === null)).toBe(true);
    // The value itself is preserved, so re-attaching is a deliberate act, not a repair.
    expect(audioById(project, 'audio_legacy_theme')?.src).toBe('/Users/someone/Desktop/theme.wav');
  });

  it('adds metadata defaulting to "not archived, not a copy"', () => {
    const project = parseProject(v1File());
    expect(project.metadata).toEqual({
      archived: null,
      duplicatedFrom: null,
      snapshotOf: null,
    });
  });

  it('preserves metadata that is already present', () => {
    // Not just the defaults: a file that already declares these keeps them, which is
    // what makes the step idempotent.
    const source = v1Project();
    source.metadata = { archived: '2026-02-02T00:00:00.000Z', duplicatedFrom: null, snapshotOf: null };
    const project = parseProject(JSON.stringify({ formatVersion: 1, project: source }));
    expect(project.metadata.archived).toBe('2026-02-02T00:00:00.000Z');
  });

  it('is idempotent, so a re-export cannot drift', () => {
    const once = parseProject(v1File());
    const twice = parseProject(serializeProject(once));
    const thrice = parseProject(serializeProject(twice));
    expect(serializeProject(thrice)).toBe(serializeProject(once));
  });

  it('does not rewrite scene or keyframe time', () => {
    // Keyframe times are the one place a plausible "helpful" migration would round to
    // frames and quietly retime every shot in the project.
    const source = v1Project();
    source.scenes = SEED_PROJECT.scenes.slice(0, 2);
    const before = SEED_PROJECT.scenes.slice(0, 2).map(sceneTimes);

    const project = parseProject(JSON.stringify({ formatVersion: 1, project: source }));
    expect(project.scenes.map(sceneTimes)).toEqual(before);
  });
});

describe('current -> current', () => {
  it('is a no-op that does not rewrite anything', () => {
    const text = serializeProject(SEED_PROJECT);
    const parsed = parseProject(text);
    expect(serializeProject(parsed)).toBe(text);
  });

  it('leaves a current document structurally untouched', () => {
    const before = SEED_PROJECT;
    const after = migrateProject(
      JSON.parse(JSON.stringify({ ...before })) as Record<string, unknown>,
      CURRENT_FORMAT_VERSION,
    );
    expect(after).toEqual(before);
  });
});

describe('version reconciliation', () => {
  it('trusts the outer formatVersion over the copy inside the project', () => {
    // A hand-edited file, or one whose inner field was written by a different build. The
    // outer field is written by the serializer on every save, so it is the real one.
    const file = {
      formatVersion: 2,
      project: { ...v1Project(), formatVersion: 1 },
    };
    const { project, warnings } = readProjectFile(file);
    expect(project.formatVersion).toBe(2);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/declares format version 2/);
  });

  it('says nothing when the two versions agree', () => {
    const { warnings } = readProjectFile(serializeProject(SEED_PROJECT));
    expect(warnings).toEqual([]);
  });

  it('refuses a document from a newer build rather than guessing', () => {
    expect(() =>
      parseProject(JSON.stringify({ formatVersion: CURRENT_FORMAT_VERSION + 1, project: {} })),
    ).toThrow(ProjectParseError);
  });
});

describe('normaliseProject', () => {
  it('rejects an unrecognised srcKind rather than passing it through', () => {
    // `srcKind: 'local'` with nothing to load would make every honest-reporting surface
    // claim a recording exists. An unknown value is a broken file, so it becomes null.
    const project = normaliseProject({
      ...v1Project(),
      assets: {
        ...emptyAssetLibrary(),
        audio: [{ id: 'a', name: 'A', kind: 'music', src: 'media_1', srcKind: 'cloud', duration: 1, tags: [] }],
      },
    });
    expect(project.assets.audio[0]?.srcKind).toBeNull();
  });

  it('keeps a declared local srcKind', () => {
    const project = normaliseProject({
      ...v1Project(),
      assets: {
        ...emptyAssetLibrary(),
        audio: [{ id: 'a', name: 'A', kind: 'music', src: 'media_1', srcKind: 'local', duration: 1, tags: [] }],
      },
    });
    expect(project.assets.audio[0]?.srcKind).toBe('local');
  });

  it('drops an unparseable archive date instead of storing nonsense', () => {
    const project = normaliseProject({ ...v1Project(), metadata: { archived: 'not-a-date' } });
    expect(project.metadata.archived).toBeNull();
  });

  it('does not invent an id or a name for an empty document', () => {
    const project = normaliseProject({});
    expect(project.id).toBe('proj_imported');
    expect(project.name).toBe('Untitled Project');
    expect(project.metadata).toEqual({ archived: null, duplicatedFrom: null, snapshotOf: null });
  });
});

describe('a created project is already current', () => {
  it('needs no migration to round trip', () => {
    // A new project from the factory must already satisfy v2, or the first save of a
    // brand new file would be a document the parser has to fix up.
    const project: Project = { ...createProject('Fresh'), assets: SEED_PROJECT.assets };
    expect(project.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });
});
