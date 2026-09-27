/**
 * THE APPLICATION SHELL.
 *
 * Layout only. Every piece of state comes from the editor store; every mutation
 * goes through `commit()`. This component is intentionally thin — it is chrome,
 * not logic.
 */

import { useEffect, useMemo } from 'react';
import { useEditor } from '../state/editorStore';
import { Stage } from './Stage';
import { SceneList } from './panels/SceneList';
import { AssetPanel } from './panels/AssetPanel';
import { TransportBar } from './panels/TransportBar';
import { IssuePanel } from './panels/IssuePanel';

export function App(): React.JSX.Element {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.sceneId);
  const setScene = useEditor((s) => s.setScene);
  const playhead = useEditor((s) => s.playhead);
  const playing = useEditor((s) => s.playing);
  const hydrate = useEditor((s) => s.hydrate);
  const save = useEditor((s) => s.save);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);

  // Fit the stage to the viewport rather than tracking it per-pixel: a resize
  // handler that re-renders on every mousemove during a window drag is wasted work.
  const stageWidth = 960;

  // Restore the last session, if there is one.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Ctrl+Z / Ctrl+Shift+Z, the one shortcut an editor must never get wrong.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (key === 's') {
        event.preventDefault();
        void save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, save]);

  const scene = useMemo(() => {
    const found = project.scenes.find((s) => s.id === sceneId);
    return found ?? project.scenes[0] ?? null;
  }, [project.scenes, sceneId]);

  if (!scene) {
    return (
      <div className="grid h-full place-items-center bg-ink-950 text-ink-300">
        <p className="text-sm">This project has no scenes yet.</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-ink-950 text-ink-100">
      <TransportBar
        project={project}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void save()}
      />

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900">
          <SceneList
            scenes={project.scenes}
            activeSceneId={scene.id}
            onSelect={setScene}
          />
          <AssetPanel project={project} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            <Stage
              scene={scene}
              project={project}
              time={playhead}
              playing={playing}
              width={stageWidth}
            />
          </div>
          <IssuePanel />
        </main>
      </div>
    </div>
  );
}
