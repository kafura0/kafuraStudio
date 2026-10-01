/**
 * The exporter must draw the frames the stage draws.
 *
 * This is step 4 of Phase 12 and the phase's real test. Steps 2 and 3 produce PNGs, and a
 * PNG cannot be asserted on without decoding it into pixels, so eyeballing a still would
 * be the only available check. There is a stronger one available, and it is the reason
 * `RecordingContext` exists.
 *
 * The export path and the stage path both end in a single call to `renderScene`. If the
 * exporter's draw log is the same as the log from a direct `renderScene` call at the same
 * time, then the two paths differ in *nothing* observable: same resolution, same pixel
 * ratio, same subtitle flag, same draw order, same transforms. A pixel comparison could
 * only ever prove they agree for the frames somebody thought to compare. The draw log
 * proves they agree for every frame, at every time, and it fails loudly the moment either
 * path changes shape.
 *
 * The asymmetry this catches, and the reason it is worth doing: the stage draws one scene
 * at a size derived from the panel it is in, at a device pixel ratio, from a loop that
 * reads the store. The exporter draws a flat sequence at a fixed resolution, with no loop
 * and no store. Those differences are exactly the ones that produce an export that looks
 * right at 100% and is subtly wrong on disk.
 *
 * The exporter's real function is called here, not a copy of it. `drawExportFrame` takes a
 * `Canvas2DLike`, so the production code runs against the recorder unchanged; a test that
 * reimplemented the call would compare two implementations rather than two runs of one.
 */

import { describe, expect, it } from 'vitest';
import { frameSequence } from '../core/export/frameSequence';
import { exportTimeline, resolveExportFrame } from '../core/export/resolveFrame';
import { drawExportFrame } from '../core/export/exportImages.browser';
import { renderScene, activeSubtitle } from '../core/render/render';
import type { Project } from '../core/types';
import { RecordingContext, type DrawOp } from './recordingContext';
import { SEED_PROJECT } from '../data/seed';

/** What the exporter passes. Any drift from the stage shows up here. */
const EXPORT_WIDTH = 1920;
const EXPORT_HEIGHT = 1080;
const EXPORT_PIXEL_RATIO = 1;
const EXPORT_SUBTITLES = true;

/**
 * Draw a frame through the exporter's own entry point, minus the canvas and the
 * `toBlob`. The surface is a recorder because the assertion is about *what was asked
 * for*, not what came out.
 */
function drawAsExporter(
  project: Project,
  frame: ReturnType<typeof resolveExportFrame>,
  subtitles = EXPORT_SUBTITLES,
): DrawOp[] {
  const ctx = new RecordingContext();
  drawExportFrame(ctx, project, frame, { subtitles });
  return ctx.calls;
}

/** The same instant drawn the way `Stage.tsx` draws: a direct `renderScene` call. */
function drawAsStage(
  project: Project,
  frame: ReturnType<typeof resolveExportFrame>,
  subtitles = EXPORT_SUBTITLES,
): DrawOp[] {
  const ctx = new RecordingContext();
  renderScene(ctx, project, frame.scene, frame.sceneTime, {
    width: EXPORT_WIDTH,
    height: EXPORT_HEIGHT,
    pixelRatio: EXPORT_PIXEL_RATIO,
    subtitles,
  });
  return ctx.calls;
}

function seedFrame(index: number, time: number): ReturnType<typeof resolveExportFrame> {
  const project = SEED_PROJECT;
  const episode = project.episodes[0];
  if (!episode) throw new Error('seed has no episode');
  const timeline = exportTimeline(project, episode.id);
  if (!timeline) throw new Error('seed episode did not flatten');
  return resolveExportFrame(project, timeline, index, time);
}

/**
 * The first frame of the seed episode that has a subtitle *on screen*.
 *
 * Not merely a frame in a scene that contains dialogue: a subtitle is only drawn while
 * its clip is playing, and most frames of a scene are spoken over by a different line or
 * by nothing at all. Looking for a frame with a subtitle actually drawn is the only way
 * the "off" and "on" logs are guaranteed to differ, and therefore the only way the
 * burn-in assertions below can fail if the flag stops being applied.
 */
