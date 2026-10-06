/**
 * The camera panel.
 *
 * Three ways to set a shot, in the order an artist reaches for them: type the numbers,
 * start from a preset, or frame what is already staged. The fourth affordance — reading
 * and trimming a camera move — belongs to the timeline, so this panel reports the state
 * of that lane rather than pretending to edit it.
 *
 * Everything here goes through one `commit()` per gesture. The numeric fields commit on
 * blur, so typing "1.4" is one undo step rather than three. Preset application and
 * frame-the-selection are each a single pure operation covering everything they change,
 * so they too undo in one press.
 *
 * Selection is single-item, which is why framing is honest about what it will frame:
 * the selected actor if there is one, otherwise every visible actor.
 */

import { useState } from 'react';
import { useEditor, useOpenProject, useOpenSeries } from '../../state/editorStore';
import { draftNumberInputProps, inputClass, round2, useDraftNumber } from '../draftFields';
import { Field } from '../fields';
import type { Camera, CameraPreset, Id, Project, Scene } from '../../core/types';
import {
  applyCameraPreset,
  cameraClips,
  clearCameraMoves,
  frameSelection,
  setSceneCamera,
} from '../../core/document/cameraOps';
import { resolveCameraPresets, sceneEnvironment } from '../../core/document/lookups';
import { resolveAssets } from '../../core/document/scopes';
import { degToRad, radToDeg } from '../../core/geometry';

const buttonClass =
  'rounded border border-ink-700 px-2 py-1 text-[11px] text-ink-200 hover:border-zanza-500 hover:text-white disabled:opacity-40 disabled:hover:border-ink-700 disabled:hover:text-ink-200';

export function CameraPanel(): React.JSX.Element {
  const project = useOpenProject();
  const sceneId = useEditor((s) => s.sceneId);
  const selection = useEditor((s) => s.selection);
  const commit = useEditor((s) => s.commit);

  const scene = project.scenes.find((s) => s.id === sceneId);

  // Split out so the draft fields below are hooks of a component that only mounts when
  // there is a scene. Returning early instead would make the hook count depend on the
  // store, and the first scene opened after an empty one would break.
  if (!scene) {
    return <section className="px-3 py-2 text-[11px] text-ink-500">No scene open.</section>;
  }

  return (
    <CameraBody
      sceneId={sceneId}
      scene={scene}
      selectedActorId={selection.kind === 'actor' ? selection.id : null}
      onChange={commit}
    />
  );
}

