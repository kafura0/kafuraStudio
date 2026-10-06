/**
 * THE EXPORT PANEL.
 *
 * Step 7 of Phase 12. It reports what this browser can do, runs the export, and says
 * exactly what came out.
 *
 * Two decisions shape everything here.
 *
 * **Capability is detected, not assumed.** `detectExportCapabilities` runs on mount and
 * each unavailable capability carries its reason. A disabled button with a reason next to
 * it is a different thing from a button that throws when pressed, and only the first one
 * can be acted on. The phase's gate needs a PNG sequence and a mixdown; both need nothing
 * exotic, so they are available essentially everywhere, and the panel says which is
 * missing when one is not.
 *
 * **Progress is per frame, and it is real.** The exporter calls back after each frame, so
 * the bar moves as frames are rasterised rather than jumping at the end. A 456-frame
 * episode that sits at 0% for eight seconds and then completes is indistinguishable from a
 * hung tab, and the user cannot tell whether to wait.
 *
 * This panel holds no document state and mutates nothing. Export reads the project it is
 * given and writes files to disk. An export that edited the document would be a second
 * mutation path outside `commit()`, which is a bug (RULE 7).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { frameSequence } from '../../core/export/frameSequence';
import { exportSequence, exportStill, type ExportedFrame } from '../../core/export/exportImages.browser';
import { mixdownEpisode, type MissingSegment } from '../../core/export/mixdown.browser';
import {
  canExportGate,
  detectExportCapabilities,
  type ExportCapabilities,
} from '../../core/export/capabilities.browser';
import { mediaStore } from '../../state/mediaLibrary';
import { describeResult } from './exportResult';
import type { Id, Project, SceneContext } from '../../core/types';

type Phase = 'idle' | 'exporting' | 'done' | 'failed';

interface ExportState {
  phase: Phase;
  /** 0..1, or null when the work has no countable steps. */
  progress: number | null;
  message: string;
  /** Segments the mixdown could not place, so a partial mixdown is never reported clean. */
  missing: MissingSegment[];
  /** The frames this run produced, offered as a download rather than auto-saved. */
  frames: ExportedFrame[];
  /**
   * The episode the results belong to, captured at export time.
   *
   * Download filenames are built from it at the moment the button is pressed, seconds
   * after the export finished. Reading the live `episode` there would write
   * `other-episode-00001.png` into a folder of frames from a different cut.
   */
  title: string;
  /** The mixdown file, offered as a download rather than auto-saved. */
  mixdown: { blob: Blob; name: string } | null;
}

const IDLE: ExportState = {
  phase: 'idle',
  progress: null,
  message: '',
  missing: [],
  frames: [],
  title: '',
  mixdown: null,
};

export interface ExportPanelProps {
  project: Project | null;
  /**
   * The resolved library the frames are drawn from.
   *
   * Separate from the project, and required alongside it. An export is the one place where
   * being wrong about the library is least recoverable: the files are on disk, they are
   * delivered, and nobody reopens the document to notice they are blank. Taking the context
   * explicitly makes an export of a series-owned project impossible to run against the empty
   * project-local list.
   */
  context: SceneContext | null;
  /**
   * The episode to export.
   *
   * An id rather than an `Episode`, so a change to the cut reaches the panel through the
   * project it already has. A panel holding its own copy of the episode would be a second
   * source of truth for the cut order, and would keep exporting a scene list the document
   * no longer has.
   */
  episodeId: Id | null;
  /** Episode time the stage is showing, for the still export. */
  currentTime: number;
  /** Burn subtitles into the frames, matching the stage. */
  subtitles: boolean;
}

