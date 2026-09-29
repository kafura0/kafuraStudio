/**
 * THE DIALOGUE PANEL.
 *
 * Phase 8. Everything about one line: who says it, what they say, how it is timed, how
 * loud it plays, and — stated plainly — whether a recording actually exists behind it.
 *
 * Four things here are decisions rather than formatting.
 *
 * Fields commit on blur, not per keystroke. One typed sentence committed per character
 * is sixty undo steps, and the first Ctrl+Z would remove a single letter.
 *
 * Timing goes through `setDialogueCue`, the same op the timeline drag lands on, so a
 * number typed here and a clip dragged there produce the same document. The panel never
 * touches a clip or a track directly; it names a line.
 *
 * The gain slider commits on release, for the same reason: a drag is one gesture, and a
 * gesture is one undo step.
 *
 * A voice slot with no file says so. The library ships declared slots (RULE 9), the
 * engine plays silence for them, and a panel that listed a recording as though it were
 * there would be the exact dishonesty the phase gate forbids. There is no file-attach
 * flow here — that is an asset-editing task — so the honest state is reported, not
 * papered over with a generated tone.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../state/editorStore';
import {
  addDialogueLineWithCue,
  removeDialogueLine,
  setDialogueCue,
  setDialogueVoice,
  updateDialogueLine,
} from '../../core/document/dialogueOps';
import { setClipGain } from '../../core/document/trackOps';
import { hasRecording } from '../../core/audio/recording';
import type { AudioDef, Clip, DialogueLine, Id, Project, Scene, Track } from '../../core/types';

interface Cue {
  track: Track;
  clip: Clip;
}

export function DialoguePanel(): React.JSX.Element {
  const project = useEditor((s) => s.project);
  const sceneId = useEditor((s) => s.sceneId);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);
  const select = useEditor((s) => s.select);
  const setPlayhead = useEditor((s) => s.setPlayhead);

  const scene = useMemo(
    () => project.scenes.find((s) => s.id === sceneId) ?? null,
    [project.scenes, sceneId],
  );

  const line = useMemo(() => {
    if (!scene) return null;
    return resolveLine(scene, selection.kind, selection.id);
  }, [scene, selection.kind, selection.id]);

  const cues = useMemo(() => (scene && line ? cuesFor(scene, line.id) : []), [scene, line]);
  // A selected clip is the cue being edited; otherwise the line's first. A line can
  // carry more than one cue — the timeline's add button puts another on its lane — and
  // the panel edits one of them rather than pretending the line has a single window.
  const cue = useMemo(() => {
    if (!scene || !line) return null;
    if (selection.kind === 'clip') {
      const found = scene.tracks.flatMap((t) => t.clips).find((c) => c.id === selection.id);
      if (found?.dialogueLineId === line.id) {
        const track = scene.tracks.find((t) => t.clips.some((c) => c.id === found.id));
        if (track) return { track, clip: found } satisfies Cue;
      }
    }
    return cues[0] ?? null;
  }, [scene, line, cues, selection.kind, selection.id]);

  if (!scene) {
    return <p className="p-3 text-xs text-ink-400">No scene open.</p>;
  }

  const voices = project.assets.audio.filter((a) => a.kind === 'dialogue');

  const patchLine = (patch: Partial<Omit<DialogueLine, 'id'>>, label: string): void => {
    if (!line) return;
    const next = updateDialogueLine(project, scene.id, line.id, patch);
    if (next !== project) commit(next, label);
  };

  const addLine = (): void => {
    // The new cue starts where the playhead is: a line added while watching a scene
    // belongs at the moment the user is looking at, not at frame zero.
    const start = Math.max(0, Math.min(useEditor.getState().playhead, scene.duration));
    const added = addDialogueLineWithCue(project, scene.id, {
      speaker: scene.actors[0]?.displayName ?? 'Speaker',
      text: '',
      actorId: scene.actors[0]?.id ?? null,
      start,
      duration: 2,
    });
    if (added.project === project) return;
    commit(added.project, 'Add line');
    select('line', added.lineId);
  };

  const deleteLine = (): void => {
    if (!line) return;
    const next = removeDialogueLine(project, scene.id, line.id);
    if (next === project) return;
    select(null, null);
    commit(next, 'Delete line');
  };

  return (
    <section className="px-3 py-2">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Dialogue
        </h2>
        <span className="font-mono text-[11px] text-ink-500">{scene.dialogue.length}</span>
        <button
          type="button"
          onClick={addLine}
          className="rounded px-1.5 text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-200"
          aria-label="Add line"
          title="Add line at the playhead"
        >
          ＋
        </button>
      </div>

      {!line ? (
        <LineList scene={scene} selectionId={selection.id} onSelect={(id) => select('line', id)} />
      ) : (
        <LineEditor
          project={project}
          scene={scene}
          line={line}
          cue={cue}
          cueCount={cues.length}
          voices={voices}
          onPatch={patchLine}
          onVoice={(audioId) => {
            const next = setDialogueVoice(project, scene.id, line.id, audioId);
            if (next !== project) commit(next, 'Set voice');
          }}
          onCue={(patch) => {
            if (!cue) return;
            const next = setDialogueCue(project, scene.id, line.id, patch);
            if (next !== project) commit(next, 'Retime cue');
          }}
          onGain={(gain) => {
            if (!cue) return;
            const next = setClipGain(project, scene.id, cue.track.id, cue.clip.id, gain);
            if (next !== project) commit(next, 'Set gain');
          }}
          onGoToCue={() => {
            if (cue) setPlayhead(cue.clip.start);
          }}
          onClose={() => select(null, null)}
          onDelete={deleteLine}
        />
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Line list                                                           */
/* ------------------------------------------------------------------ */

