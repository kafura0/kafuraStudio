/**
 * THE APPLICATION SHELL.
 *
 * Layout only. Every piece of state comes from the editor store; every mutation
 * goes through `commit()`. This component is intentionally thin — it is chrome,
 * not logic.
 */

import { useEffect, useMemo } from 'react';
import { useEditor } from '../state/editorStore';
import { bindFlushToPageLifecycle } from '../state/autosaveLifecycle.browser';
import { ProjectBrowser } from './ProjectBrowser';
import { Stage } from './Stage';
import { SceneList } from './panels/SceneList';
import { AssetPanel } from './panels/AssetPanel';
import { AudioSlotPanel } from './panels/AudioSlotPanel';
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
  const createScene = useEditor((s) => s.createScene);
  const closeProject = useEditor((s) => s.closeProject);
  const duplicateOpenProject = useEditor((s) => s.duplicateOpenProject);
  const attachAudioFile = useEditor((s) => s.attachAudioFile);
  const clearAudioFile = useEditor((s) => s.clearAudioFile);
  const previewAudio = useEditor((s) => s.previewAudio);
  const status = useEditor((s) => s.status);
  const statusMessage = useEditor((s) => s.statusMessage);
  const clearStatus = useEditor((s) => s.clearStatus);

  // Fit the stage to the viewport rather than tracking it per-pixel: a resize
  // handler that re-renders on every mousemove during a window drag is wasted work.
  const stageWidth = 960;

  // Restore the last session, if there is one.
  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // An edit made in the last second of a session used to die with the tab, because the
  // debounced autosave was the only thing that could start a write. Binding the flush to
  // the two events that fire on the way out is the fix.
  const flushAutosave = useEditor((s) => s.flushAutosave);
  useEffect(() => bindFlushToPageLifecycle(flushAutosave).unbind, [flushAutosave]);

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
    if (project === null) return null;
    const found = project.scenes.find((s) => s.id === sceneId);
    return found ?? project.scenes[0] ?? null;
  }, [project, sceneId]);

  // No project open is a first-class state, not an error: this is a multi-project
  // workspace, and the browser is what you are looking at between projects. Rendering
  // the browser and the editor from the same `project` value means there is no way to
  // show one while the store believes the other.
  if (project === null) {
    return <ProjectBrowser />;
  }

  if (!scene) {
    // A project with no scenes is legal — it is what `createProject` returns — but it is not
    // a place to work. Offering the first scene here is the difference between a project
    // you can build in and a project you are locked out of.
    return (
      <div className="grid h-full place-items-center bg-ink-950 text-ink-300">
        <div className="text-center">
          <p className="text-sm">This project has no scenes yet.</p>
          <button
            type="button"
            onClick={() => createScene('')}
            className="mt-3 rounded border border-ink-700 px-3 py-1.5 text-sm transition-colors hover:border-ink-500 hover:text-ink-100"
          >
            Add the first scene
          </button>
        </div>
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

      <div className="flex items-center gap-2 border-b border-ink-800 px-3 py-1.5 text-[11px]">
        {/* The route back to the browser. Without it the workspace is a one-way door:
            a project can be opened but never closed, and the only way to see another
            project is to reload the tab. */}
        <button
          type="button"
          onClick={closeProject}
          className="text-ink-400 transition-colors hover:text-ink-100"
        >
          All projects
        </button>
        <span className="text-ink-800">|</span>
        <button
          type="button"
          onClick={() => void duplicateOpenProject(`${project.name} copy`)}
          className="text-ink-400 transition-colors hover:text-ink-100"
        >
          Duplicate
        </button>
      </div>

      {/*
        The store's own message, in the editor.

        `ProjectBrowser` renders `statusMessage` and nothing else did, so every status the
        editor sets was invisible while a project was open — including the failure of the
        one action the browser hides. Attaching a file threw, the store recorded a message
        for the operator, and the panel simply did not react, which is indistinguishable
        from a dead button. A message that is only ever shown on one screen is a message
        that is usually not shown.
      */}
      {statusMessage !== null && (
        <div
          role="status"
          className={`flex items-start gap-3 border-b px-3 py-1.5 text-[11px] ${
            status === 'error'
              ? 'border-red-900/60 bg-red-950/40 text-red-300'
              : 'border-ink-800 bg-ink-900 text-ink-300'
          }`}
        >
          <p className="flex-1">{statusMessage}</p>
          <button
            type="button"
            onClick={clearStatus}
            aria-label="Dismiss message"
            className="rounded px-1 text-ink-400 hover:text-ink-100"
          >
            ×
          </button>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        {/* The left column scrolls, so the dialogue editor and the asset library share
            it. The stage is a fixed 960px and there is no room beside it at 1440p —
            claiming a right-hand inspector would mean clipping the picture. */}
        <aside className="w-72 shrink-0 overflow-y-auto border-r border-ink-800 bg-ink-900">
          <SceneList
            scenes={project.scenes}
            activeSceneId={scene.id}
            onSelect={setScene}
            onCreate={createScene}
          />
          <CameraPanel />
          <DialoguePanel />
          <AssetPanel project={project} />
          <AudioSlotPanel
            project={project}
            onAttach={attachAudioFile}
            onClear={clearAudioFile}
            onPreview={previewAudio}
          />
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
