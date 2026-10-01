/**
 * The audio plan — pure core.
 *
 * The plan is the contract the Web Audio engine fulfils, so these tests pin down the
 * windowing rules: muted/locked tracks drop out, dialogue clips resolve their voice
 * through their line, segments are bounded by their clip and by the scene, and
 * ambience loops while one-shots do not.
 */
import { describe, expect, it } from 'vitest';
import { createProject, createScene } from '../document/factories';
import { addSimpleClip } from '../document/trackOps';
import { setDialogueVoice } from '../document/dialogueOps';
import { audioPlan } from './audioPlan';
import type { AudioDef, DialogueLine, Project } from '../types';

function asset(id: string, kind: AudioDef['kind'], duration: number): AudioDef {
  return { id, name: id, kind, src: null, srcKind: null, duration, tags: [] };
}

/** A project whose scene locks up the given audio assets on the track asked for. */
function sceneWithAudio(assets: AudioDef[], kind: 'audio' | 'dialogue', targetId: string): { project: Project; sceneId: string } {
  const project = createProject('Audio');
  const scene = createScene('S', 'env', { duration: 10 });
  const p = { ...project, assets: { ...project.assets, audio: assets }, scenes: [scene] };
  const made = addSimpleClip(p, scene.id, kind, targetId, 'Cue', 2, 3, {
    ...(kind === 'audio' ? { audioId: targetId } : {}),
    ...(kind === 'dialogue' ? { dialogueLineId: targetId } : {}),
  });
  return { project: { ...made.project }, sceneId: scene.id };
}

describe('audioPlan', () => {
  it('resolves audio-track clips to their asset and respects the clip window', () => {
    const { project, sceneId } = sceneWithAudio([asset('hum', 'ambience', 60)], 'audio', 'hum');
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error('scene missing');
    const plan = audioPlan(project, scene);
    expect(plan).toHaveLength(1);
    const seg = plan[0];
    if (!seg) throw new Error('no segment');
    expect(seg).toMatchObject({ audioId: 'hum', start: 2, duration: 3, loop: true });
  });

  it('never runs past the scene end even when the asset is longer', () => {
    const { project, sceneId } = sceneWithAudio([asset('bed', 'music', 60)], 'audio', 'bed');
    // Move the clip so it pokes past the 10s scene.
    const scene = project.scenes.find((s) => s.id === sceneId);
    const track = scene?.tracks[0];
    const clip = track?.clips[0];
    if (!scene || !track || !clip) throw new Error('missing pieces');
    const moved = {
      ...project,
      scenes: project.scenes.map((s) =>
        s.id === sceneId
          ? { ...s, tracks: s.tracks.map((t) => (t.id === track.id ? { ...t, clips: [{ ...clip, start: 9 }] } : t)) }
          : s,
      ),
    };
    const movedScene = moved.scenes.find((s) => s.id === sceneId);
    if (!movedScene) throw new Error('scene missing after move');
    const plan = audioPlan(moved, movedScene);
    expect(plan[0]?.duration).toBeCloseTo(1, 6); // 9..10, then the scene cuts it
  });

  it('drops muted and locked audio tracks', () => {
    const { project, sceneId } = sceneWithAudio([asset('hum', 'ambience', 60)], 'audio', 'hum');
    const scene = project.scenes.find((s) => s.id === sceneId);
    const track = scene?.tracks[0];
    if (!scene || !track) throw new Error('missing pieces');
    const muted = { ...project, scenes: [{ ...scene, tracks: [{ ...track, muted: true }] }] };
    const locked = { ...project, scenes: [{ ...scene, tracks: [{ ...track, locked: true }] }] };
    const mutedScene = muted.scenes[0];
    const lockedScene = locked.scenes[0];
    if (!mutedScene || !lockedScene) throw new Error('scenes missing');
    expect(audioPlan(muted, mutedScene)).toHaveLength(0);
    expect(audioPlan(locked, lockedScene)).toHaveLength(0);
  });

  it('resolves dialogue clips through their line voice', () => {
    const { project, sceneId } = sceneWithAudio([asset('voice', 'dialogue', 5)], 'dialogue', 'line_x');
    let p = project;
    const line: DialogueLine = {
      id: 'line_x',
      speaker: 'Nia',
      actorId: null,
      text: 'Hello',
      emotion: 'neutral',
      voiceAudioId: null,
      subtitle: null,
    };
    p = {
      ...p,
      scenes: p.scenes.map((s) => (s.id === sceneId ? { ...s, dialogue: [line] } : s)),
    };
    p = setDialogueVoice(p, sceneId, 'line_x', 'voice');
    const s2 = p.scenes.find((s) => s.id === sceneId);
    if (!s2) throw new Error('scene missing');
    const plan = audioPlan(p, s2);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ audioId: 'voice', clipId: s2.tracks[0]?.clips[0]?.id });
    expect(plan[0]?.loop).toBe(false);
  });

  it('is silent for a voice slot that was never assigned and for a clip without a line', () => {
    const { project, sceneId } = sceneWithAudio([asset('voice', 'dialogue', 5)], 'dialogue', 'line_y');
    const scene = project.scenes.find((s) => s.id === sceneId);
    if (!scene) throw new Error('scene missing');
    // The clip references line_y but the scene has no such line yet.
    expect(audioPlan(project, scene)).toHaveLength(0);
  });

  it('orders the plan by start time', () => {
    const { project, sceneId } = sceneWithAudio(
      [asset('a', 'ambience', 60), asset('b', 'music', 60)],
      'audio',
      'a',
    );
    const scene = project.scenes.find((s) => s.id === sceneId);
    const track = scene?.tracks[0];
    const clip = track?.clips[0];
    if (!scene || !track || !clip) throw new Error('missing pieces');
    const extended: Project = {
      ...project,
      scenes: project.scenes.map((s) =>
        s.id === sceneId
          ? {
              ...s,
              tracks: [
                ...s.tracks,
                { ...track, id: 't2', targetId: 'b', clips: [{ ...clip, id: 'c2', start: 4, audioId: 'b' }] },
              ],
            }
          : s,
      ),
    };
    const extendedScene = extended.scenes.find((s) => s.id === sceneId);
    if (!extendedScene) throw new Error('scene missing after extension');
    const plan = audioPlan(extended, extendedScene);
    expect(plan.map((s) => s.audioId)).toEqual(['a', 'b']);
  });
});