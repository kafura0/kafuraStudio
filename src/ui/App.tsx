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
import { Timeline } from './panels/Timeline';
import { CameraPanel } from './panels/CameraPanel';
import { DialoguePanel } from './panels/DialoguePanel';

/**
 * True when a keystroke belongs to whatever the user is typing into.
 *
 * Anything that accepts text — plus any button, because space is what activates one.
 * Without this, holding space to scrub would also toggle playback repeatedly and pause
 * the episode mid-sentence.
 */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'BUTTON' || target.getAttribute('role') === 'button';
}

export function App(): React.JSX.Element {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.sceneId);
  const setScene = useEditor((s) => s.setScene);
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

  // Ctrl+Z / Ctrl+Shift+Z, the one shortcut an editor must never get wrong, plus
  // spacebar transport, which `docs/MVP.md` check 3 claims exists and did not.
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === 'z') {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
        } else if (key === 's') {
          event.preventDefault();
          void save();
        }
        return;
      }
      // Spacebar only when the user is not typing. A transport shortcut that eats a
      // space in the dialogue editor is worse than no shortcut, and a focused range
      // input legitimately uses space for its own affordance.
      if (event.key === ' ' && !isTypingTarget(event.target)) {
        event.preventDefault();
        // Read the store imperatively. Selecting a derived `() => toggle()` would hand
        // React a new function identity on every render, and `useSyncExternalStore`
        // re-renders forever on a selector whose result is never referentially equal.
        const store = useEditor.getState();
        if (store.playing) store.pause();
        else store.play();
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
        scene={scene}
        projectName={project.name}
        fps={project.settings.fps}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        onSave={() => void save()}
      />

      <div className="flex min-h-0 flex-1">
        {/* The left column scrolls, so the dialogue editor and the asset library share
            it. The stage is a fixed 960px and there is no room beside it at 1440p —
            claiming a right-hand inspector would mean clipping the picture. */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900">
          <SceneList
            scenes={project.scenes}
            activeSceneId={scene.id}
            onSelect={setScene}
          />
          <CameraPanel />
          <DialoguePanel />
          <AssetPanel project={project} />
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-6">
            <Stage width={stageWidth} />
          </div>
          <IssuePanel />
          <Timeline />
        </main>
      </div>
    </div>
  );
}