export function ExportPanel({
  project,
  context,
  episodeId,
  currentTime,
  subtitles,
}: ExportPanelProps): React.JSX.Element | null {
  const [capabilities, setCapabilities] = useState<ExportCapabilities | null>(null);
  const [state, setState] = useState<ExportState>(IDLE);

  // The episode is looked up here, from the project, rather than passed in. The exporter
  // resolves the cut by id anyway, so an `Episode` prop would be a value that could be
  // stale for exactly as long as React took to re-render.
  const episode = useMemo(
    () => project?.episodes.find((e) => e.id === episodeId) ?? null,
    [project, episodeId],
  );
  // A ref, not state: a cancel flag is read inside an async loop sixty times a second,
  // and putting it in state would re-render the panel on every frame of an export.
  const cancelled = useRef(false);

  useEffect(() => {
    setCapabilities(detectExportCapabilities());
  }, []);

  // A new project or episode invalidates the previous result, and keeping it would offer
  // a download of frames from a cut that is no longer open. Keyed on the id, because
  // `episode` is a fresh object on every project change and keying on it would reset the
  // panel after an unrelated edit.
  useEffect(() => {
    cancelled.current = false;
    setState(IDLE);
  }, [project?.id, episodeId]);

  const frameCount = useMemo(() => {
    if (!project || !episode) return 0;
    return frameSequence({ project }, episode).length;
  }, [project, episode]);

  const reset = useCallback((): void => {
    cancelled.current = false;
    setState(IDLE);
  }, []);

  const fail = useCallback((error: unknown): void => {
    setState({
      ...IDLE,
      phase: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }, []);

  const onStill = useCallback((): void => {
    if (!project || !context || !episode) return;
    const title = episode.title;
    setState({ ...IDLE, phase: 'exporting', progress: null, message: 'Rendering a still\u2026' });
    void exportStill(project, context, episode.id, currentTime, { subtitles })
      .then((frame) => {
        setState({
          phase: 'done',
          progress: 1,
          // `title`, not `episode.title`: this state update is scheduled now and committed
          // later, by which time the user may have switched to a different episode, and the
          // message would then name the wrong cut.
          message: `Still exported at ${frame.time.toFixed(2)}s of ${title}.`,
          missing: [],
          frames: [frame],
          title,
          mixdown: null,
        });
      })
      .catch(fail);
  }, [project, context, episode, currentTime, subtitles, fail]);

  const onSequenceAndMixdown = useCallback((): void => {
    if (!project || !context || !episode) return;
    // Captured for the same reason as `title` above: this export takes seconds, and the
    // episode it is actually about is the one that was open when it started.
    const title = episode.title;
    const id = episode.id;
    cancelled.current = false;

    const frames = frameSequence({ project }, episode);
    if (frames.length === 0) {
      setState({
        ...IDLE,
        phase: 'failed',
        message: 'This episode has no playable scenes, so there is nothing to export.',
      });
      return;
    }

    setState({
      ...IDLE,
      phase: 'exporting',
      progress: 0,
      message: `Rendering ${frames.length} frames\u2026`,
    });

    void (async () => {
      try {
        const rendered = await exportSequence(project, context, id, frames, {
          subtitles,
          // Stopping here rather than at the end. A cancel button that lets the renderer
          // finish every remaining frame is a lie about what it does, and on a 912-frame
          // episode the user waits out the whole export to find out.
          shouldContinue: () => !cancelled.current,
          onFrame: (done, total) => {
            // Audio is half the work, so the bar spans both phases rather than sitting at
            // 100% while a 38s mixdown renders.
            setState((prev) => ({
              ...prev,
              progress: (done / total) * 0.5,
              message: `Rendering frame ${done} of ${total}\u2026`,
            }));
          },
        });

        if (cancelled.current) {
          setState((prev) => ({ ...prev, phase: 'idle', progress: null, message: 'Export cancelled.' }));
          return;
        }

        setState((prev) => ({
          ...prev,
          progress: 0.5,
          message: 'Mixing audio\u2026',
        }));

        // Attached recordings live in the media store, so the mixdown reads them from
        // there. Without this every `local` slot would be reported missing.
        const result = await mixdownEpisode(project, context, id, async (mediaId) => {
          const record = await mediaStore().get(mediaId);
          return record?.data ?? null;
        });

        if (cancelled.current) {
          setState((prev) => ({ ...prev, phase: 'idle', progress: null, message: 'Export cancelled.' }));
          return;
        }

        setState({
          phase: 'done',
          progress: 1,
          message: describeResult(rendered.length, result.placed, result.missing.length),
          missing: result.missing,
          frames: rendered,
          title,
          // The blob, not the bytes: a 38s stereo WAV is ~7 MB, and copying it out only to
          // build a Blob from the copy would double the peak memory of the largest file the
          // exporter produces, for no gain.
          mixdown: { blob: result.blob, name: `${slug(title)}.wav` },
        });
      } catch (error) {
        if (!cancelled.current) fail(error);
      }
    })();
  }, [project, context, episode, subtitles, fail]);

  const onCancel = useCallback((): void => {
    cancelled.current = true;
  }, []);

  if (!project || !context || !episode) return null;

  const gateReady = capabilities !== null && canExportGate(capabilities);
  const busy = state.phase === 'exporting';
  const percent = state.progress === null ? null : Math.round(state.progress * 100);
  const mixdown = state.mixdown;

  return (
    <section
      aria-label="Export"
      className="border-t border-ink-800 bg-ink-900 px-3 py-3 text-[11px]"
    >
      <h2 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-400">
        Export
      </h2>

      {/* The episode and its size, so the numbers in the progress messages are
          checkable before anything is clicked. */}
      <p className="mb-2 text-ink-500">
        {episode.title} · {episode.sceneIds.length} scene{episode.sceneIds.length === 1 ? '' : 's'} ·{' '}
        {frameCount} frame{frameCount === 1 ? '' : 's'} at {episode.renderSettings.fps} fps
      </p>

      <div className="mb-2 flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={onStill}
          disabled={busy || !capabilities?.['png-still'].available}
          className="rounded border border-ink-700 px-2 py-1 transition-colors hover:border-ink-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          PNG still
        </button>
        <button
          type="button"
          onClick={onSequenceAndMixdown}
          disabled={busy || !gateReady}
          className="rounded border border-ink-700 px-2 py-1 transition-colors hover:border-ink-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export episode
        </button>
        {busy && (
          <button
            type="button"
            onClick={onCancel}
            className="rounded border border-ink-700 px-2 py-1 text-ink-300 transition-colors hover:border-ink-500"
          >
            Cancel
          </button>
        )}
      </div>

      {capabilities !== null && (
        <ul className="mb-2 space-y-0.5 text-ink-500">
          {Object.entries(capabilities).map(([name, capability]) => (
            <li key={name}>
              <span className={capability.available ? 'text-emerald-500' : 'text-amber-500'}>
                {capability.available ? 'available' : 'unavailable'}
              </span>{' '}
              {name}
              {!capability.available && <span> — {capability.reason}</span>}
            </li>
          ))}
        </ul>
      )}

      {/* `role="progressbar"` with the value, not just a coloured bar, so the progress is
          available to a screen reader and to a test that cannot see colour. */}
      {busy && percent !== null && (
        <div
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Export progress"
          className="mb-2 h-1.5 w-full overflow-hidden rounded bg-ink-800"
        >
          <div className="h-full bg-sky-600 transition-[width]" style={{ width: `${percent}%` }} />
        </div>
      )}

      {state.message !== '' && (
        <p
          role="status"
          className={`mb-2 ${state.phase === 'failed' ? 'text-red-300' : 'text-ink-300'}`}
        >
          {state.message}
        </p>
      )}

      {/* A partial mixdown is never reported as a clean export. Each missing segment is
          named, because "some audio did not make it" is the fact an operator needs. */}
      {state.missing.length > 0 && (
        <ul className="mb-2 space-y-0.5 text-amber-400">
          {state.missing.map((segment, i) => (
            <li key={`${segment.audioId}-${segment.episodeStart}-${i}`}>
              {segment.audioId} at {segment.episodeStart.toFixed(2)}s: {describeMissing(segment.reason)}
            </li>
          ))}
        </ul>
      )}

      {state.phase === 'done' && state.frames.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => downloadFrame(state.frames[0], `${slug(state.title)}-still.png`)}
            className="rounded border border-ink-700 px-2 py-1 transition-colors hover:border-ink-500"
          >
            Download still
          </button>
          {state.frames.length > 1 && (
            <button
              type="button"
              onClick={() => downloadSequence(state.frames, slug(state.title))}
              className="rounded border border-ink-700 px-2 py-1 transition-colors hover:border-ink-500"
            >
              Download {state.frames.length} PNGs
            </button>
          )}
          {/*
            `mixdown` is pulled out before the handler is built. `state.mixdown !== null`
            narrows the type for the JSX condition, but the narrowing does not reach inside
            a closure — `state` is mutable, so TypeScript is right to refuse and the file
            would otherwise need a non-null assertion to compile.
          */}
          {mixdown !== null && (
            <button
              type="button"
              onClick={() => downloadBlob(mixdown.blob, mixdown.name)}
              className="rounded border border-ink-700 px-2 py-1 transition-colors hover:border-ink-500"
            >
              Download mixdown
            </button>
          )}
          <button
            type="button"
            onClick={reset}
            className="px-1 text-ink-500 transition-colors hover:text-ink-300"
          >
            Clear
          </button>
        </div>
      )}
    </section>
  );
}

function describeMissing(reason: MissingSegment['reason']): string {
  switch (reason) {
    case 'no-source':
      return 'no file attached';
    case 'undecodable':
      return 'the attached file could not be decoded';
    case 'loop-shorter-than-window':
      return 'a looping asset is shorter than the window it must fill';
  }
}

/** A filesystem-safe stem. Episode titles are authored text and may hold anything. */
function slug(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned === '' ? 'export' : cleaned;
}

function downloadFrame(frame: ExportedFrame | undefined, name: string): void {
  if (!frame) return;
  const url = URL.createObjectURL(frame.blob);
  triggerDownload(url, name);
  // The object URL holds the blob alive, so it is revoked on the next tick rather than
  // immediately, which would race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function downloadSequence(frames: readonly ExportedFrame[], stem: string): void {
  // One by one, not zipped: no archiver dependency, and each PNG is a file a user can
  // open. Browsers prompt for multiple downloads, which is the correct behaviour for
  // "here are your frames" and needs no permission to grant.
  for (const frame of frames) {
    const url = URL.createObjectURL(frame.blob);
    triggerDownload(url, `${stem}-${String(frame.index).padStart(5, '0')}.png`);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, name);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function triggerDownload(url: string, name: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
