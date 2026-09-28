/**
 * THE STAGE.
 *
 * The only component that touches canvas pixels. It owns a `<canvas>` ref and a
 * requestAnimationFrame loop, and it calls the pure `renderScene` from `src/core`.
 *
 * React never enters the render loop: the loop reads from the store outside of
 * React's reconciliation, so a 60fps redraw costs zero component renders
 * (AGENTS.md RULE 14).
 */

import { useEffect, useRef } from 'react';
import { renderScene } from '../core/render/render';
import type { Scene } from '../core/types';

export interface StageProps {
  scene: Scene;
  project: Parameters<typeof renderScene>[1];
  time: number;
  playing: boolean;
  /** Stage width in CSS pixels; height follows the project's aspect ratio. */
  width: number;
}

export function Stage({ scene, project, time, playing, width }: StageProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // The loop reads the latest values through a ref, so changing the playhead does
  // not re-subscribe the animation frame callback every tick.
  const latest = useRef({ scene, project, time, playing, width });
  latest.current = { scene, project, time, playing, width };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frame = 0;
    let last = performance.now();
    // The playhead is advanced inside the loop, never by a React state update per
    // frame — that is what keeps a 60fps redraw free of component renders.
    let clock = latest.current.time;

    const draw = (now: number): void => {
      const state = latest.current;
      const dt = Math.min((now - last) / 1000, 0.25);
      last = now;

      if (state.playing) {
        clock += dt;
        if (clock >= state.scene.duration) clock = 0;
      } else {
        // Scrubbing wins: an external playhead change is authoritative when paused.
        clock = state.time;
      }

      const height = (state.width * state.project.settings.height) / state.project.settings.width;

      // Match the backing store to the device pixel ratio so 1920p is crisp. The
      // transform itself is `renderScene`'s job, given `pixelRatio` below — setting
      // it here as well is how the two drifted apart and drew into one corner.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const targetWidth = Math.round(state.width * dpr);
      const targetHeight = Math.round(height * dpr);
      if (canvas.width !== targetWidth || canvas.height !== targetHeight) {
        canvas.width = targetWidth;
        canvas.height = targetHeight;
      }
      canvas.style.width = `${state.width}px`;
      canvas.style.height = `${height}px`;

      renderScene(ctx, state.project, state.scene, clock, {
        width: state.width,
        height,
        pixelRatio: dpr,
      });

      frame = requestAnimationFrame(draw);
    };

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="block rounded-md shadow-2xl ring-1 ring-ink-700"
      aria-label={`Stage: ${scene.name}`}
    />
  );
}
