/**
 * Rasterising a frame to a PNG.
 *
 * Step 2 and 3 of Phase 12 both need the same thing: a real `<canvas>`, one frame drawn
 * into it by the *same* `renderScene` the stage calls, and a PNG out of it. That
 * sequence lives here so the still export and the sequence export cannot drift apart in
 * the two places it is tempting to (viewport size, pixel ratio, subtitle flag).
 *
 * Two properties are the point of this file existing at all:
 *
 *  - The draw goes through `renderScene`, never through a second render path. An
 *    exporter that drew "basically the same thing" would pass every eyeball check and
 *    still ship frames the stage has never produced.
 *  - The surface is created fresh per frame and released afterwards. A 456-frame episode
 *    that kept its canvases alive would hold a few gigabytes of backing store on a
 *    16 GB machine (AGENTS.md RULE 14). One at a time keeps peak memory at one frame.
 *
 * Canvas resolution is a *writer* concern, so it lives in `*.browser.ts` and `core`
 * stays DOM-free (RULE 5). Everything about *what* to draw stays in the pure renderer.
 */

import { renderScene } from '../render/render';
import type { Canvas2DLike } from '../render/canvas';
import { exportTimeline, resolveExportFrame, type ResolvedFrame } from './resolveFrame';
import type { Id, Project, SceneContext } from '../types';

/** A resolved frame, plus its PNG bytes. */
export interface ExportedFrame extends Omit<ResolvedFrame, 'timeline'> {
  /** PNG bytes, as produced by `toBlob`. */
  blob: Blob;
}

export interface ExportImageOptions {
  /** Draw the subtitle bar. Matches the stage default, so the export does too. */
  subtitles?: boolean;
  /** Called after each frame, for progress reporting. */
  onFrame?: (done: number, total: number) => void;
  /** Return false to stop early. The frames already produced are kept. */
  shouldContinue?: () => boolean;
}

/**
 * Create a canvas of the given pixel size, or `null` if the browser refused.
 *
 * A zero-sized canvas throws in Chrome, and an episode can carry a zero width or height
 * in a hand-edited document, so the sizes are clamped rather than trusted.
 */
function createSurface(width: number, height: number): {
  canvas: HTMLCanvasElement;
  ctx: Canvas2DLike;
} | null {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  return { canvas, ctx };
}

/**
 * The drawing half of a frame export, shared by the still and the sequence.
 *
 * Returns the resolved scene and local time rather than the PNG, so a caller that wants
 * the *log* of what was drawn (step 4) can take the same path and substitute a recording
 * context for the real one. That is why this is a separate function: if the still path
 * and the sequence path each built their own context, the draw-log comparison would be
 * comparing two implementations instead of two runs of one.
 */
/**
 * Draw one resolved export frame.
 *
 * Takes the resolved `SceneContext` rather than the `Project`. `Project` satisfies
 * `SceneContext` structurally, so a `Project` parameter would compile and then draw from the
 * project's own — normally empty — library: a series-owned export would come out as an empty
 * stage with no error anywhere. The timeline already carries the cut and the scenes, so
 * nothing is lost by taking the context instead.
 */
export function drawExportFrame(
  ctx: Canvas2DLike,
  context: SceneContext,
  frame: ResolvedFrame,
  options: ExportImageOptions = {},
): void {
  // The episode is the unit being exported and it carries its own render settings, so they
  // decide the frame's size. The project settings are what a *scene* is authored at and what
  // the stage previews; reading them here would let an export quietly come out at a
  // different resolution from the one its own cut says, with nothing but a file size to
  // notice it by. `frameSequence` already takes fps from the episode for the same reason.
  const { width, height } = frame.timeline.episode.renderSettings;
  renderScene(ctx, context, frame.scene, frame.sceneTime, {
    width,
    height,
    // Export is not a screen. The stage multiplies by the device pixel ratio to stay
    // crisp on a 1920p display; an export is a file of exactly the authored size, so the
    // ratio is 1 and the output is resolution-independent of whoever runs it.
    pixelRatio: 1,
    subtitles: options.subtitles ?? true,
  });
}

/**
 * Render one frame of an episode and return it as PNG bytes.
 *
 * Throws when the browser cannot provide a 2D context, because a silent empty export
 * would look like a successful one and the caller would report a frame count that does
 * not exist.
 */
export async function exportStill(
  project: Project,
  library: SceneContext,
  episodeId: Id,
  time: number,
  options: ExportImageOptions = {},
): Promise<ExportedFrame> {
  const timeline = exportTimeline(project, episodeId);
  if (!timeline) throw new Error(`Unknown episode: ${episodeId}`);
  // Resolved once rather than per frame: the cut is the same for every frame, so re-reading
  // the episode's size 288 times is 287 chances to disagree with it.
  const { width, height } = timeline.episode.renderSettings;

  const frame = resolveExportFrame(timeline, 0, time);

  const surface = createSurface(width, height);
  if (!surface) throw new Error('Canvas 2D context unavailable');

  drawExportFrame(surface.ctx, library, frame, options);

  const blob = await toPng(surface.canvas);
  surface.canvas.width = 0;
  surface.canvas.height = 0;

  return {
    index: frame.index,
    time: frame.time,
    scene: frame.scene,
    sceneTime: frame.sceneTime,
    blob,
  };
}

/**
 * Render every frame in `frames` as a PNG, in order.
 *
 * `frames` is passed in rather than recomputed so this function cannot disagree with the
 * caller about the frame list: whatever `frameSequence` decided is what gets exported,
 * which is the property step 4's draw-log comparison depends on.
 */
export async function exportSequence(
  project: Project,
  library: SceneContext,
  episodeId: Id,
  frames: readonly { index: number; time: number }[],
  options: ExportImageOptions = {},
): Promise<ExportedFrame[]> {
  const timeline = exportTimeline(project, episodeId);
  if (!timeline) throw new Error(`Unknown episode: ${episodeId}`);
  const { width, height } = timeline.episode.renderSettings;

  const out: ExportedFrame[] = [];
  const total = frames.length;

  for (const frame of frames) {
    if (options.shouldContinue && !options.shouldContinue()) break;

    const resolved = resolveExportFrame(timeline, frame.index, frame.time);

    const surface = createSurface(width, height);
    if (!surface) throw new Error('Canvas 2D context unavailable');

    drawExportFrame(surface.ctx, library, resolved, options);

    const blob = await toPng(surface.canvas);
    // Release the backing store before allocating the next one, so peak memory is one
    // frame rather than one episode.
    surface.canvas.width = 0;
    surface.canvas.height = 0;

    out.push({
      index: resolved.index,
      time: resolved.time,
      scene: resolved.scene,
      sceneTime: resolved.sceneTime,
      blob,
    });

    options.onFrame?.(out.length, total);
  }

  return out;
}

/**
 * `canvas.toBlob` as a promise, with the type and failure cases handled.
 *
 * `toBlob` gives `null` rather than throwing when the canvas is tainted or zero-sized,
 * and a null that becomes an empty file is worse than an error, so it is raised here.
 */
function toPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob produced no data'));
    }, 'image/png');
  });
}
