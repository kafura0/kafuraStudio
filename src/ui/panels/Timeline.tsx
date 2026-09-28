/**
 * THE TIMELINE.
 *
 * Phase 7. Track list, clip lanes, ruler, and a playhead driven by the shared clock.
 *
 * Three things here are deliberate and each is a decision not to do the obvious thing.
 *
 * The playhead does not re-render. A `useState` playhead at 60fps re-renders every
 * component that reads it sixty times a second, which is how an editor ends up
 * dropping frames. The marker subscribes to `requestAnimationFrame` itself, reads
 * `useEditor.getState()`, and writes a `transform` directly. The store owns the clock
 * (see editorStore.advancePlayback); this only reflects it.
 *
 * Every drag routes through a core document operation and then `commit()`. Nothing
 * mutates the project in place, which is what makes a drag undoable (AGENTS.md
 * RULE 6, RULE 7). During a drag the working document is held locally and committed
 * once on release, so a 60fps drag is one undo step rather than six hundred.
 *
 * The geometry is not here. Time-to-pixel arithmetic, hit testing, and snapping live
 * in `src/core/timeline/geometry.ts` where they are tested without a DOM.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/editorStore';
import {
  MIN_CLIP_DURATION,
  addKeyframe,
  moveClip,
  moveKeyframe,
  removeClip,
  removeKeyframe,
  snapToEdges,
  trimClip,
  updateTrack,
} from '../../core/document/trackOps';
import { sampleClip } from '../../core/animation/sample';
import {
  DEFAULT_METRICS,
  clampScale,
  hitTestClip,
  keyframeTime,
  layoutTracks,
  rulerTicks,
  snapCandidates,
  snapToFrame,
  timeToX,
  xToTime,
  type Edge,
  type TrackLane,
} from '../../core/timeline/geometry';
import type { Project, Scene, Track } from '../../core/types';

const RULER_HEIGHT = 22;
const TRACKS_MIN_WIDTH = 320;

/**
 * A stable empty array. `scene?.tracks ?? []` would allocate a new array on every
 * render, which invalidates the lane memo below and re-lays out the timeline on every
 * frame the parent re-renders.
 */
const NO_TRACKS: readonly Track[] = [];

type DragMode =
  | 'move'
  | 'trim-start'
  | 'trim-end'
  | 'keyframe'
  | 'scrub';

interface DragState {
  mode: DragMode;
  trackId: string;
  clipId: string;
  /** Pointer x in lane coordinates when the drag began, for the delta. */
  originX: number;
  /** The clip's start and duration at drag start. Immutable prefix of the gesture. */
  originStart: number;
  originDuration: number;
  /** Live preview values, already snapped/clamped. */
  start: number;
  duration: number;
  /** For a keyframe drag: the keyframe being moved, its live time, and its origin. */
  keyframeId: string | null;
  keyframeTime: number;
  keyframeOriginTime: number;
  /** Neighbour edges to snap against, captured at drag start. */
  edges: number[];
}

function useScene(): { project: Project; scene: Scene | null } {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.sceneId);
  const scene = useMemo(
    () => project.scenes.find((s) => s.id === sceneId) ?? null,
    [project.scenes, sceneId],
  );
  return { project, scene };
}

