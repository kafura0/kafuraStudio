/**
 * The mixdown decision, without Web Audio.
 *
 * `mixdown.browser.ts` needs a real `OfflineAudioContext` to render anything, and `vitest`
 * has no Web Audio. So the *decision* — which sounds play, at which episode time, at what
 * gain, looping or not — is split into `mixdownPlan` and tested here, while the rendering
 * that executes it is left to the browser acceptance run.
 *
 * This is the split that matters. A segment scheduled on the scene clock instead of the
 * episode clock produces a file that renders, plays, and is a scene out of time for every
 * scene after the first. No test that checks "the file exists" or "the file is the right
 * length" can see that. These tests can.
 */

import { describe, expect, it } from 'vitest';
import { mixdownPlan } from './mixdownPlan';
import { mixdownDuration } from './mixdown.browser';
import { episodeAudioPlan } from '../audio/episodePlan';
import { createClip, createTrack } from '../document/factories';
import { SEED_PROJECT, SEED_SERIES } from '../../data/seed';
import { resolveAssets } from '../document/scopes';
import type { AudioDef, Clip, Episode, Id, Project, SceneContext } from '../../core/types';

/**
 * The seed project's own ssets is the override list and is empty; the library lives on
 * SEED_SERIES. Resolving is what the editor does before any of this runs, so the tests do it
 * explicitly rather than reading the override list and planning silence.
 */
function ctx(project: Project): SceneContext {
  return resolveAssets(project, SEED_SERIES);
}

function seedEpisode(project: Project): Episode {
  const episode = project.episodes[0];
  if (!episode) throw new Error('seed has no episode');
  return episode;
}

/**
 * A project whose scenes carry a real audio clip, built by attaching an asset to a scene
 * from the seed. The shipped seed has every slot fileless, so without this the plan could
 * only ever be asserted empty — which is exactly the case where the interesting arithmetic
 * does not run.
 */
function projectWithClip(project: Project, options: { loop?: boolean; gain?: number } = {}): {
  project: Project;
  audioId: Id;
  sceneId: Id;
} {
  const episode = seedEpisode(project);
  const scene = project.scenes.find((s) => episode.sceneIds.includes(s.id));
  if (!scene) throw new Error('seed episode has no scene');

  const audioId = 'audio.test-clip';
  const trackId = scene.tracks.find((t) => t.kind === 'audio')?.id;
  if (!trackId) throw new Error('seed scene has no audio track');

  const gain = options.gain ?? 0.5;
  // A real `Clip`, not an object literal that happens to have the right keys. `Clip` also
  // carries `keyframes` and `dialogueLineId`, and a spread-built literal that omits them
  // is a `Clip` only until the type checker is asked. `loop` on the clip is not what makes
  // a segment loop — `audioPlan` decides from the asset's `kind` — so the loop case is
  // expressed by the asset below, not here.
  const clip: Clip = createClip(0, Math.min(2, scene.duration), { audioId, gain });
  const next = project.scenes.map((s) =>
    s.id === scene.id
      ? { ...s, tracks: s.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, clip] } : t)) }
      : s,
  );

  // Only ambience loops: `audioPlan` reads `kind`, so an `sfx` slot is what makes a
  // one-shot segment, whatever the clip says.
  const asset: AudioDef = {
    id: audioId,
    name: 'Test Clip',
    kind: options.loop ? 'ambience' : 'sfx',
    src: 'media.test-clip',
    srcKind: 'local',
    duration: 5,
    tags: [],
  };
  const assets = project.assets.audio.some((a) => a.id === audioId)
    ? project.assets.audio
    : [...project.assets.audio, asset];

  return {
    project: { ...project, scenes: next, assets: { ...project.assets, audio: assets } },
    audioId,
    sceneId: scene.id,
  };
}