function LineList({
  scene,
  selectionId,
  onSelect,
}: {
  scene: Scene;
  selectionId: Id | null;
  onSelect: (id: Id) => void;
}): React.JSX.Element {
  if (scene.dialogue.length === 0) {
    return (
      <p className="mt-2 text-[11px] text-ink-500">
        No dialogue in this scene. Use ＋ to write the first line.
      </p>
    );
  }

  const cues = new Map<Id, Clip[]>();
  for (const track of scene.tracks) {
    for (const clip of track.clips) {
      if (!clip.dialogueLineId) continue;
      cues.set(clip.dialogueLineId, [...(cues.get(clip.dialogueLineId) ?? []), clip]);
    }
  }

  const ordered = [...scene.dialogue].sort((a, b) => startOf(cues, a.id) - startOf(cues, b.id));

  return (
    <ul className="mt-2 space-y-0.5" aria-label="Scene dialogue">
      {ordered.map((line) => {
        const at = startOf(cues, line.id);
        return (
          <li key={line.id}>
            <button
              type="button"
              onClick={() => onSelect(line.id)}
              aria-current={selectionId === line.id}
              className={`flex w-full items-baseline gap-2 rounded px-1.5 py-1 text-left text-[11px] ${
                selectionId === line.id
                  ? 'bg-zanza-500/15 text-zanza-300'
                  : 'text-ink-300 hover:bg-ink-800'
              }`}
            >
              <span className="w-9 shrink-0 font-mono text-[10px] text-ink-500">
                {Number.isFinite(at) ? `${at.toFixed(1)}s` : '—'}
              </span>
              <span className="shrink-0 font-medium">{line.speaker}</span>
              <span className="min-w-0 flex-1 truncate text-ink-400">
                {line.text || '(no line)'}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function startOf(cues: Map<Id, Clip[]>, lineId: Id): number {
  const first = cues.get(lineId)?.[0];
  return first ? first.start : Number.POSITIVE_INFINITY;
}

/* ------------------------------------------------------------------ */
/* Line editor                                                         */
/* ------------------------------------------------------------------ */

interface LineEditorProps {
  project: Project;
  scene: Scene;
  line: DialogueLine;
  cue: Cue | null;
  cueCount: number;
  voices: AudioDef[];
  onPatch: (patch: Partial<Omit<DialogueLine, 'id'>>, label: string) => void;
  onVoice: (audioId: Id | null) => void;
  onCue: (cue: { start?: number; duration?: number }) => void;
  onGain: (gain: number) => void;
  onGoToCue: () => void;
  onClose: () => void;
  onDelete: () => void;
}

function LineEditor({
  project,
  scene,
  line,
  cue,
  cueCount,
  voices,
  onPatch,
  onVoice,
  onCue,
  onGain,
  onGoToCue,
  onClose,
  onDelete,
}: LineEditorProps): React.JSX.Element {
  const speaker = useDraftField(line.speaker, (v) => onPatch({ speaker: v }, 'Edit speaker'));
  const text = useDraftField(line.text, (v) => onPatch({ text: v }, 'Edit line'));
  const emotion = useDraftField(line.emotion, (v) => onPatch({ emotion: v }, 'Edit emotion'));
  const subtitle = useDraftField(
    line.subtitle ?? '',
    (v) => onPatch({ subtitle: v === '' ? null : v }, 'Edit subtitle'),
  );

  const voice = line.voiceAudioId
    ? (voices.find((a) => a.id === line.voiceAudioId) ?? null)
    : null;
  const recorded = hasRecording(voice);

  // A number field drafts as a string for the same reason a text field does: a
  // controlled number input that re-renders from the document on every keystroke cannot
  // be emptied, because "cleared" would immediately become 0.
  const cueStart = useDraftField(cue ? String(round2(cue.clip.start)) : '', (v) => {
    const start = Number(v);
    if (Number.isFinite(start)) onCue({ start });
  });
  const cueDuration = useDraftField(cue ? String(round2(cue.clip.duration)) : '', (v) => {
    const duration = Number(v);
    if (Number.isFinite(duration)) onCue({ duration });
  });

  const emotionNames = project.assets.expressions.map((e) => e.name);

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-100">
          {line.speaker || 'Untitled line'}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="rounded px-1 text-xs text-ink-500 hover:bg-ink-800 hover:text-ink-300"
          aria-label="Close line"
        >
          ×
        </button>
      </div>

      <Field label="Speaker">
        <input
          {...speaker}
          aria-label="Speaker"
          className={inputClass}
        />
      </Field>

      <Field label="Actor">
        <select
          value={line.actorId ?? ''}
          aria-label="Actor"
          onChange={(event) =>
            onPatch({ actorId: event.target.value === '' ? null : event.target.value }, 'Set actor')
          }
          className={inputClass}
        >
          <option value="">— unattributed —</option>
          {scene.actors.map((actor) => (
            <option key={actor.id} value={actor.id}>
              {actor.displayName}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Emotion" hint="Free text; the project's expressions are offered below.">
        <input {...emotion} aria-label="Emotion" list="dialogue-emotions" className={inputClass} />
        <datalist id="dialogue-emotions">
          {emotionNames.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </Field>

      <Field label="Line">
        <textarea
          {...text}
          aria-label="Line"
          rows={3}
          className={`${inputClass} resize-y`}
        />
      </Field>

      <Field
        label="Subtitle"
        hint={line.subtitle === null ? 'Showing the line text.' : 'Override for the burnt-in subtitle.'}
      >
        <input {...subtitle} aria-label="Subtitle" className={inputClass} />
        {line.subtitle !== null && (
          <button
            type="button"
            onClick={() => onPatch({ subtitle: null }, 'Reset subtitle')}
            className="self-start text-[10px] text-ink-500 underline hover:text-ink-300"
          >
            Use line text
          </button>
        )}
      </Field>

      <Field
        label="Cue"
        hint={
          cue
            ? cueCount > 1
              ? `${cueCount} cues carry this line; this edits the selected one.`
              : undefined
            : 'No cue on the timeline for this line.'
        }
      >
        <div className="flex items-center gap-1.5">
          <input
            {...cueStart}
            type="number"
            aria-label="Cue start"
            min={0}
            step={0.01}
            disabled={!cue}
            placeholder="—"
            className={inputClass}
          />
          <input
            {...cueDuration}
            type="number"
            aria-label="Cue duration"
            min={0}
            step={0.01}
            disabled={!cue}
            placeholder="—"
            className={inputClass}
          />
          <button
            type="button"
            onClick={onGoToCue}
            disabled={!cue}
            className="shrink-0 rounded px-1.5 py-1 text-[10px] text-ink-400 hover:bg-ink-800 hover:text-ink-200 disabled:opacity-30"
            title="Move the playhead to this cue"
          >
            Go
          </button>
        </div>
      </Field>

      <GainField clip={cue?.clip ?? null} onCommit={onGain} />

      <Field label="Voice" hint={voiceHint(voice, recorded)}>
        <select
          value={line.voiceAudioId ?? ''}
          aria-label="Voice"
          onChange={(event) => onVoice(event.target.value === '' ? null : event.target.value)}
          className={inputClass}
        >
          <option value="">— none —</option>
          {voices.map((asset) => (
            <option key={asset.id} value={asset.id}>
              {asset.name}
            </option>
          ))}
        </select>
      </Field>

      <button
        type="button"
        onClick={onDelete}
        className="w-full rounded border border-ink-700 py-1 text-[11px] text-ink-300 hover:border-red-900 hover:bg-red-950/40 hover:text-red-300"
      >
        Delete line
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Gain                                                                */
/* ------------------------------------------------------------------ */

/**
 * The per-clip mix control.
 *
 * A range input fires `change` on every pixel of travel, so committing on it would
 * bury one gesture under dozens of undo steps. The value is local while the pointer is
 * down and reaches the document on release.
 */
function GainField({
  clip,
  onCommit,
}: {
  clip: Clip | null;
  onCommit: (gain: number) => void;
}): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null);
  const committed = clip?.gain ?? 1;
  const value = draft ?? committed;

  // A cue that has gone away must not leave the slider showing a value that belongs to
  // nothing.
  useEffect(() => {
    if (clip === null) setDraft(null);
  }, [clip]);

  const flush = (): void => {
    if (draft === null) return;
    setDraft(null);
    if (Math.abs(draft - committed) > 1e-6) onCommit(draft);
  };

  return (
    <Field label="Gain" hint="Linear level for this cue, 0 to 2.">
      <input
        type="range"
        aria-label="Gain"
        min={0}
        max={2}
        step={0.05}
        disabled={!clip}
        value={value}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={flush}
        onKeyUp={flush}
        onBlur={flush}
        className="w-full accent-zanza-500 disabled:opacity-40"
      />
      <span className="font-mono text-[10px] text-ink-500" data-testid="gain-readout">
        {value.toFixed(2)}
      </span>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const inputClass =
  'w-full min-w-0 rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[11px] text-ink-100 outline-none focus:border-zanza-500 disabled:opacity-40';

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] leading-snug text-ink-500">{hint}</span>}
    </label>
  );
}

/** The honest voice status. Never implies a file that is not there (RULE 9). */
function voiceHint(voice: AudioDef | null, recorded: boolean): string {
  if (!voice) return 'No voice assigned. The line plays silent.';
  if (!recorded) return 'No recording: this slot declares a voice but has no file. Plays silent.';
  return `Recording attached (${voice.duration.toFixed(1)}s).`;
}

interface DraftField {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/**
 * A text field whose document edit happens on blur.
 *
 * The draft is local while the field has focus, so an external change (an undo, a
 * reload) cannot overwrite what is half-typed, and the document never sees a keystroke
 * it was not asked to accept.
 */
function useDraftField(value: string, onCommit: (next: string) => void): DraftField {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return {
    value: draft,
    onChange: (event) => setDraft(event.target.value),
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      onCommit(draft);
    },
  };
}

function resolveLine(
  scene: Scene,
  kind: string | null,
  id: Id | null,
): DialogueLine | null {
  if (!id) return null;
  if (kind === 'line') return scene.dialogue.find((l) => l.id === id) ?? null;
  if (kind === 'clip') {
    const clip = scene.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
    if (!clip?.dialogueLineId) return null;
    return scene.dialogue.find((l) => l.id === clip.dialogueLineId) ?? null;
  }
  return null;
}

function cuesFor(scene: Scene, lineId: Id): Cue[] {
  const out: Cue[] = [];
  for (const track of scene.tracks) {
    for (const clip of track.clips) {
      if (clip.dialogueLineId === lineId) out.push({ track, clip });
    }
  }
  return out;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
