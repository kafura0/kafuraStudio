import { useEditor } from '../../state/editorStore';
import type { Project } from '../../core/types';

export interface TransportBarProps {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onSave: () => void;
}

export function TransportBar({
  project,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onSave,
}: TransportBarProps): React.JSX.Element {
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const dirty = useEditor((s) => s.dirty);
  const setPlayhead = useEditor((s) => s.setPlayhead);
  const play = useEditor((s) => s.play);
  const pause = useEditor((s) => s.pause);

  const scene = project.scenes[0];
  const duration = scene?.duration ?? 0;

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-ink-800 bg-ink-900 px-3">
      <span className="text-sm font-semibold tracking-tight text-zanza-500">ZANZA</span>
      <span className="truncate text-xs text-ink-400">{project.name}</span>

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
        step={1 / project.settings.fps}
        value={Math.min(playhead, duration)}
        onChange={(event) => setPlayhead(Number(event.target.value))}
        aria-label="Playhead"
        className="w-64 accent-zanza-500"
      />
      <span className="w-24 text-right font-mono text-[11px] text-ink-400">
        {playhead.toFixed(2)} / {duration.toFixed(2)}s
      </span>
    </header>
  );
}
