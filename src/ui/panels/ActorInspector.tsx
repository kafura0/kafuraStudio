/**
 * PER-ACTOR INSPECTOR (MVP check 4: rows 7–9).
 *
 * Gives every actor on stage a handle: select an actor, then move/scale it, change its
 * pose, or change its expression. Each gesture is one `dispatch` → one `commit`, so
 * Ctrl+Z undoes the whole gesture and Ctrl+Shift+Z brings it back.
 *
 * This is pure UI over the command seam — no `document/*Ops` import here, so G6 holds.
 */
import { useMemo, useState } from 'react';
import { useEditor, useOpenContext, useOpenProject } from '../../state/editorStore';
import { draftNumberInputProps, inputClass, useDraftNumber } from '../draftFields';
import type { Id, Transform2D } from '../../core/types';

const fieldLabel = 'text-[10px] uppercase tracking-wider text-ink-500 mb-1 block';

const DEFAULT_TRANSFORM: Transform2D = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  alpha: 1,
};

export function ActorInspector(): React.JSX.Element {
  const project = useOpenProject();
  const context = useOpenContext();
  const sceneId = useEditor((s) => s.sceneId);
  const setActorTransform = useEditor((s) => s.setActorTransform);
  const setActorPose = useEditor((s) => s.setActorPose);
  const setActorExpression = useEditor((s) => s.setActorExpression);

  const scene = project?.scenes.find((s) => s.id === sceneId);
  const assets = context?.assets ?? project?.assets;

  const actorsWithCharacter = useMemo(
    () =>
      scene?.actors.map((actor) => {
        const character = assets?.characters.find((c) => c.id === actor.characterId);
        return { actor, character };
      }) ?? [],
    [scene?.actors, assets?.characters],
  );

  const [selectedActorId, setSelectedActorId] = useState<Id | null>(
    actorsWithCharacter.length > 0 ? actorsWithCharacter[0]!.actor.id : null,
  );

  const selected = actorsWithCharacter.find((a) => a.actor.id === selectedActorId);
  const actor = selected?.actor;
  const character = selected?.character;

  const poses = useMemo(() => assets?.poses ?? [], [assets?.poses]);
  const expressions = useMemo(() => assets?.expressions ?? [], [assets?.expressions]);

  // Hooks must run unconditionally. When there is no actor, the fields below are never
  // rendered (early return below), so their onBlur callbacks never fire; the default
  // transform keeps the hooks happy.
  const effectiveActor = actor ?? { transform: DEFAULT_TRANSFORM };
  const xField = useDraftNumber(effectiveActor.transform.x, (next) => {
    setActorTransform(sceneId, actor!.id, { x: next });
  });
  const yField = useDraftNumber(effectiveActor.transform.y, (next) => {
    setActorTransform(sceneId, actor!.id, { y: next });
  });
  const scaleXField = useDraftNumber(effectiveActor.transform.scaleX, (next) => {
    setActorTransform(sceneId, actor!.id, { scaleX: next });
  });
  const scaleYField = useDraftNumber(effectiveActor.transform.scaleY, (next) => {
    setActorTransform(sceneId, actor!.id, { scaleY: next });
  });
  const rotationField = useDraftNumber(effectiveActor.transform.rotation, (next) => {
    setActorTransform(sceneId, actor!.id, { rotation: next });
  });

  if (!scene || scene.actors.length === 0 || !actor) {
    return (
      <section className="border-t border-ink-800 px-3 py-3 space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Actor inspector
        </h2>
        <p className="text-[10px] text-ink-500">No actors on stage yet.</p>
      </section>
    );
  }

  return (
    <section className="border-t border-ink-800 px-3 py-3 space-y-3">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        Actor inspector
      </h2>

      <div className="space-y-1">
        <label className={fieldLabel}>Actor</label>
        <select
          value={selectedActorId ?? ''}
          onChange={(event) => setSelectedActorId(event.target.value as Id)}
          className={inputClass}
        >
          {actorsWithCharacter.map((entry) => (
            <option key={entry.actor.id} value={entry.actor.id}>
              {entry.actor.displayName}
              {entry.character ? ` — ${entry.character.name}` : ''}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1">
        <label className={fieldLabel}>Character</label>
        <p className={`font-mono text-[11px] text-ink-200 ${inputClass}`}>
          {character?.name ?? '(unknown)'}
        </p>
      </div>

      {/* Transform — row 7: move and scale characters */}
      <div className="space-y-2 pt-1 border-t border-ink-800/30">
        <div className={fieldLabel}>Position</div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] text-ink-500">X</label>
            <input type="text" {...draftNumberInputProps(xField)} className={inputClass} />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-ink-500">Y</label>
            <input type="text" {...draftNumberInputProps(yField)} className={inputClass} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <div className="space-y-0.5">
            <label className="text-[10px] text-ink-500">Scale X</label>
            <input type="text" {...draftNumberInputProps(scaleXField)} className={inputClass} />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-ink-500">Scale Y</label>
            <input type="text" {...draftNumberInputProps(scaleYField)} className={inputClass} />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] text-ink-500">Rotation</label>
            <input type="text" {...draftNumberInputProps(rotationField)} className={inputClass} />
          </div>
        </div>
      </div>

      {/* Pose — row 8 */}
      <div className="space-y-1">
        <label className={fieldLabel}>Pose</label>
        <select
          value={actor.poseId}
          onChange={(event) => setActorPose(sceneId, actor.id, event.target.value as Id)}
          className={inputClass}
        >
          {poses.map((pose) => (
            <option key={pose.id} value={pose.id}>
              {pose.name}
            </option>
          ))}
        </select>
      </div>

      {/* Expression — row 9 */}
      <div className="space-y-1">
        <label className={fieldLabel}>Expression</label>
        <select
          value={actor.expressionId}
          onChange={(event) =>
            setActorExpression(sceneId, actor.id, event.target.value as Id)
          }
          className={inputClass}
        >
          {expressions.map((expr) => (
            <option key={expr.id} value={expr.id}>
              {expr.name}
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
