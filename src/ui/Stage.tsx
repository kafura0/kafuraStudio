/**
 * THE STAGE.
 *
 * The only component that touches canvas pixels. It owns a `<canvas>` ref and a
 * requestAnimationFrame loop, and it calls the pure `renderScene` from `src/core`.
 *
 * React never enters the render loop. The loop reads the store through
 * `useEditor.getState()` rather than through props, so advancing the playhead sixty
 * times a second costs zero component renders (AGENTS.md RULE 14).
 *
 * The store owns the clock. This loop advances it and then draws it; it does not keep
 * a private copy. A second clock would be correct here on screen and frozen
 * everywhere else, which is how the scrubber and the timeline playhead end up sitting
 * still during playback.
 *
 * The stage renders one scene at a time, and it is handed that scene plus its
 * scene-local time. Choosing which scene and which local time is the transport's job
 * (see `src/core/timeline/episode.ts`); the renderer is not asked to know what an
 * episode is.
 */

import { useEffect, useRef } from 'react';
import { renderScene } from '../core/render/render';
import { useEditor } from '../state/editorStore';

export interface StageProps {
  /** Stage width in CSS pixels; height follows the project's aspect ratio. */
  width: number;
}

export function Stage({ width }: StageProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Width is a prop, but the loop must not be re-subscribed when it changes, so it is
  // read through a ref. Everything else comes straight from the store.
  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let last = performance.now();

    const draw = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;

      const state = useEditor.getState();
      state.advancePlayback(dt);

      // The episode transport decides which scene and what local time; the renderer
      // still takes a scene and a time and knows nothing about episodes. Reading the
      // resolved position rather than `playhead` is what lets a boundary cross without
      // the stage drawing a time that belongs to the previous scene.
      const { project, context, showSubtitles } = useEditor.getState();
      const { sceneId, sceneTime } = useEditor.getState().playbackPosition();
      // The frame after the last project closes can still be requested: the loop is
      // driven by requestAnimationFrame, and unmounting the canvas happens on the commit
      // that started it. Drawing with no project would be reading settings off a null, so
      // the frame is skipped and the next one never comes, since the loop stops with the
      // component.
      if (project === null) return;
      // Drawn from the resolved context, never from `project`. Since Phase 14 a series
      // project's own `assets` are the override list and are normally empty, so drawing the
      // project would render an empty stage with no error. The store resolves the merged
      // library once at open (`context`) and keeps the two from drifting; `context ?? project`
      // exists only to buy a free project the same guarantee as a free one, and it is the
      // same object for both.
      const library = context ?? project;
      const scene = project.scenes.find((s) => s.id === sceneId) ?? null;
      const stageWidth = widthRef.current;
      const stageHeight =
        (stageWidth * library.settings.height) / library.settings.width;

      if (scene) {
        // Match the backing store to the device pixel ratio so 1920p is crisp. The
        // transform itself is `renderScene`'s job, given `pixelRatio` below — setting
        // it here as well is how the two drifted apart and drew into one corner.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const targetWidth = Math.round(stageWidth * dpr);
        const targetHeight = Math.round(stageHeight * dpr);
        if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
          canvas.width = targetWidth;
          canvas.height = targetHeight;
        }
        canvas.style.width = `${stageWidth}px`;
        canvas.style.height = `${stageHeight}px`;

        renderScene(ctx, library, scene, sceneTime, {
          width: stageWidth,
          height: stageHeight,
          pixelRatio: dpr,
          subtitles: showSubtitles,
        });
      }

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block rounded-md shadow-2xl ring-1 ring-ink-700"
      aria-label="Stage"
    />
  );
}