function CameraBody({
  sceneId,
  scene,
  selectedActorId,
  onChange,
}: {
  sceneId: Id;
  scene: Scene;
  selectedActorId: Id | null;
  onChange: (next: Project, label?: string) => void;
}): React.JSX.Element {
  const project = useOpenProject();
  const [presetId, setPresetId] = useState('');
  const camera = scene.camera;
  // The panel reads the owning series and merges it itself rather than being handed a
  // resolved context. That is deliberate at the panel boundary and nowhere else: the *scene
  // operations* below take a library, and the one place that knows both the project and its
  // series is this one, so the merge happens here instead of being repeated by each caller.
  const series = useOpenSeries();
  const library = resolveAssets(project, series).assets;
  const presets = resolveCameraPresets(project, series);
  const moves = cameraClips(scene);
  const environment = sceneEnvironment(library, scene);

  // A visible actor is one the shot should actually include. An actor left visible but
  // off-stage would drag the framing to somewhere the user cannot see.
  const visibleActors = scene.actors.filter((a) => a.visible);
  const frameIds: Id[] =
    selectedActorId && visibleActors.some((a) => a.id === selectedActorId)
      ? [selectedActorId]
      : visibleActors.map((a) => a.id);
  const framingOne = frameIds.length === 1;

  const applyFraming = (patch: Partial<Camera>, label: string): void => {
    const next = setSceneCamera(project, sceneId, patch);
    if (next === project) return;
    onChange(next, label);
  };

  const onPreset = (value: string): void => {
    const preset: CameraPreset | undefined = presets.find((p) => p.id === value);
    if (!preset) return;
    onChange(applyCameraPreset(project, sceneId, preset), `Camera: ${preset.name}`);
  };

  const onFrame = (): void => {
    const next = frameSelection(project, library, sceneId, frameIds, {
      frame: {
        width: environment?.width ?? project.settings.width,
        height: environment?.height ?? project.settings.height,
      },
    });
    if (next === project) return;
    onChange(next, 'Frame selection');
  };

  const onRemoveMove = (): void => {
    const next = clearCameraMoves(project, sceneId);
    if (next === project) return;
    onChange(next, 'Remove camera move');
  };

  const x = useDraftNumber(camera.x, (v) => applyFraming({ x: v }, 'Camera X'), round2);
  const y = useDraftNumber(camera.y, (v) => applyFraming({ y: v }, 'Camera Y'), round2);
  const zoom = useDraftNumber(camera.zoom, (v) => applyFraming({ zoom: v }, 'Camera zoom'), round2);
  const rotation = useDraftNumber(
    radToDeg(camera.rotation),
    (v) => applyFraming({ rotation: degToRad(v) }, 'Camera rotation'),
    (n) => Math.round(n * 10) / 10,
  );

  return (
    <section className="space-y-3 px-3 py-2">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Camera
        </h2>
        <span className="font-mono text-[11px] text-ink-500">
          {scene.name} · {environment ? `${environment.width}×${environment.height}` : 'no environment'}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label="X" hint={invalid(x) ? 'Not a number — ignored' : undefined}>
          <input {...draftNumberInputProps(x)} aria-label="X" className={inputClass} inputMode="decimal" />
        </Field>
        <Field label="Y" hint={invalid(y) ? 'Not a number — ignored' : undefined}>
          <input {...draftNumberInputProps(y)} aria-label="Y" className={inputClass} inputMode="decimal" />
        </Field>
        <Field label="Zoom" hint="1 shows the whole frame. Larger is closer.">
          <input {...draftNumberInputProps(zoom)} aria-label="Zoom" className={inputClass} inputMode="decimal" />
        </Field>
        <Field label="Rotation (degrees)" hint={invalid(rotation) ? 'Not a number — ignored' : undefined}>
          <input
            {...draftNumberInputProps(rotation)}
            aria-label="Rotation (degrees)"
            className={inputClass}
            inputMode="decimal"
          />
        </Field>
      </div>

      <div className="space-y-1.5">
        <Field label="Preset" hint="Copies the framing in. Edits afterwards do not change the preset.">
          <select
            aria-label="Preset"
            className={inputClass}
            value={presetId}
            onChange={(event) => setPresetId(event.target.value)}
          >
            <option value="">Choose a framing…</option>
            {presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
        </Field>
        <button
          type="button"
          className={`${buttonClass} w-full`}
          disabled={!presetId}
          onClick={() => onPreset(presetId)}
        >
          Apply preset
        </button>
        {presets.length === 0 && (
          <p className="text-[10px] text-ink-500">No presets in this project.</p>
        )}
      </div>

      <div className="space-y-1.5">
        {/* Not a `Field`: that renders a <label>, and a button inside a label takes
            the label's text as its accessible name, which would make this button
            announce as "Framing Frames the selected actor." instead of its own. */}
        <span className="block text-[10px] uppercase tracking-wider text-ink-500">Framing</span>
        <button
          type="button"
          className={`${buttonClass} w-full`}
          disabled={visibleActors.length === 0}
          onClick={onFrame}
        >
          Frame selection
        </button>
        <span className="block text-[10px] leading-snug text-ink-500">
          {visibleActors.length === 0
            ? 'No actors in this scene to frame.'
            : framingOne
              ? 'Frames the selected actor.'
              : 'No actor selected — frames all visible actors.'}
        </span>
      </div>

      <div className="space-y-1.5 border-t border-ink-800 pt-2">
        <p className="text-[10px] uppercase tracking-wider text-ink-500">Camera move</p>
        {moves.length === 0 ? (
          <p className="text-[10px] leading-snug text-ink-500">
            No camera move on the timeline. The shot holds this framing for its whole
            duration.
          </p>
        ) : (
          <p className="text-[10px] leading-snug text-ink-500">
            {moves.length === 1 ? 'One clip' : `${moves.length} clips`} on the camera lane.
            Add keyframes there to move the camera over time.
          </p>
        )}
        <button
          type="button"
          className={`${buttonClass} w-full`}
          disabled={moves.length === 0}
          onClick={onRemoveMove}
        >
          Remove camera move
        </button>
      </div>
    </section>
  );
}

function invalid(field: { invalid: boolean }): boolean | undefined {
  return field.invalid ? true : undefined;
}
