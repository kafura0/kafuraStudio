/**
 * Camera document operations.
 *
 * The camera was already resolvable and already rendered; what is new here is that it
 * can be authored, and these tests pin the two properties that make that safe. First,
 * every compound action is one document, so undo takes one press. Second, a camera
 * keyframe stores its zoom in `scaleX`, because that is what `resolveCamera` samples —
 * getting that wrong would animate `x` and leave the zoom still, which looks like a
 * camera that has drifted sideways.
 */

import { describe, expect, it } from 'vitest';

import { resolveCamera } from '../animation/sample';
import { createSceneInProject } from './projectOps';
import { placeCharacter } from './sceneOps';
import {
  CAMERA_TARGET_ID,
  addCameraMove,
  applyCameraPreset,
  cameraClipAt,
  cameraClips,
  clearCameraMoves,
  frameSelection,
  setSceneCamera,
} from './cameraOps';
import { createCameraPreset, createProject } from './factories';
import { normaliseProject, serializeProject } from '../serialize';
import { validateProject } from './invariants';
import { SEED_PROJECT } from '../../data/seed';
import type { Camera, Clip, Id, Project, Scene } from '../types';

const FRAME = { width: 1920, height: 1080 };
const STILL: Camera = { x: 960, y: 540, zoom: 1, rotation: 0 };

/**
 * A project carrying the seed's real characters, so `frameSelection` can resolve a
 * height. Built by trimming `SEED_PROJECT` rather than inventing a character, because
 * a fabricated fixture would not exercise the lookup that matters here.
 */
function projectWithCharacters(): Project {
  const base = createProject('Camera tests');
  return { ...base, assets: { ...base.assets, characters: [...SEED_PROJECT.assets.characters] } };
}

/**
 * A scene with no environment, so the rest camera starts at the origin and
 * `frameSelection` has to be handed its frame by the caller.
 */
function blankScene(duration = 10): { project: Project; sceneId: Id } {
  return createSceneInProject(projectWithCharacters(), {
    name: 'S1',
    environmentId: '',
    duration,
  });
}

/**
 * The scene under test. Addressed by id rather than index, because the seed project
 * already has scenes of its own and `scenes[0]` would be one of those.
 */
