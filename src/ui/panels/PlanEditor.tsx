/**
 * The plan editor (ARCHITECTURE_SPEC.md §13.4, §24.9, §26 Phase 18 step 4).
 *
 * A form over `ScenePlan`, **not** over the document. Every change here calls `onPlan` /
 * `onTitle` with a new plan value; the panel above re-validates and re-previews on each
 * change and *nothing is committed*. That is the whole point of editing the plan rather than
 * the document (§13.4): a reviewer can iterate freely, and the only history step is the
 * final Apply.
 *
 * A field shows the neutral `Edited` badge when its body path is in `edited` — computed by
 * the panel comparing the plan to the plan as it arrived, never inferred (`edits.ts`). The
 * badge says "a human changed this after it was proposed" and nothing else (§14.2).
 */
import { inputClass, useDraftField, useDraftNumber, draftNumberInputProps, round2 } from '../draftFields';
import type { CastEntry, PlannedLine, ScenePlan } from '../../core/plans/types';

export interface PlanEditorProps {
  plan: ScenePlan;
  title: string;
  /** Body paths (and `title`) a human changed after the plan arrived. */
  edited: ReadonlySet<string>;
  onTitle: (next: string) => void;
  onPlan: (next: ScenePlan) => void;
}

/** The neutral `Edited` badge (§14.2). Rendered only when the value was changed by a person. */
function EditedTag({ show }: { show: boolean }): React.JSX.Element | null {
  if (!show) return null;
  return (
    <span
      className="ml-1 rounded bg-ink-800 px-1 py-px font-mono text-[9px] uppercase tracking-wide text-ink-300"
      title="A human changed this value after the plan proposed it."
    >
      Edited
    </span>
  );
}

function FieldRow({
  label,
  edited,
  children,
}: {
  label: string;
  edited: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-ink-500">
        <span className="flex items-baseline">
          {label}
          <EditedTag show={edited} />
        </span>
      </span>
      {children}
    </label>
  );
}

function TextField({
  label,
  path,
  value,
  edited,
  onCommit,
}: {
  label: string;
  path: string;
  value: string;
  edited: ReadonlySet<string>;
  onCommit: (next: string) => void;
}): React.JSX.Element {
  const field = useDraftField(value, onCommit);
  return (
    <FieldRow label={label} edited={edited.has(path) || edited.has(`${path}.text`)}>
      <input className={inputClass} aria-label={label} {...field} />
    </FieldRow>
  );
}

function NumberField({
  label,
  path,
  value,
  edited,
  onCommit,
}: {
  label: string;
  path: string;
  value: number;
  edited: ReadonlySet<string>;
  onCommit: (next: number) => void;
}): React.JSX.Element {
  const field = useDraftNumber(value, onCommit, round2);
  return (
    <FieldRow label={label} edited={edited.has(path)}>
      <input
        className={inputClass}
        inputMode="decimal"
        aria-label={label}
        {...draftNumberInputProps(field)}
      />
    </FieldRow>
  );
}

/** Replace one entry of a list immutably, leaving the rest identical. */
function replaceAt<T>(list: readonly T[], index: number, next: T): T[] {
  return list.map((entry, at) => (at === index ? next : entry));
}

function castRow(
  entry: CastEntry,
  index: number,
  edited: ReadonlySet<string>,
  onPlan: (next: ScenePlan) => void,
  plan: ScenePlan,
): React.JSX.Element {
  const base = `cast[${index}]`;
  const update = (patch: Partial<CastEntry>): void =>
    onPlan({ ...plan, cast: replaceAt(plan.cast ?? [], index, { ...entry, ...patch }) });
  return (
    <div key={`${entry.characterId}:${index}`} className="space-y-1 rounded border border-ink-800 p-1.5">
      <div className="font-mono text-[10px] text-ink-500">{entry.characterId}</div>
      <TextField
        label="Anchor"
        path={`${base}.anchorId`}
        value={entry.anchorId ?? ''}
        edited={edited}
        onCommit={(anchorId) => update({ anchorId })}
      />
      <TextField
        label="Pose"
        path={`${base}.poseId`}
        value={entry.poseId ?? ''}
        edited={edited}
        onCommit={(poseId) => update({ poseId })}
      />
      <NumberField
        label="Depth (z)"
        path={`${base}.z`}
        value={entry.z ?? 0}
        edited={edited}
        onCommit={(z) => update({ z })}
      />
    </div>
  );
}

function lineRow(
  line: PlannedLine,
  index: number,
  edited: ReadonlySet<string>,
  onPlan: (next: ScenePlan) => void,
  plan: ScenePlan,
): React.JSX.Element {
  const base = `dialogue[${index}]`;
  const update = (patch: Partial<PlannedLine>): void =>
    onPlan({ ...plan, dialogue: replaceAt(plan.dialogue ?? [], index, { ...line, ...patch }) });
  return (
    <div key={`${line.speaker}:${index}`} className="space-y-1 rounded border border-ink-800 p-1.5">
      <div className="font-mono text-[10px] text-ink-500">
        {line.speaker} · {line.actorRef}
      </div>
      <TextField
        label="Line"
        path={`${base}.text`}
        value={line.text}
        edited={edited}
        onCommit={(text) => update({ text })}
      />
      <div className="flex gap-2">
        <NumberField
          label="Start"
          path={`${base}.start`}
          value={line.start ?? 0}
          edited={edited}
          onCommit={(start) => update({ start })}
        />
        <NumberField
          label="Duration"
          path={`${base}.duration`}
          value={line.duration ?? 0}
          edited={edited}
          onCommit={(duration) => update({ duration })}
        />
      </div>
    </div>
  );
}

export function PlanEditor({
  plan,
  title,
  edited,
  onTitle,
  onPlan,
}: PlanEditorProps): React.JSX.Element {
  const titleField = useDraftField(title, onTitle);
  return (
    <div className="space-y-2">
      <FieldRow label="Plan title" edited={edited.has('title')}>
        <input className={inputClass} aria-label="Plan title" {...titleField} />
      </FieldRow>

      {plan.newScene && (
        <div className="space-y-1 rounded border border-ink-800 p-1.5">
          <div className="font-mono text-[10px] text-ink-500">New scene</div>
          <TextField
            label="Name"
            path="newScene.name"
            value={plan.newScene.name}
            edited={edited}
            onCommit={(name) =>
              plan.newScene && onPlan({ ...plan, newScene: { ...plan.newScene, name } })
            }
          />
          <NumberField
            label="Duration (s)"
            path="newScene.duration"
            value={plan.newScene.duration}
            edited={edited}
            onCommit={(duration) =>
              plan.newScene && onPlan({ ...plan, newScene: { ...plan.newScene, duration } })
            }
          />
        </div>
      )}

      {plan.cast && plan.cast.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Cast</div>
          {plan.cast.map((entry, index) => castRow(entry, index, edited, onPlan, plan))}
        </div>
      )}

      {plan.dialogue && plan.dialogue.length > 0 && (
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-ink-500">Dialogue</div>
          {plan.dialogue.map((line, index) => lineRow(line, index, edited, onPlan, plan))}
        </div>
      )}
    </div>
  );
}