/** The playhead line, moved outside React so playback costs no component renders. */
function Playhead({ scale, duration }: { scale: number; duration: number }): React.JSX.Element {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let frame = 0;
    const tick = (): void => {
      const el = ref.current;
      if (el) {
        const { playhead } = useEditor.getState();
        // translate3d keeps this on the compositor instead of repainting.
        el.style.transform = `translate3d(${timeToX(playhead, scale)}px, 0, 0)`;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [scale]);

  return (
    <div
      ref={ref}
      className="pointer-events-none absolute top-0 z-20 h-full w-px bg-zanza-500"
      style={{ left: 0 }}
      aria-hidden
      data-testid="timeline-playhead"
      data-duration={duration}
    />
  );
}

export function Timeline(): React.JSX.Element {
  const { project, scene } = useScene();
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const select = useEditor((s) => s.select);
  const commit = useEditor((s) => s.commit);
  const selection = useEditor((s) => s.selection);

  const [scale, setScale] = useState(DEFAULT_METRICS.pixelsPerSecond);
  const [drag, setDrag] = useState<DragState | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  // A drag that ends right before a double-click must not be mistaken for one: the
  // click that slams a clip into place would otherwise also drop a keyframe on it.
  const lastGestureAt = useRef(0);

  const duration = scene?.duration ?? 0;
  const fps = project.settings.fps;
  const tracks = scene?.tracks ?? NO_TRACKS;
  const lanes = useMemo(() => layoutTracks(tracks, scale), [tracks, scale]);
  const ticks = useMemo(() => rulerTicks(duration, scale), [duration, scale]);
  const contentWidth = Math.max(timeToX(duration, scale), TRACKS_MIN_WIDTH);

  // While a drag is in flight the dragged clip is rendered from `drag.start` and
  // `drag.duration`, so it follows the pointer at 60fps without a commit per frame.
  // Content follows too: a move or start trim is a *shift* (the op shifts the clip's
  // keyframes by the same delta), so the drag preview shifts them as well; an end
  // trim cuts, and a keyframe drag previews only the keyframe under the pointer.
  const displayLanes: TrackLane[] = useMemo(() => {
    if (!drag) return lanes;
    const keyShift = drag.mode === 'trim-end' ? 0 : drag.start - drag.originStart;
    return lanes.map((lane) => {
      if (lane.track.id !== drag.trackId) return lane;
      const shifted = drag.mode === 'keyframe'; // the clip itself does not move
      return {
        ...lane,
        clips: lane.clips.map((rect) => {
          if (rect.clip.id !== drag.clipId) return rect;
          return {
            clip: {
              ...rect.clip,
              start: shifted ? rect.clip.start : drag.start,
              duration: shifted ? rect.clip.duration : drag.duration,
              keyframes: rect.clip.keyframes.map((kf) => {
                if (drag.mode === 'keyframe' && kf.id === drag.keyframeId) {
                  return { ...kf, time: drag.keyframeTime };
                }
                return keyShift !== 0 ? { ...kf, time: kf.time + keyShift } : kf;
              }),
            },
            x: timeToX(drag.start, scale),
            width: Math.max(timeToX(drag.duration, scale), 6),
          };
        }),
      };
    });
  }, [lanes, drag, scale]);

  const timeFromEvent = useCallback(
    (clientX: number): number => {
      const el = laneRef.current;
      if (!el) return 0;
      // `laneRef` is the scroll container, so its rect does not move with the content;
      // the scroll offset has to be added back in or every scrub lands short by
      // however far the user has scrolled.
      return xToTime(clientX - el.getBoundingClientRect().left + el.scrollLeft, scale);
    },
    [scale],
  );

  const lanePoint = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } => {
      const el = laneRef.current;
      if (!el) return { x: 0, y: 0 };
      const rect = el.getBoundingClientRect();
      return {
        x: clientX - rect.left + el.scrollLeft,
        // The lane space starts *below* the ruler, so the ruler's height is part of the
        // offset. Without this every lane is hit one lane too low, and a press on the
        // first lane selects from the second.
        y: clientY - rect.top - RULER_HEIGHT,
      };
    },
    [],
  );

  const beginDrag = useCallback(
    (event: React.PointerEvent, lane: TrackLane, edge: Edge): void => {
      if (!scene) return;
      const { x, y } = lanePoint(event.clientX, event.clientY);
      const hit = hitTestClip(lanes, x, y);
      if (!hit) return;

      event.preventDefault();
      event.stopPropagation();
      // No `setPointerCapture` here: the move and release listeners are bound to the
      // window, so the drag is tracked regardless of what the pointer passes over.
      // Capturing would also throw in any environment without a live pointer, taking
      // the selection down with it.

      setDrag({
        mode: edge === 'none' ? 'move' : `trim-${edge}`,
        trackId: hit.track.id,
        clipId: hit.clip.id,
        originX: x,
        originStart: hit.clip.start,
        originDuration: hit.clip.duration,
        start: hit.clip.start,
        duration: hit.clip.duration,
        keyframeId: null,
        keyframeTime: 0,
        keyframeOriginTime: 0,
        edges: snapCandidates(lane, hit.clip.id, duration),
      });
      select('clip', hit.clip.id);
    },
    [duration, lanePoint, lanes, scene, select],
  );

  const beginKeyframeDrag = useCallback(
    (event: React.PointerEvent, lane: TrackLane, clipId: string, keyframeId: string, time: number): void => {
      if (!scene) return;
      const clip = lane.clips.find((r) => r.clip.id === clipId)?.clip;
      if (!clip) return;

      event.preventDefault();
      event.stopPropagation();

      setDrag({
        mode: 'keyframe',
        trackId: lane.track.id,
        clipId,
        originX: timeToX(time, scale),
        originStart: clip.start,
        originDuration: clip.duration,
        start: clip.start,
        duration: clip.duration,
        keyframeId,
        keyframeTime: time,
        keyframeOriginTime: time,
        edges: [],
      });
      select('keyframe', keyframeId);
    },
    [scale, scene, select],
  );

  // Pointer moves and the release are bound to the window, not to the clip, so a drag
  // that outruns the pointer still tracks, and the release is always observed.
  useEffect(() => {
    if (!drag || !scene) return;

    const onMove = (event: PointerEvent): void => {
      const { x } = lanePoint(event.clientX, event.clientY);
      setDrag((current) => {
        if (!current) return current;

        // Everything is derived from the immutable drag-start values, never from the
        // previous preview: a preview that feeds on itself drifts a couple of pixels
        // per pointermove and the clip slowly takes off on its own.
        const delta = xToTime(x - current.originX, scale);
        // Alt suspends snapping mid-drag; an empty edge list disables it exactly.
        const edges = event.altKey ? [] : current.edges;

        if (current.mode === 'keyframe') {
          // The delta lands wherever the pointer is relative to the keyframe it
          // grabbed — the clip's start has nothing to do with it.
          const raw = current.keyframeOriginTime + delta;
          const clamped = Math.max(current.originStart, Math.min(raw, current.originStart + current.originDuration));
          const time = Math.max(
            current.originStart,
            Math.min(snapToFrame(clamped, fps), current.originStart + current.originDuration),
          );
          return { ...current, keyframeTime: time };
        }

        // A trim moves exactly one edge and leaves the other where it is; the far edge
        // must not travel with it. A move slides the whole clip and keeps its length.
        const end =
          current.mode === 'trim-end'
            ? snapToEdges(current.originStart + current.originDuration + delta, edges)
            : current.originStart + current.originDuration;

        const start =
          current.mode === 'trim-end'
            ? current.originStart
            : snapToEdges(current.originStart + delta, edges);

        return {
          ...current,
          start: Math.max(start, 0),
          duration: Math.max(end, MIN_CLIP_DURATION) - Math.max(start, 0),
        };
      });
    };

    const onUp = (): void => {
      const current = drag;
      setDrag(null);
      if (!current) return;

      const project = useEditor.getState().project;

      if (current.mode === 'keyframe') {
        if (Math.abs(current.keyframeTime - current.keyframeOriginTime) < 1e-6 || !current.keyframeId) return;
        const next = moveKeyframe(
          project,
          scene.id,
          current.trackId,
          current.clipId,
          current.keyframeId,
          current.keyframeTime,
        );
        if (next !== project) {
          lastGestureAt.current = Date.now();
          commit(next, 'Move keyframe');
        }
        return;
      }

      const movedEnough =
        Math.abs(current.start - current.originStart) > 1e-6 ||
        Math.abs(current.duration - current.originDuration) > 1e-6;
      if (!movedEnough) return;

      const next =
        current.mode === 'move'
          ? moveClip(project, scene.id, current.trackId, current.clipId, current.start)
          : trimClip(
              project,
              scene.id,
              current.trackId,
              current.clipId,
              current.mode === 'trim-start' ? 'start' : 'end',
              current.mode === 'trim-start' ? current.start : current.start + current.duration,
            );

      if (next !== project) {
        lastGestureAt.current = Date.now();
        commit(next, current.mode === 'move' ? 'Move clip' : 'Trim clip');
      }
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [commit, drag, fps, lanePoint, scale, scene]);

  useLayoutEffect(() => {
    const onWheel = (event: WheelEvent): void => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setScale((current) => clampScale(current * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    };
    const el = laneRef.current;
    el?.addEventListener('wheel', onWheel, { passive: false });
    return () => el?.removeEventListener('wheel', onWheel);
  }, []);

  // Delete and Backspace act on the timeline selection. They are window-level so the
  // focus never has to leave whatever panel the user last clicked.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, [contenteditable="true"]')) return;

      const { project, sceneId, selection } = useEditor.getState();
      if (selection.kind === null || selection.kind === 'actor' || selection.kind === 'prop') return;
      if (!selection.id) return;
      const sceneSel = project.scenes.find((s) => s.id === sceneId);
      if (!sceneSel) return;

      if (selection.kind === 'clip') {
        for (const track of sceneSel.tracks) {
          if (!track.clips.some((c) => c.id === selection.id)) continue;
          const next = removeClip(project, sceneId, track.id, selection.id);
          if (next !== project) {
            select(null, null);
            commit(next, 'Delete clip');
          }
          return;
        }
        return;
      }

      // A keyframe selection is global to the scene; resolve which clip carries it.
      for (const track of sceneSel.tracks) {
        for (const clipItem of track.clips) {
          if (!clipItem.keyframes.some((kf) => kf.id === selection.id)) continue;
          const next = removeKeyframe(project, sceneId, track.id, clipItem.id, selection.id);
          if (next !== project) {
            select(null, null);
            commit(next, 'Delete keyframe');
          }
          return;
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [commit, select]);

  if (!scene) {
    return <div className="border-t border-ink-800 bg-ink-900 p-4 text-xs text-ink-400">No scene open.</div>;
  }

  const onScrub = (event: React.PointerEvent<HTMLDivElement>): void => {
    const time = timeFromEvent(event.clientX);
    setPlayhead(Math.min(Math.max(time, 0), duration));
  };

  // Double-clicking a clip plants a keyframe at the pointer, capturing the pose the
  // clip currently draws there. The placement lands on the frame grid like any other
  // keyframe edit.
  const addKeyframeAt = (event: React.MouseEvent, lane: TrackLane, clipId: string): void => {
    if (!scene) return;
    const clip = lane.clips.find((r) => r.clip.id === clipId)?.clip;
    if (!clip) return;
    const { x } = lanePoint(event.clientX, event.clientY);
    const { time } = keyframeTime(clip, xToTime(x, scale), fps);
    const props = sampleClip(clip, time);
    const project = useEditor.getState().project;
    const next = addKeyframe(project, scene.id, lane.track.id, clipId, time, props);
    if (next !== project) {
      commit(next, 'Add keyframe');
      const added = next.scenes
        .find((s) => s.id === scene.id)
        ?.tracks.find((t) => t.id === lane.track.id)
        ?.clips.find((c) => c.id === clipId)
        ?.keyframes.find((kf) => Math.abs(kf.time - time) < 1e-6);
      if (added) select('keyframe', added.id);
    }
  };

  return (
    <div className="flex shrink-0 flex-col border-t border-ink-800 bg-ink-900 select-none">
      <div className="flex items-center gap-3 border-b border-ink-800 px-3 py-1.5">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Timeline
        </span>
        <span className="text-[11px] text-ink-500">
          {tracks.length} track{tracks.length === 1 ? '' : 's'} · {duration.toFixed(2)}s @ {fps}fps
        </span>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setScale((s) => clampScale(s / 1.25))}
          className="rounded px-1.5 text-xs text-ink-300 hover:bg-ink-800"
          aria-label="Zoom out"
        >
          −
        </button>
        <span className="w-12 text-center font-mono text-[10px] text-ink-500">
          {Math.round(scale)}px/s
        </span>
        <button
          type="button"
          onClick={() => setScale((s) => clampScale(s * 1.25))}
          className="rounded px-1.5 text-xs text-ink-300 hover:bg-ink-800"
          aria-label="Zoom in"
        >
          +
        </button>
      </div>

      <div className="flex min-h-0 overflow-x-auto">
        {/* Track names: a fixed column that does not scroll with the lanes. */}
        <div className="shrink-0 border-r border-ink-800" style={{ width: DEFAULT_METRICS.labelWidth }}>
          <div style={{ height: RULER_HEIGHT }} className="border-b border-ink-800" />
          {displayLanes.map((lane) => (
            <div
              key={lane.track.id}
              style={{ height: lane.height }}
              className="flex items-center gap-1.5 border-b border-ink-800/60 px-2"
            >
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ background: lane.track.color }}
                aria-hidden
              />
              <span className="truncate text-[11px] text-ink-300" title={lane.track.name}>
                {lane.track.name}
              </span>
              <button
                type="button"
                onClick={() => {
                  const p = useEditor.getState().project;
                  const next = updateTrack(p, scene.id, lane.track.id, { muted: !lane.track.muted });
                  if (next !== p) commit(next, lane.track.muted ? 'Unmute track' : 'Mute track');
                }}
                className={`ml-auto rounded px-1 text-[10px] font-semibold leading-tight transition-colors ${
                  lane.track.muted
                    ? 'bg-zanza-500/20 text-zanza-400'
                    : 'text-ink-500 hover:bg-ink-800 hover:text-ink-300'
                }`}
                aria-label={`${lane.track.muted ? 'Unmute' : 'Mute'} ${lane.track.name}`}
                aria-pressed={lane.track.muted}
                title={lane.track.muted ? 'Unmute track' : 'Mute track'}
              >
                M
              </button>
            </div>
          ))}
        </div>

        {/* Lanes and ruler: one horizontally scrollable coordinate space. */}
        <div className="relative flex-1 overflow-x-auto" ref={laneRef}>
          <div className="relative" style={{ width: contentWidth }}>
            <div
              style={{ height: RULER_HEIGHT }}
              className="sticky top-0 z-10 cursor-ew-resize border-b border-ink-800 bg-ink-900"
              onPointerDown={onScrub}
              role="slider"
              aria-label="Timeline ruler"
              aria-valuemin={0}
              aria-valuemax={duration}
              tabIndex={0}
            >
              {ticks.map((tick) => (
                <div
                  key={tick.time}
                  className="absolute top-0 h-full border-l border-ink-700"
                  style={{ left: tick.x }}
                >
                  <span className="ml-1 font-mono text-[10px] text-ink-500">
                    {formatTick(tick.time)}
                  </span>
                </div>
              ))}
            </div>

            {displayLanes.map((lane) => (
              <div
                key={lane.track.id}
                style={{ height: lane.height }}
                className="relative border-b border-ink-800/60"
                onPointerDown={(event) => {
                  // Empty lane space scrubs, which is what a user reaching for the
                  // playhead expects.
                  if (event.target === event.currentTarget) onScrub(event);
                }}
              >
                {lane.clips.map((rect) => {
                  const selected = selection.kind === 'clip' && selection.id === rect.clip.id;
                  return (
                    <div
                      key={rect.clip.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${lane.track.name} clip at ${rect.clip.start.toFixed(2)}s`}
                      className={`absolute top-0.5 rounded-sm border ${
                        selected ? 'border-zanza-400 ring-1 ring-zanza-500' : 'border-black/40'
                      }`}
                      style={{
                        left: rect.x,
                        width: rect.width,
                        height: lane.height - 5,
                        background: lane.track.color,
                        opacity: lane.track.muted ? 0.35 : 0.85,
                        cursor: drag?.clipId === rect.clip.id ? 'grabbing' : 'grab',
                      }}
                      onPointerDown={(event) => beginDrag(event, lane, 'none')}
                      onDoubleClick={(event) => {
                        // A gesture that just slammed the clip into place can end with
                        // a stray double-click; do not plant a keyframe behind it.
                        if (Date.now() - lastGestureAt.current < 300) return;
                        addKeyframeAt(event, lane, rect.clip.id);
                      }}
                    >
                      {/* Trim handles. A clip narrower than both handles would
                          otherwise be impossible to grab by its edge. */}
                      <span
                        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize rounded-l-sm bg-black/30"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginDrag(event, lane, 'start');
                        }}
                      />
                      <span
                        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize rounded-r-sm bg-black/30"
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          beginDrag(event, lane, 'end');
                        }}
                      />
                      {rect.clip.keyframes.map((keyframe) => (
                        <span
                          key={keyframe.id}
                          className={`absolute top-1/2 h-1.5 w-1.5 -translate-y-1/2 rotate-45 ${
                            selection.kind === 'keyframe' && selection.id === keyframe.id
                              ? 'bg-zanza-300 ring-1 ring-zanza-500'
                              : 'bg-ink-950'
                          }`}
                          style={{
                            left: timeToX(keyframe.time - rect.clip.start, scale) - 3,
                          }}
                          title={`keyframe @ ${keyframe.time.toFixed(2)}s`}
                          onPointerDown={(event) =>
                            beginKeyframeDrag(event, lane, rect.clip.id, keyframe.id, keyframe.time)
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            ))}

            <Playhead scale={scale} duration={duration} />
          </div>
        </div>
      </div>
    </div>
  );
}

/** Seconds to a compact ruler label. Whole seconds stay bare. */
function formatTick(time: number): string {
  if (Math.abs(time) < 1e-9) return '0';
  if (Number.isInteger(time)) return String(time);
  return time.toFixed(1);
}