function sceneOf(project: Project, sceneId: Id): Scene {
  const scene = project.scenes.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene ${sceneId}`);
  return scene;
}

/** Every camera clip on a scene, timeline order. */
function cameraClipsOf(project: Project, sceneId: Id): Clip[] {
  return sceneOf(project, sceneId)
    .tracks.filter((t) => t.kind === 'camera')
    .flatMap((t) => t.clips);
}

/** A scene holding `count` seed characters, spread across the frame. */
function sceneWithActors(count: number): { project: Project; sceneId: Id; actorIds: Id[] } {
  const created = blankScene();
  let project = created.project;
  const actorIds: Id[] = [];

  for (let i = 0; i < count; i += 1) {
    const character = project.assets.characters[i % project.assets.characters.length]!;
    const placed = placeCharacter(project, created.sceneId, character, {
      x: 500 + i * 500,
      y: 900,
    });
    project = placed.project;
    actorIds.push(placed.actorId);
  }

  return { project, sceneId: created.sceneId, actorIds };
}

describe('setSceneCamera', () => {
  it('sets one field and leaves the rest alone', () => {
    const { project, sceneId } = blankScene();
    const next = setSceneCamera(project, sceneId, { zoom: 2 });
    // A scene with no environment starts at the origin; the other fields keep it.
    expect(sceneOf(next, sceneId).camera).toEqual({ x: 0, y: 0, zoom: 2, rotation: 0 });
  });

  it('sets all four fields at once', () => {
    const { project, sceneId } = blankScene();
    const next = setSceneCamera(project, sceneId, { x: 10, y: 20, zoom: 3, rotation: 0.5 });
    expect(sceneOf(next, sceneId).camera).toEqual({ x: 10, y: 20, zoom: 3, rotation: 0.5 });
  });

  it('returns the same project when the patch changes nothing', () => {
    const { project, sceneId } = blankScene();
    // A blur after a stray keystroke must not add a no-op to the undo stack.
    expect(setSceneCamera(project, sceneId, { zoom: 1 })).toBe(project);
  });

  it('does not mutate the input', () => {
    const { project, sceneId } = blankScene();
    const before = { ...sceneOf(project, sceneId).camera };
    setSceneCamera(project, sceneId, { x: 1 });
    expect(sceneOf(project, sceneId).camera).toEqual(before);
  });
});

describe('addCameraMove', () => {
  it('lays a clip over the whole scene with one holding keyframe', () => {
    const { project, sceneId } = blankScene();
    const { project: next, handle } = addCameraMove(project, sceneId, {
      x: 100,
      y: 200,
      zoom: 1.5,
      rotation: 0,
    });

    const clip = cameraClipsOf(next, sceneId)[0]!;
    expect(clip.start).toBe(0);
    expect(clip.duration).toBe(10);
    expect(clip.keyframes).toHaveLength(1);
    expect(handle.keyframeId).toBe(clip.keyframes[0]!.id);
  });

  it('writes the zoom into scaleX, which is what the sampler reads', () => {
    const { project, sceneId } = blankScene();
    const camera: Camera = { x: 100, y: 200, zoom: 1.5, rotation: 0.3 };
    const { project: next } = addCameraMove(project, sceneId, camera);

    expect(cameraClipsOf(next, sceneId)[0]!.keyframes[0]!.props).toEqual({
      x: 100,
      y: 200,
      scaleX: 1.5,
    });

    // And the round trip through the sampler gives back the same framing.
    const scene = sceneOf(next, sceneId);
    const resolved = resolveCamera(
      scene.camera,
      scene.tracks.filter((t) => t.kind === 'camera').flatMap((t) => t.clips),
      3,
    );
    expect(resolved.x).toBe(100);
    expect(resolved.y).toBe(200);
    expect(resolved.zoom).toBe(1.5);
    // A camera keyframe carries no tilt, so the rest framing's is used. Worth pinning:
    // it is the reason a "push in" preset cannot silently straighten a Dutch angle.
    expect(resolved.rotation).toBe(scene.camera.rotation);
  });

  it('hangs the clip off the single camera target', () => {
    const { project, sceneId } = blankScene();
    const { project: next } = addCameraMove(project, sceneId, STILL);
    expect(sceneOf(next, sceneId).tracks.find((t) => t.kind === 'camera')!.targetId).toBe(CAMERA_TARGET_ID);
  });

  it('honours an explicit span', () => {
    const { project, sceneId } = blankScene();
    const { project: next } = addCameraMove(project, sceneId, STILL, { start: 2, duration: 3 });
    const clip = cameraClipsOf(next, sceneId)[0]!;
    expect([clip.start, clip.duration]).toEqual([2, 3]);
  });

  it('reuses the camera track instead of adding a second lane', () => {
    const { project, sceneId } = blankScene();
    const first = addCameraMove(project, sceneId, STILL);
    const second = addCameraMove(first.project, sceneId, { ...STILL, zoom: 2 });
    expect(sceneOf(second.project, sceneId).tracks.filter((t) => t.kind === 'camera')).toHaveLength(1);
    expect(cameraClipsOf(second.project, sceneId)).toHaveLength(2);
  });
});

describe('cameraClipAt / cameraClips / clearCameraMoves', () => {
  it('reports no clip before any move exists', () => {
    const { project, sceneId } = blankScene();
    expect(cameraClipAt(sceneOf(project, sceneId), 0)).toBeNull();
    expect(cameraClips(sceneOf(project, sceneId))).toEqual([]);
  });

  it('finds the clip under the playhead and nothing outside it', () => {
    const { project, sceneId } = blankScene();
    const { project: next } = addCameraMove(project, sceneId, STILL, { start: 2, duration: 4 });
    const scene = sceneOf(next, sceneId);
    expect(cameraClipAt(scene, 3)).not.toBeNull();
    expect(cameraClipAt(scene, 1)).toBeNull();
    expect(cameraClipAt(scene, 6)).toBeNull();
  });

  it('clears the clips and keeps the lane', () => {
    const { project, sceneId } = blankScene();
    const withMove = addCameraMove(project, sceneId, STILL).project;
    const cleared = clearCameraMoves(withMove, sceneId);
    expect(cameraClipsOf(cleared, sceneId)).toEqual([]);
    expect(sceneOf(cleared, sceneId).tracks.some((t) => t.kind === 'camera')).toBe(true);
  });

  it('returns the same project when there is nothing to clear', () => {
    const { project, sceneId } = blankScene();
    expect(clearCameraMoves(project, sceneId)).toBe(project);
  });
});

describe('applyCameraPreset', () => {
  const preset = createCameraPreset('Wide', { x: 960, y: 540, zoom: 0.8, rotation: 0 });

  it('adopts the preset camera as the rest framing', () => {
    const { project, sceneId } = blankScene();
    expect(sceneOf(applyCameraPreset(project, sceneId, preset), sceneId).camera).toEqual(preset.camera);
  });

  it('lays one camera move holding the preset across the scene', () => {
    const { project, sceneId } = blankScene();
    const clips = cameraClipsOf(applyCameraPreset(project, sceneId, preset), sceneId);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.start).toBe(0);
    expect(clips[0]!.duration).toBe(10);
    expect(clips[0]!.keyframes[0]!.props).toEqual({ x: 960, y: 540, scaleX: 0.8 });
  });

  it('replaces an existing move rather than stacking on it', () => {
    const { project, sceneId } = blankScene();
    const moved = addCameraMove(project, sceneId, { ...STILL, zoom: 3 }).project;
    const clips = cameraClipsOf(applyCameraPreset(moved, sceneId, preset), sceneId);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.keyframes[0]!.props).toEqual({ x: 960, y: 540, scaleX: 0.8 });
  });

  it('keeps the move starting where the old one started', () => {
    // A shot whose move starts at 3s should not silently re-cut to 0s.
    const { project, sceneId } = blankScene();
    const moved = addCameraMove(project, sceneId, STILL, { start: 3, duration: 4 }).project;
    const clip = cameraClipsOf(applyCameraPreset(moved, sceneId, preset), sceneId)[0]!;
    expect(clip.start).toBe(3);
    expect(clip.duration).toBe(7);
  });

  it('copies the camera by value, so later edits cannot move the preset', () => {
    const { project, sceneId } = blankScene();
    const applied = applyCameraPreset(project, sceneId, preset);
    setSceneCamera(applied, sceneId, { zoom: 3 });
    expect(preset.camera.zoom).toBe(0.8);
  });

  it('leaves no preset reference on the scene', () => {
    // Presets are values, not references: the scene must stay self-describing, or a
    // project-level rename would silently rewrite finished shots.
    const { project, sceneId } = blankScene();
    const next = applyCameraPreset(project, sceneId, preset);
    expect(JSON.stringify(sceneOf(next, sceneId))).not.toContain(preset.id);
  });
});

describe('frameSelection', () => {
  it('frames a single actor by centring on them', () => {
    const { project, sceneId, actorIds } = sceneWithActors(1);
    const next = frameSelection(project, sceneId, actorIds, { frame: FRAME });
    // One actor standing at x=500, so the camera sits on them.
    expect(sceneOf(next, sceneId).camera.x).toBe(500);
    expect(sceneOf(next, sceneId).camera.y).toBe(900 - project.assets.characters[0]!.height / 2);
  });

  it('leaves the zoom alone when the selection already fits the frame', () => {
    const { project, sceneId, actorIds } = sceneWithActors(1);
    // A 640-tall actor in a 1080 frame needs zoom 0.73 to fit with margin, and the
    // default minimum of 1 refuses to show past the authored frame. Zoom 1 is the
    // tightest framing that is still correct.
    const next = frameSelection(project, sceneId, actorIds, { frame: FRAME });
    expect(sceneOf(next, sceneId).camera.zoom).toBe(1);
  });

  it('frames two actors to fit, pulling back rather than cropping one', () => {
    const created = blankScene();
    let project = created.project;
    const actorIds: Id[] = [];
    // Placed at opposite edges, so the pair genuinely does not fit at zoom 1.
    for (const x of [200, 1750]) {
      const placed = placeCharacter(project, created.sceneId, SEED_PROJECT.assets.characters[0]!, {
        x,
        y: 900,
      });
      project = placed.project;
      actorIds.push(placed.actorId);
    }

    const camera = sceneOf(frameSelection(project, created.sceneId, actorIds, { frame: FRAME }), created.sceneId)
      .camera;
    expect(camera.zoom).toBeGreaterThan(1);
    // And it centres between them rather than on either.
    expect(camera.x).toBeCloseTo(975, 6);
  });

  it('can pull back past the authored frame when the caller allows it', () => {
    const { project, sceneId, actorIds } = sceneWithActors(1);
    const next = frameSelection(project, sceneId, actorIds, { frame: FRAME, minZoom: 0 });
    const height = project.assets.characters[0]!.height;
    expect(sceneOf(next, sceneId).camera.zoom).toBeCloseTo((height * 1.24) / 1080, 6);
  });

  it('produces one camera move, not a keyframe per axis', () => {
    const { project, sceneId, actorIds } = sceneWithActors(2);
    const clips = cameraClipsOf(frameSelection(project, sceneId, actorIds, { frame: FRAME }), sceneId);
    expect(clips).toHaveLength(1);
    expect(clips[0]!.keyframes).toHaveLength(1);
  });

  it('preserves a camera tilt the user had already chosen', () => {
    const { project, sceneId, actorIds } = sceneWithActors(1);
    const tilted = setSceneCamera(project, sceneId, { rotation: 0.3 });
    const next = frameSelection(tilted, sceneId, actorIds, { frame: FRAME });
    expect(sceneOf(next, sceneId).camera.rotation).toBeCloseTo(0.3, 6);
  });

  it('frames against the environment size, not the frame the caller passed', () => {
    const created = createSceneInProject(SEED_PROJECT, {
      name: 'Framing',
      environmentId: SEED_PROJECT.assets.environments[0]!.id,
    });
    const character = SEED_PROJECT.assets.characters[0]!;
    const environment = SEED_PROJECT.assets.environments[0]!;
    const placed = placeCharacter(created.project, created.sceneId, character, { x: 960, y: 900 });

    // The environment, not the argument, decides the frame size when the scene has
    // one. minZoom is opened up so the arithmetic is visible rather than clamped.
    const opened = frameSelection(placed.project, created.sceneId, [placed.actorId], {
      frame: FRAME,
      minZoom: 0,
    });
    expect(sceneOf(opened, created.sceneId).camera.zoom).toBeCloseTo(
      (character.height * 1.24) / environment.height,
      6,
    );
  });

  it('ignores actors that are not in the scene', () => {
    const { project, sceneId } = sceneWithActors(1);
    expect(frameSelection(project, sceneId, ['ghost'], { frame: FRAME })).toBe(project);
  });

  it('ignores an actor whose character is missing, rather than framing zero height', () => {
    const { project, sceneId, actorIds } = sceneWithActors(1);
    const scene = sceneOf(project, sceneId);
    const orphaned: Project = {
      ...project,
      scenes: [
        {
          ...scene,
          actors: scene.actors.map((actor, i) =>
            i === 0 ? { ...actor, characterId: 'char.missing' } : actor,
          ),
        },
      ],
    };
    // A zero-height box is not a subject; including one would shrink the shot to nothing.
    expect(frameSelection(orphaned, sceneId, actorIds, { frame: FRAME })).toBe(orphaned);
  });

  it('returns the same project when the selection is empty', () => {
    const { project, sceneId } = sceneWithActors(2);
    expect(frameSelection(project, sceneId, [], { frame: FRAME })).toBe(project);
  });
});

describe('cameraPresets in the document', () => {
  it('defaults to empty on a new project', () => {
    expect(createProject('fresh').cameraPresets).toEqual([]);
  });

  it('parses a v1 document written before the field existed', () => {
    const file = JSON.parse(serializeProject(createProject('legacy'))) as {
      formatVersion: number;
      project: Record<string, unknown>;
    };
    delete file.project.cameraPresets;
    file.formatVersion = 1;

    const parsed = normaliseProject(file.project);
    expect(parsed.cameraPresets).toEqual([]);
  });

  it('round trips a preset', () => {
    const preset = createCameraPreset('Wide', { x: 1, y: 2, zoom: 3, rotation: 0.5 }, {
      description: 'Two shot',
      tags: ['wide'],
    });
    const written = serializeProject({ ...createProject('with presets'), cameraPresets: [preset] });
    const parsed = normaliseProject(
      (JSON.parse(written) as { project: Record<string, unknown> }).project,
    );
    expect(parsed.cameraPresets).toEqual([preset]);
  });

  it('reports a duplicate preset id', () => {
    const preset = createCameraPreset('Wide', STILL);
    const issues = validateProject({ ...createProject('dupes'), cameraPresets: [preset, preset] });
    expect(issues.some((i) => i.message.includes('Duplicate camera preset id'))).toBe(true);
  });

  it('reports a non-finite camera value, which would otherwise render blank', () => {
    const preset = createCameraPreset('Broken', { ...STILL, zoom: Number.NaN });
    const issues = validateProject({ ...createProject('nan'), cameraPresets: [preset] });
    expect(issues.some((i) => i.message.includes('not a finite number'))).toBe(true);
  });

  it('passes validation for the seeded presets', () => {
    expect(SEED_PROJECT.cameraPresets.length).toBeGreaterThan(0);
    const issues = validateProject(SEED_PROJECT).filter((i) => i.path.startsWith('cameraPresets'));
    expect(issues).toEqual([]);
  });
});