function firstSubtitledFrame(): ReturnType<typeof resolveExportFrame> {
  const project = SEED_PROJECT;
  const episode = project.episodes[0];
  if (!episode) throw new Error('seed has no episode');
  const timeline = exportTimeline(project, episode.id);
  if (!timeline) throw new Error('seed episode did not flatten');

  const subtitled = frameSequence(undefined, episode, project)
    .map((f) => resolveExportFrame(project, timeline, f.index, f.time))
    .find((f) => activeSubtitle(f.scene, f.sceneTime) !== null);
  if (!subtitled) throw new Error('seed episode has no frame with a visible subtitle');
  return subtitled;
}

describe('export draw log equals the stage draw log', () => {
  it(
    'draws every frame of the seed episode identically to a direct renderScene call',
    () => {
      const project = SEED_PROJECT;
      const episode = project.episodes[0];
      if (!episode) throw new Error('seed has no episode');

      const timeline = exportTimeline(project, episode.id);
      if (!timeline) throw new Error('seed episode did not flatten');

      const frames = frameSequence(undefined, episode, project);
      expect(frames.length).toBeGreaterThan(0);

      for (const frame of frames) {
        const resolved = resolveExportFrame(project, timeline, frame.index, frame.time);
        expect(drawAsExporter(project, resolved)).toEqual(drawAsStage(project, resolved));
      }
    },
    // The whole episode is rendered twice, and recording several hundred thousand draw
    // calls is not fast. This is the phase's central test, so it is worth the wait
    // rather than sampling a subset of frames and calling that coverage.
    120_000,
  );

  it('is not trivially empty: a real frame records thousands of operations', () => {
    // Guards the test above. Two empty logs are deep-equal, so a resolver that drew
    // nothing would pass every comparison while proving nothing.
    const log = drawAsExporter(SEED_PROJECT, seedFrame(0, 0));
    expect(log.length).toBeGreaterThan(500);
  });

  it('resolves each frame to the scene the cut says owns that instant', () => {
    const project = SEED_PROJECT;
    const episode = project.episodes[0];
    if (!episode) throw new Error('seed has no episode');
    const timeline = exportTimeline(project, episode.id);
    if (!timeline) throw new Error('seed episode did not flatten');

    // The first scene's own duration is exactly the instant scene two takes over. The
    // frame nearest it from below must still be scene one; a frame sampled on it would
    // already be scene two, which is the boundary error this guards.
    const boundary = timeline.segments[0]?.end;
    expect(boundary).toBeDefined();
    if (boundary === undefined) return;

    const justBefore = resolveExportFrame(project, timeline, 0, boundary - 1e-6);
    const exactly = resolveExportFrame(project, timeline, 1, boundary);

    expect(justBefore.scene.id).toBe(timeline.segments[0]?.scene.id);
    expect(exactly.scene.id).toBe(timeline.segments[1]?.scene.id);
    expect(exactly.sceneTime).toBeCloseTo(0, 10);
  });

  it('changes the log when subtitles are toggled off, so the flag is really applied', () => {
    // Without this, the equality below would hold even if `subtitles` were ignored.
    const spoken = firstSubtitledFrame();
    expect(drawAsExporter(SEED_PROJECT, spoken, false)).not.toEqual(
      drawAsExporter(SEED_PROJECT, spoken, true),
    );
  });

  it('burns subtitles in by default, matching the stage', () => {
    const spoken = firstSubtitledFrame();
    // The exporter's default must be the log the stage draws with subtitles on, and must
    // differ from the off log, or the toggle would not be reaching the renderer.
    expect(drawAsExporter(SEED_PROJECT, spoken)).toEqual(drawAsStage(SEED_PROJECT, spoken, true));
    expect(drawAsExporter(SEED_PROJECT, spoken)).not.toEqual(
      drawAsExporter(SEED_PROJECT, spoken, false),
    );
  });

  it('exports at the authored size, not the stage size', () => {
    // The exporter must not inherit a size from wherever the stage happens to be. If it
    // did, a project authored at one resolution would export at the panel's.
    const spoken = firstSubtitledFrame();
    const halfSize = new RecordingContext();
    renderScene(halfSize, SEED_PROJECT, spoken.scene, spoken.sceneTime, {
      width: EXPORT_WIDTH / 2,
      height: EXPORT_HEIGHT / 2,
      pixelRatio: EXPORT_PIXEL_RATIO,
      subtitles: EXPORT_SUBTITLES,
    });

    expect(drawAsExporter(SEED_PROJECT, spoken)).not.toEqual(halfSize.calls);
  });
});
