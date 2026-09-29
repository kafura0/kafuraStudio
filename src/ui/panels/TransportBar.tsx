import { useEditor } from '../../state/editorStore';
import type { Scene } from '../../core/types';

export interface TransportBarProps {
  scene: Scene;
  projectName: string;
  fps: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

export function TransportBar({
  scene,
  projectName,
  fps,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
}: TransportBarProps): React.JSX.Element {
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const dirty = useEditor((s) => s.dirty);
  const showSubtitles = useEditor((s) => s.showSubtitles);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const play = useEditor((s) => s.play);
  const pause = useEditor((s) => s.pause);
  const toggleSubtitles = useEditor((s) => s.toggleSubtitles);

  // The duration of the scene actually open. Reading the project's first scene here
  // is what made the scrubber range and the timecode disagree with the scene being
  // edited — invisible while every scene happens to be the same length, wrong the
  // moment one is not.
  const duration = scene.duration;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900 px-3">
      <span className="text-sm font-semibold tracking-tight text-zanza-500">ZANZA</span>
      <span className="truncate text-xs text-ink-400">{projectName}</span>

      <div className="mx-2 h-5 w-px bg-ink-700" />

      <button
        type="button"
        onClick={onUndo}
        disabled={!canUndo}
        className="rounded px-2 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-30"
      >
        Undo
      </button>
      <button
        type="button"
        onClick={onRedo}
        disabled={!canRedo}
        className="rounded px-2 py-1 text-xs text-ink-200 hover:bg-ink-800 disabled:opacity-30"
      >
        Redo
      </button>
      <button
        type="button"
        onClick={onSave}
        className="rounded px-2 py-1 text-xs text-ink-200 hover:bg-ink-800"
      >
        Save{dirty ? ' •' : ''}
      </button>

      <div className="flex-1" />

      <button
        type="button"
        onClick={() => (playing ? pause() : play())}
        className="rounded bg-ink-800 px-3 py-1 text-xs font-medium text-ink-100 hover:bg-ink-700"
      >
        {playing ? 'Pause' : 'Play'}
      </button>

      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.001)}
        step={1 / fps}
        value={Math.min(playhead, duration)}
        onChange={(event) => setPlayhead(Number(event.target.value))}
        aria-label="Playhead"
        className="w-64 accent-zanza-500"
      />
      <span className="w-24 text-right font-mono text-[11px] text-ink-400">
        {playhead.toFixed(2)} / {duration.toFixed(2)}s
      </span>

      <button
        type="button"
        onClick={toggleSubtitles}
        aria-pressed={showSubtitles}
        aria-label="Subtitles"
        title={showSubtitles ? 'Hide subtitles' : 'Show subtitles'}
        className={`rounded px-2 py-1 text-xs transition-colors ${
          showSubtitles
            ? 'bg-zanza-500/20 text-zanza-400 hover:bg-zanza-500/30'
            : 'text-ink-500 hover:bg-ink-800 hover:text-ink-300'
        }`}
      >
        CC
      </button>
    </header>
  );
}