describe('mixdownPlan', () => {
  it('returns null for an episode that is not in the document', () => {
    expect(mixdownPlan(SEED_PROJECT, ctx(SEED_PROJECT), 'episode.nope')).toBeNull();
  });

  it('reports the episode duration as the mix length', () => {
    const episode = seedEpisode(SEED_PROJECT);
    const plan = mixdownPlan(SEED_PROJECT, ctx(SEED_PROJECT), episode.id);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.duration).toBe(mixdownDuration(SEED_PROJECT, episode.id));
    expect(plan.duration).toBeGreaterThan(0);
  });

  it('plans the seed clips even though every slot is fileless', () => {
    const project = SEED_PROJECT;
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, ctx(project), episode.id);
    if (!plan) throw new Error('seed plan missing');

    // The plan says what *should* be heard, not what is available. The seed declares
    // clips whose assets exist but carry `src: null`, so a plan that filtered on
    // availability would silently be empty and a mixdown built on it would export
    // nothing while reporting success. Deciding what belongs is the plan's job;
    // reporting what is missing is the renderer's, and the two are kept apart so a
    // fileless slot is named rather than dropped.
    expect(plan.placements.length).toBeGreaterThan(0);
    for (const placement of plan.placements) {
      const asset = ctx(project).assets.audio.find((a) => a.id === placement.audioId);
      expect(asset).toBeDefined();
      expect(asset?.src).toBeNull();
    }
  });

  it('places a clip on the episode clock, offset by its scene', () => {
    const { project, audioId } = projectWithClip(SEED_PROJECT);
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, ctx(project), episode.id);
    if (!plan) throw new Error('plan missing');

    const placement = plan.placements.find((p) => p.audioId === audioId);
    expect(placement).toBeDefined();
    if (!placement) return;

    // The clip starts at local 0 of the first scene, which is episode 0. A plan that used
    // the scene clock would be indistinguishable here, which is why the second-scene case
    // below exists.
    expect(placement.start).toBe(0);
    expect(placement.sceneId).toBe(project.scenes[0]?.id);
  });

  it('offsets a later scene by the scenes before it', () => {
    const project = SEED_PROJECT;
    const episode = seedEpisode(project);
    const secondScene = project.scenes.find((s) => s.id === episode.sceneIds[1]);
    if (!secondScene) throw new Error('seed episode has no second scene');

    // Put the clip at local 0 of the SECOND scene, where scene and episode clocks differ.
    // A fresh track is added rather than reusing whatever that scene happens to have, so
    // the test does not depend on the seed's track layout.
    const clip = createClip(0, Math.min(2, secondScene.duration), {
      audioId: 'audio.second',
      gain: 0.5,
    });

    const scenes = project.scenes.map((s) =>
      s.id === secondScene.id
        ? { ...s, tracks: [...s.tracks, { ...createTrack('audio', 'audio.second', 'Ambience', '#334155'), clips: [clip] }] }
        : s,
    );
    const first = project.scenes[0];
    if (!first) throw new Error('seed has no scenes');

    const secondAsset: AudioDef = {
      id: 'audio.second',
      name: 'Second Scene Clip',
      kind: 'sfx',
      src: 'media.second',
      srcKind: 'local',
      duration: 5,
      tags: [],
    };

    const patched: Project = {
      ...project,
      scenes,
      assets: { ...project.assets, audio: [...project.assets.audio, secondAsset] },
    };

    const plan = mixdownPlan(patched, ctx(patched), episode.id);
    if (!plan) throw new Error('plan missing');
    const placement = plan.placements.find((p) => p.audioId === 'audio.second');
    expect(placement).toBeDefined();
    if (!placement || !first) return;

    // The whole point: episode time, which is the first scene's length, not 0.
    expect(placement.start).toBeCloseTo(first.duration, 10);
    expect(placement.start).toBeGreaterThan(0);
    expect(placement.start).toBeLessThanOrEqual(plan.duration);
  });

  it('carries gain through unchanged', () => {
    const { project, audioId } = projectWithClip(SEED_PROJECT, { gain: 0.25 });
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, ctx(project), episode.id);
    const placement = plan?.placements.find((p) => p.audioId === audioId);
    expect(placement?.gain).toBe(0.25);
  });

  it('leaves a loop unbounded and records the minimum asset length it needs', () => {
    const { project, audioId } = projectWithClip(SEED_PROJECT, { loop: true });
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, ctx(project), episode.id);
    const placement = plan?.placements.find((p) => p.audioId === audioId);
    expect(placement).toBeDefined();
    if (!placement) return;

    // `duration: null` is the loop telling the renderer not to cap it at one pass.
    expect(placement.loop).toBe(true);
    expect(placement.duration).toBeNull();
    expect(placement.minimumAssetDuration).toBeGreaterThan(0);
  });

  it('bounds a one-shot by its clip window', () => {
    const { project, audioId } = projectWithClip(SEED_PROJECT, { loop: false });
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, ctx(project), episode.id);
    const placement = plan?.placements.find((p) => p.audioId === audioId);
    expect(placement?.loop).toBe(false);
    expect(placement?.duration).not.toBeNull();
    expect(placement?.duration ?? 0).toBeLessThanOrEqual(
      placement?.minimumAssetDuration ?? 0,
    );
  });

  it('agrees with episodeAudioPlan exactly, in order', () => {
    const { project } = projectWithClip(SEED_PROJECT);
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, ctx(project), episode.id);
    const segments = episodeAudioPlan(project, ctx(project), episode.id);
    if (!plan) throw new Error('plan missing');

    expect(plan.placements).toHaveLength(segments.length);
    plan.placements.forEach((placement, i) => {
      const segment = segments[i];
      if (!segment) throw new Error('segment missing');
      expect(placement.audioId).toBe(segment.audioId);
      expect(placement.start).toBeCloseTo(segment.episodeStart, 10);
      expect(placement.gain).toBe(segment.gain);
      expect(placement.loop).toBe(segment.loop);
    });
  });

  it('keeps every placement inside the mix', () => {
    const { project } = projectWithClip(SEED_PROJECT);
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, ctx(project), episode.id);
    if (!plan) throw new Error('plan missing');

    for (const placement of plan.placements) {
      expect(placement.start).toBeGreaterThanOrEqual(0);
      expect(placement.start).toBeLessThanOrEqual(plan.duration);
    }
  });
});
