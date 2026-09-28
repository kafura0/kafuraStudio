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

      const { project, sceneId, playhead } = useEditor.getState();
      const scene = project.scenes.find((s) => s.id === sceneId) ?? null;
      const stageWidth = widthRef.current;
      const stageHeight =
        (stageWidth * project.settings.height) / project.settings.width;

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

        renderScene(ctx, project, scene, playhead, {
          width: stageWidth,
          height: stageHeight,
          pixelRatio: dpr,
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
