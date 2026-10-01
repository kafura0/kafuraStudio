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
import { createTrack } from '../document/factories';
import { SEED_PROJECT } from '../../data/seed';
import type { Episode, Id, Project } from '../../core/types';

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
  const next = project.scenes.map((s) =>
    s.id === scene.id
      ? {
          ...s,
          tracks: s.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  clips: [
                    ...t.clips,
                    {
                      id: 'clip.test',
                      kind: 'audio' as const,
                      start: 0,
                      duration: Math.min(2, s.duration),
                      gain,
                      loop: options.loop ?? false,
                      audioId,
                    },
                  ],
                }
              : t,
          ),
        }
      : s,
  );

  const assets = project.assets.audio.some((a) => a.id === audioId)
    ? project.assets.audio
    : [
        ...project.assets.audio,
        {
          id: audioId,
          name: 'Test Clip',
          // `loop` on a clip is not what makes a segment loop: `audioPlan` decides from the
          // asset's `kind`, and only ambience repeats. So a genuinely looping test segment
          // means declaring an ambience asset, which is what the option is doing here.
          kind: options.loop ? ('ambience' as const) : ('sfx' as const),
          src: 'media.test-clip',
          srcKind: 'local' as const,
          duration: 5,
          tags: [],
        },
      ];

  return {
    project: { ...project, scenes: next, assets: { ...project.assets, audio: assets } },
    audioId,
    sceneId: scene.id,
  };
}

describe('mixdownPlan', () => {
  it('returns null for an episode that is not in the document', () => {
    expect(mixdownPlan(SEED_PROJECT, 'episode.nope')).toBeNull();
  });

  it('reports the episode duration as the mix length', () => {
    const episode = seedEpisode(SEED_PROJECT);
    const plan = mixdownPlan(SEED_PROJECT, episode.id);
    expect(plan).not.toBeNull();
    if (!plan) return;
    expect(plan.duration).toBe(mixdownDuration(SEED_PROJECT, episode.id));
    expect(plan.duration).toBeGreaterThan(0);
  });

  it('plans the seed clips even though every slot is fileless', () => {
    const project = SEED_PROJECT;
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, episode.id);
    if (!plan) throw new Error('seed plan missing');

    // The plan says what *should* be heard, not what is available. The seed declares
    // clips whose assets exist but carry `src: null`, so a plan that filtered on
    // availability would silently be empty and a mixdown built on it would export
    // nothing while reporting success. Deciding what belongs is the plan's job;
    // reporting what is missing is the renderer's, and the two are kept apart so a
    // fileless slot is named rather than dropped.
    expect(plan.placements.length).toBeGreaterThan(0);
    for (const placement of plan.placements) {
      const asset = project.assets.audio.find((a) => a.id === placement.audioId);
      expect(asset).toBeDefined();
      expect(asset?.src).toBeNull();
    }
  });

  it('places a clip on the episode clock, offset by its scene', () => {
    const { project, audioId } = projectWithClip(SEED_PROJECT);
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, episode.id);
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
    const clip = {
      id: 'clip.second',
      kind: 'audio' as const,
      start: 0,
      duration: Math.min(2, secondScene.duration),
      gain: 0.5,
      loop: false,
      audioId: 'audio.second',
    };

    const scenes = project.scenes.map((s) =>
      s.id === secondScene.id
        ? { ...s, tracks: [...s.tracks, { ...createTrack('audio', 'audio.second', 'Ambience', '#334155'), clips: [clip] }] }
        : s,
    );
    const first = project.scenes[0];
    if (!first) throw new Error('seed has no scenes');

    const patched: Project = {
      ...project,
      scenes,
      assets: {
        ...project.assets,
        audio: [
          ...project.assets.audio,
          {
            id: 'audio.second',
            name: 'Second Scene Clip',
            src: 'media.second',
            srcKind: 'local' as const,
            duration: 5,
            tags: [],
          },
        ],
      },
    };

    const plan = mixdownPlan(patched, episode.id);
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
    const plan = mixdownPlan(project, episode.id);
    const placement = plan?.placements.find((p) => p.audioId === audioId);
    expect(placement?.gain).toBe(0.25);
  });

  it('leaves a loop unbounded and records the minimum asset length it needs', () => {
    const { project, audioId } = projectWithClip(SEED_PROJECT, { loop: true });
    const episode = seedEpisode(project);
    const plan = mixdownPlan(project, episode.id);
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
    const plan = mixdownPlan(project, episode.id);
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
    const plan = mixdownPlan(project, episode.id);
    const segments = episodeAudioPlan(project, episode.id);
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
    const plan = mixdownPlan(project, episode.id);
    if (!plan) throw new Error('plan missing');

    for (const placement of plan.placements) {
      expect(placement.start).toBeGreaterThanOrEqual(0);
      expect(placement.start).toBeLessThanOrEqual(plan.duration);
    }
  });
});
