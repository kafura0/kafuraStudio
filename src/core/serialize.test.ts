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
 *
 * Phase 14 adds a fourth and the hardest one: **render-neutral**. Moving the asset library
 * out of the project and into a series is the first migration that can change what a frame
 * looks like, and "it is only a scope change" is a claim that has to be proven rather than
 * intended. See `v2 -> v3: render neutrality (G4)` below.
 */

import { describe, expect, it } from 'vitest';
import {
  CURRENT_FORMAT_VERSION,
  migrateProject,
  migrateProjectFile,
  normaliseProject,
  parseProject,
  ProjectParseError,
  readProjectFile,
  serializeProject,
  serializeProjectFile,
} from './serialize';
import { createProject, emptyAssetLibrary } from './document/factories';
import { validateProject } from './document/invariants';
import { resolveAssets } from './document/scopes';
import { audioPlan } from './audio/audioPlan';
import { SEED_PROJECT, SEED_SERIES, seedContext } from '../data/seed';
import { renderToRecording } from '../test/recordingContext';
import type { Project, Scene, SceneContext, SeriesDef } from './types';

describe('document format version', () => {
  it('is 3, and the seed writes the current version', () => {
    expect(CURRENT_FORMAT_VERSION).toBe(3);
    expect(SEED_PROJECT.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(SEED_SERIES.formatVersion).toBe(CURRENT_FORMAT_VERSION);
  });
});

/**
 * A v1 project: no `srcKind` anywhere, no `metadata`, version 1 throughout.
 *
 * Built on the seed's asset library rather than empty libraries, because a valid
 * document needs a character and an environment and because a real old file is a real
 * project — the migration has to cope with a populated document, not a toy one.
 *
 * Note it takes the library from `SEED_SERIES`, not `SEED_PROJECT`: a pre-series document
 * carried its art inline, so the fixture has to put it back inline to be an honest v1.
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
      ...SEED_SERIES.assets,
      audio: [
        ...SEED_SERIES.assets.audio,
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
/** Look an audio slot up in the library a project can actually see. */
const audioById = (project: Project, id: string, series: SeriesDef | null = null) =>
  resolveAssets(project, series).assets.audio.find((a) => a.id === id);

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
 *
 * The library goes inline here for the same reason it does in `v1Project`: a v2 document
 * carries its own assets and has no series to point at.
 */
function populatedV1File(): string {
  const project = structuredClone(SEED_PROJECT) as unknown as Record<string, unknown>;
  project.formatVersion = 1;
  delete project.metadata;
  delete project.seriesId;
  project.assets = {
    ...SEED_SERIES.assets,
    audio: SEED_SERIES.assets.audio.map((audio) => {
      const { srcKind, ...rest } = audio;
      void srcKind;
      return { ...rest, src: null };
    }),
  };
  return JSON.stringify({ formatVersion: 1, project });
}

/**
 * A v2 document that actually contains the pilot's scenes.
 *
 * This is the true "before" of Phase 14: a show with its art inline in the project, exactly
 * as the previous phase shipped it. `populatedV1File` above is the v1 shape and reaches the
 * same place, but through two steps rather than one, which makes a failure harder to read.
 */
function populatedV2File(): string {
  const project = structuredClone(SEED_PROJECT) as unknown as Record<string, unknown>;
  project.formatVersion = 2;
  delete project.seriesId;
  project.assets = structuredClone(SEED_SERIES.assets) as unknown as Record<string, unknown>;
  return JSON.stringify({ formatVersion: 2, project });
}

/**
 * The pre-migration v2 document, as the renderer would have been handed it back then.
 *
 * Built by *normalising the v2 file without migrating it*, not by calling `migrateProjectFile`
 * and using what it returned. The distinction is the whole point of the gate: migrating first
 * and then discarding the series produces an empty library and an empty stage, which would
 * compare equal to a second empty migration and pass for the wrong reason. The "before" has
 * to come from the file's own contents, so the v2 shape is parsed on its own terms.
 *
 * The series returned by a second migration is used only for the "after" half. That is not a
 * shortcut: a v3 read is the migration, so the round trip under test is
 * `normaliseV2 -> migrate -> normaliseV3`, which is what actually happens in the editor.
 */
function v2Context(file: string): { context: SceneContext; scenes: Scene[] } {
  const parsed = JSON.parse(file) as { project: Record<string, unknown> };
  const project = normaliseProject(parsed.project) as unknown as Project;
  // No series: a v2 project's assets *are* its library, which is exactly what a `Project`
  // with a populated `assets` structurally provides.
  return { context: resolveAssets(project, null), scenes: project.scenes };
}

/**
 * The series a pre-series file implies, read straight out of the migration.
 *
 * Deliberately not hand-built. If this test constructed its own expected series it would
 * be asserting the migration against the test author's idea of it; going through the
 * migration means a bug in the derivation shows up here rather than being papered over.
 */
function impliedSeries(file: string) {
  const { series } = migrateProjectFile(file);
  if (series === null) throw new Error('Expected the migration to imply a series');
  return series;
}

describe('v1 -> v2 migration', () => {
  it('renders a migrated document identically to the current one', () => {
    // The G4 render-neutrality gate, applied to the migration that already shipped. A
    // migration is allowed to add fields and to say what they mean; it is not allowed to
    // move a pixel. Comparing recorded draw calls rather than a PNG is what makes this
    // exact — a frame that differs in one fill colour is caught, and the failure names the
    // scene and the time it happened at.
    const file = populatedV1File();
    const migrated = parseProject(file);
    const series = impliedSeries(file);
    // The v1 form has no `srcKind` and no `metadata`; both must be defaulted rather than
    // required, and the renderer must not care.
    expect(migrated.scenes).toHaveLength(SEED_PROJECT.scenes.length);

    for (const scene of SEED_PROJECT.scenes) {
      const migratedScene = migrated.scenes.find((s) => s.id === scene.id);
      if (!migratedScene) throw new Error(`Migration dropped scene ${scene.id}`);

      // Sample across the whole scene rather than at t=0, so a keyframed value that the
      // migration nudged is caught wherever it drifts.
      for (const time of [0, scene.duration / 4, scene.duration / 2, scene.duration - 0.01]) {
        // The v1 fixture was built from the seed's library and scenes, so the seed context
        // *is* what the renderer saw before this phase existed.
        const before = renderToRecording(seedContext(), scene, time).calls;
        const after = renderToRecording(resolveAssets(migrated, series), migratedScene, time)
          .calls;
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
    const { project, series } = migrateProjectFile(v1File());
    expect(project.id).toBe('proj_legacy');
    expect(audioById(project, 'audio_legacy_theme', series)).toBeDefined();
    // The slot now lives in the series, not the project — that is where a v2 document's
    // audio went, and the assertion is against the migrated *series*, not the seed's.
    expect(series?.assets.audio).toHaveLength(SEED_SERIES.assets.audio.length + 2);
  });

  it('defaults every audio slot to "no file" rather than guessing what src meant', () => {
    const { project, series } = migrateProjectFile(v1File());
    const audio = resolveAssets(project, series).assets.audio;
    // The path-shaped `src` above is exactly the case that must not be resolved to
    // 'external' by inference. A migration that guessed would claim a recording exists.
    expect(audio.every((a) => a.srcKind === null)).toBe(true);
    // The value itself is preserved, so re-attaching is a deliberate act, not a repair.
    expect(audio.find((a) => a.id === 'audio_legacy_theme')?.src).toBe(
      '/Users/someone/Desktop/theme.wav',
    );
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
    // The outer version is what drove the ladder, and the ladder runs to the current
    // version — so the result is stamped 3, not 2. Asserting the literal here would have to
    // be rewritten on every migration; asserting against `CURRENT_FORMAT_VERSION` states the
    // actual rule ("outer wins, then migrate to the end") without pinning a number.
    expect(project.formatVersion).toBe(CURRENT_FORMAT_VERSION);
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

describe('colour keys at load (R3)', () => {
  /**
   * The pilot with one rig part given a colour key that resolves to nothing. The typo is
   * on a series character so the check runs against the merged library, exactly as it
   * will for real content.
   */
  const fileWithTypo = (): string => {
    const series = structuredClone(SEED_SERIES);
    const character = series.assets.characters[0];
    const first = character?.rig[0];
    if (!character || !first) throw new Error('Seed has no characters or rig parts');
    character.rig = [{ ...first, colorKey: 'skinn' }, ...character.rig.slice(1)];
    return serializeProjectFile(SEED_PROJECT, series);
  };

  it('refuses a file whose colour key resolves to nothing', () => {
    expect(() => readProjectFile(fileWithTypo())).toThrow(
      expect.objectContaining({
        issues: expect.arrayContaining([expect.stringContaining('.colorKey')]),
      }),
    );
  });

  it('warns instead when the same file is read in authoring mode', () => {
    const { warnings } = readProjectFile(fileWithTypo(), { mode: 'authoring' });
    expect(warnings.some((w) => w.includes('.colorKey'))).toBe(true);
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
    // A new project from the factory must already satisfy v3, or the first save of a
    // brand new file would be a document the parser has to fix up.
    const project: Project = createProject('Fresh', 'series_zanza');
    expect(project.formatVersion).toBe(CURRENT_FORMAT_VERSION);
    expect(parseProject(serializeProject(project))).toEqual(project);
  });

  it('round trips with no series and no assets, because an empty library is valid', () => {
    // The factory's output has neither a series nor a character. That has to survive a save
    // and a load: the earlier version of this test failed because a new project could be
    // written but then quarantined as unreadable the first time it was opened.
    const free = createProject('Free');
    expect(free.seriesId).toBeNull();
    expect(parseProject(serializeProject(free))).toEqual(free);
  });
});

/* ------------------------------------------------------------------ */
/* v2 -> v3: the asset library becomes a series                        */
/* ------------------------------------------------------------------ */

describe('v2 -> v3: the library moves to a series', () => {
  it('moves the assets rather than copying them', () => {
    const { project, series } = migrateProjectFile(populatedV2File());
    // Moved, not duplicated. If the project kept its own copy then editing the series would
    // be invisible to every project of that show, and Phase 14 would have changed nothing.
    expect(project.assets).toEqual(emptyAssetLibrary());
    expect(series?.assets).toEqual(SEED_SERIES.assets);
  });

  it('names an owner, derived from the project id so it is deterministic', () => {
    const { project, series } = migrateProjectFile(populatedV2File());
    expect(series?.id).toBe('series_zanza_ep001');
    expect(project.seriesId).toBe(series?.id);
  });

  it('lands in the same series when the same file is migrated twice', () => {
    // The reason the id is derived rather than random. Two half-shared series from one
    // project is the specific failure this prevents.
    const first = migrateProjectFile(populatedV2File());
    const second = migrateProjectFile(populatedV2File());
    expect(second.series?.id).toBe(first.series?.id);
    expect(second.series).toEqual(first.series);
  });

  it('is idempotent — a re-read cannot rebuild the series from an empty library', () => {
    // The trap: the step moves `assets` out, so a second pass that re-derived the series
    // from the now-empty project would produce an empty series and quietly delete the
    // show. Re-serialising and re-parsing must be a fixed point.
    const once = migrateProjectFile(populatedV2File());
    const twice = migrateProjectFile(
      JSON.stringify({ formatVersion: CURRENT_FORMAT_VERSION, project: once.project }),
    );
    expect(twice.series).toBeNull();
    expect(twice.project.seriesId).toBe(once.project.seriesId);
    expect(twice.project.assets).toEqual(emptyAssetLibrary());
    expect(serializeProject(twice.project)).toBe(serializeProject(once.project));
  });

  it('carries the project identity and timestamps onto the derived series', () => {
    const { series } = migrateProjectFile(populatedV2File());
    expect(series?.name).toBe(SEED_PROJECT.name);
    expect(series?.description).toBe(SEED_PROJECT.description);
    expect(series?.createdAt).toBe(SEED_PROJECT.createdAt);
    expect(series?.updatedAt).toBe(SEED_PROJECT.updatedAt);
    expect(series?.metadata).toEqual({});
  });

  it('leaves scenes, episodes, settings and keyframe times alone', () => {
    const before = v2Context(populatedV2File());
    const after = migrateProjectFile(populatedV2File());

    expect(after.project.scenes.map(sceneTimes)).toEqual(before.scenes.map(sceneTimes));
    expect(after.project.scenes.map((s) => s.id)).toEqual(before.scenes.map((s) => s.id));
    expect(after.project.episodes.map((e) => e.id)).toEqual(
      before.scenes.length > 0 ? SEED_PROJECT.episodes.map((e) => e.id) : [],
    );
    // `settings` is what `renderScene` reads for the viewport, so it is the one field a
    // migration has no licence to touch.
    expect(after.project.settings).toEqual(SEED_PROJECT.settings);
  });

  it('leaves a free project series-less rather than inventing an owner', () => {
    // `null` is a real state (§5.3) and a document that declares it is not pre-series, so
    // the step must not claim it. Inventing a series here would make "free project"
    // unreachable and give it an empty library it did not ask for.
    const free = createProject('Free', null);
    const { series, project } = migrateProjectFile(serializeProject(free));
    expect(series).toBeNull();
    expect(project.seriesId).toBeNull();
    expect(project.assets).toEqual(emptyAssetLibrary());
  });

  it('validates the migrated pair, and refuses one whose scene lost its art', () => {
    // The point of validating against the merged library: a project whose scenes reference
    // a series nobody has is not drawable, and the only place that is knowable is here.
    const { project, series } = migrateProjectFile(populatedV2File());
    expect(validateProject(project, series)).toEqual([]);

    const stripped: Project = { ...project, seriesId: null };
    // Same project, same scenes, no owner — so the characters its actors reference are gone.
    expect(validateProject(stripped, null).length).toBeGreaterThan(0);
  });
});

describe('v2 -> v3: render neutrality (G4)', () => {
  it('draws every seed scene at every sample identically after the migration', () => {
    // The load-bearing test of Phase 14.
    //
    // Moving the library out of the project is the first migration in this repository that
    // could change what a frame looks like. Every other migration added fields the renderer
    // ignored. "It is a scope change, not a behaviour change" is therefore a *claim*, and
    // this is the thing that turns it into evidence: draw the same scene at the same time
    // from both documents and require the recorded calls to be identical.
    //
    // Recorded calls, not pixels. A PNG comparison would need a decoder, would hide the
    // offending call behind a diff of opaque bytes, and could not name the failure. A call
    // log pinpoints the exact fillStyle or transform that moved.
    const file = populatedV2File();
    const before = v2Context(file);
    const { project, series } = migrateProjectFile(file);

    // Exactly the pilot's five scenes, not "more than one". A fixture that quietly stopped
    // carrying the other four would still satisfy a `> 1` check while covering a quarter of
    // the show — and the coverage is the requirement, so it is stated as a number.
    expect(before.scenes).toHaveLength(SEED_PROJECT.scenes.length);
    expect(before.scenes).toHaveLength(5);

    for (const scene of before.scenes) {
      const migratedScene = project.scenes.find((s) => s.id === scene.id);
      if (!migratedScene) throw new Error(`Migration dropped scene ${scene.id}`);

      // The six samples §6.5 names: the start, two interior moments, a mid-shot, and both
      // edges. The last two matter most — a boundary error (a clip that starts one frame
      // late, a loop that closes at the wrong time) is invisible at t=0 and is exactly what
      // a duration-shifting bug produces.
      const samples = [
        0,
        0.5,
        1.0,
        2.37,
        scene.duration - 0.01,
        scene.duration,
      ];

      for (const time of samples) {
        const beforeCalls = renderToRecording(before.context, scene, time).calls;
        const afterCalls = renderToRecording(
          resolveAssets(project, series),
          migratedScene,
          time,
        ).calls;

        // Two empty logs are trivially equal, so an empty log would pass this test while
        // proving nothing. Both sides have to have actually drawn something.
        expect(beforeCalls.length, `scene ${scene.id} drew nothing before`).toBeGreaterThan(0);
        expect(afterCalls.length, `scene ${scene.id} drew nothing after`).toBeGreaterThan(0);
        expect(afterCalls, `scene ${scene.id} at ${time}s drew differently after migrating`).toEqual(
          beforeCalls,
        );
      }
    }
  });

  it('gives an identical audio plan, because the audio slots moved too', () => {
    // The audio plan is the other consumer of the library. Silently dropping the audio on
    // this migration would render identically — the draw log has no audio in it — and would
    // be a real regression, so it is asserted separately rather than left to inference.
    const file = populatedV2File();
    const before = v2Context(file);
    const { project, series } = migrateProjectFile(file);

    for (const scene of before.scenes) {
      const migratedScene = project.scenes.find((s) => s.id === scene.id);
      if (!migratedScene) throw new Error(`Migration dropped scene ${scene.id}`);
      expect(audioPlan(resolveAssets(project, series), migratedScene)).toEqual(
        audioPlan(before.context, migratedScene),
      );
    }
  });
});

describe('normaliseProject — mouthSlot (R2)', () => {
  it('fills mouthSlot for a character that predates the field', () => {
    // A pre-Phase-15 document carries no mouthSlot at all. The normaliser must give it
    // the house convention so the talk pulse keeps working with no migration step.
    const project = normaliseProject({
      id: 'proj_mouth',
      name: 'Mouth',
      assets: { characters: [{ id: 'char.old', name: 'Old' }] },
    });
    expect(project.assets.characters[0]?.mouthSlot).toBe('mouth');
  });

  it('keeps an authored mouthSlot that is not the house convention', () => {
    const project = normaliseProject({
      id: 'proj_mouth',
      name: 'Mouth',
      assets: { characters: [{ id: 'char.jaw', name: 'Jaw', mouthSlot: 'jaw' }] },
    });
    expect(project.assets.characters[0]?.mouthSlot).toBe('jaw');
  });
});
