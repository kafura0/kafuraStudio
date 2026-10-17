/**
 * Scene-plan compilation (ARCHITECTURE_SPEC.md §11.1, §11.6 — Phase 17).
 *
 * `compilePlan` turns a validated plan into the ordered `Command[]` that produces it:
 * the same object literals the editor's store would dispatch, so a plan is authored
 * once and replayed through the ordinary mutation surface — no second writer.
 *
 * It reads two things. Ids and timing come from `validatePlan`'s `ResolvedPlanReferences`
 * so the compiler can never disagree with the validator about a reference (§11.3 rule 4).
 * Literal content — dialogue text, an emotion, a pose override — comes from the parsed
 * body, re-parsed here because the resolution intentionally drops the author's words.
 *
 * Fresh ids are never minted here. Commands that create a scene, an actor, a track or a
 * clip are compiled with a *plan-local handle* in the id field (`@scene`, `@cast:0`,
 * `@camera-track`); `applyPlan` substitutes the real id after the command that ref-outs
 * it has run. That is what makes a plan that creates its own scene expressible: the
 * commands after `CreateScene` refer to an id that does not exist yet.
 *
 * `animation` is accepted and deliberately not compiled (§9.2, RULE 9): the animation
 * system is Phase 20+. It is not silently dropped — the validator existence-checks it.
 */
import type { Id } from '../types';
import {
  CAMERA_TARGET_ID,
  CAMERA_TRACK_NAME,
  cameraClips,
  type CameraPatch,
} from '../document/cameraOps';
import type { AddClipCommand } from '../commands/addClip';
import type { AddDialogueLineCommand } from '../commands/addDialogueLine';
import type { AddKeyframeCommand } from '../commands/addKeyframe';
import type { ApplyCameraPresetCommand } from '../commands/applyCameraPreset';
import type { ClearCameraMovesCommand } from '../commands/clearCameraMoves';
import type { CreateSceneCommand } from '../commands/createScene';
import type { PlaceCharacterCommand } from '../commands/placeCharacter';
import type { SetSceneCameraCommand } from '../commands/setSceneCamera';
import { parseScenePlan } from './parse';
import {
  PLAN_CAMERA_CLIP_HANDLE,
  PLAN_CAMERA_TRACK_HANDLE,
  PLAN_SCENE_HANDLE,
  planCastHandle,
  planExpressionClipHandle,
  planExpressionTrackHandle,
  type Assumption,
  type CompileResult,
  type PlanContext,
  type PlanEnvelope,
  type ResolvedPlanReferences,
  type ScenePlan,
} from './types';
import { validatePlan } from './validate';

/**
 * The commands a plan compiles to, plus the decisions made along the way.
 *
 * `warnings` carries the validator's warnings forward unchanged — an author reviewing a
 * compile should see everything the pipeline noticed — and `assumptions` is the
 * validator's list extended with the compiler's own (the expression anchor, §11.6).
 */
export function compilePlan(ctx: PlanContext, envelope: PlanEnvelope): CompileResult {
  const validation = validatePlan(ctx, envelope);
  if (!validation.ok) return { ok: false, diagnostics: validation.diagnostics };

  const parsed = parseScenePlan(envelope.body);
  if (!parsed.ok) {
    // Unreachable: `validatePlan` parses the body before it does anything else.
    return {
      ok: false,
      diagnostics: [
        { severity: 'error', path: parsed.error.path, code: 'unknown-field', message: parsed.error.message },
      ],
    };
  }
  const plan = parsed.value;
  const { resolved } = validation;

  const commands: PlanCommand[] = [];
  const assumptions: Assumption[] = [...resolved.assumptions];
  const sceneId: Id = resolved.createsScene ? PLAN_SCENE_HANDLE : (resolved.sceneId ?? '');

  pushSceneCommand(commands, plan, resolved);
  pushCastCommands(commands, plan, sceneId, resolved);
  pushDialogueCommands(commands, sceneId, resolved);
  pushExpressionCommands(commands, sceneId, resolved, assumptions);
  pushCameraCommands(commands, sceneId, ctx, resolved);

  return {
    ok: true,
    commands,
    warnings: validation.diagnostics.filter((d) => d.severity === 'warning'),
    assumptions,
  };
}

type Resolved = ResolvedPlanReferences;

/**
 * The command kinds a scene plan compiles to. Naming the union gives the array a
 * discriminated contextual type, so each pushed literal is checked against its own
 * command interface — not the bare `Command` base, which would reject the payload fields.
 */
type PlanCommand =
  | CreateSceneCommand
  | PlaceCharacterCommand
  | AddDialogueLineCommand
  | AddClipCommand
  | AddKeyframeCommand
  | ApplyCameraPresetCommand
  | SetSceneCameraCommand
  | ClearCameraMovesCommand;

/** A scene the plan creates, with the fresh id handled later by `applyPlan`. */
function pushSceneCommand(commands: PlanCommand[], plan: ScenePlan, resolved: Resolved): void {
  if (!resolved.createsScene || plan.newScene === undefined) return;
  commands.push({
    kind: 'CreateScene',
    name: plan.newScene.name,
    environmentId: resolved.environmentId,
    duration: resolved.sceneDuration,
    ...(resolved.backgroundColor !== null ? { backgroundColor: resolved.backgroundColor } : {}),
    sceneRef: PLAN_SCENE_HANDLE,
  } satisfies CreateSceneCommand);
}

/**
 * One `PlaceCharacter` per cast entry, in plan order.
 *
 * `displayName` is only sent when the plan set one — otherwise the character's own name
 * is already correct and sending it would be a needless write. `actorRef` carries the
 * handle the dialogue and expression commands refer to.
 */
function pushCastCommands(commands: PlanCommand[], plan: ScenePlan, sceneId: Id, resolved: Resolved): void {
  for (const entry of resolved.cast) {
    const planned = plan.cast?.[entry.index];
    commands.push({
      kind: 'PlaceCharacter',
      sceneId,
      characterId: entry.characterId,
      ...(planned?.displayName !== undefined ? { displayName: planned.displayName } : {}),
      poseId: entry.poseId,
      expressionId: entry.expressionId,
      ...(entry.anchorId !== null ? { anchorId: entry.anchorId } : {}),
      ...(entry.transform !== null ? { transform: entry.transform } : {}),
      ...(entry.z !== null ? { z: entry.z } : {}),
      ...(entry.flipX ? { flipX: true } : {}),
      actorRef: planCastHandle(entry.index),
    } satisfies PlaceCharacterCommand);
  }
}

/** One `AddDialogueLine` per line, carrying the cue window the validator laid out. */
function pushDialogueCommands(commands: PlanCommand[], sceneId: Id, resolved: Resolved): void {
  for (const line of resolved.lines) {
    commands.push({
      kind: 'AddDialogueLine',
      sceneId,
      speaker: line.speaker,
      text: line.text,
      emotion: line.emotion,
      actorId: resolveLineActor(line.actor),
      ...(line.subtitle !== null ? { subtitle: line.subtitle } : {}),
      ...(line.voiceAudioId !== null ? { voiceAudioId: line.voiceAudioId } : {}),
      start: line.cue.start,
      duration: line.cue.duration,
    } satisfies AddDialogueLineCommand);
  }
}

function resolveLineActor(actor: Resolved['lines'][number]['actor']): Id | null {
  if (actor.source === 'cast') return planCastHandle(actor.castIndex);
  if (actor.source === 'scene-actor') return actor.actorId;
  return null;
}

/**
 * Expression changes become a keyframe clip on the cast actor's track.
 *
 * Discrete channels hold the value of the previous keyframe, so the clip needs an anchor
 * keyframe at 0 to keep the actor's entry expression until the first change. When the
 * plan already changes the expression at 0 the change itself is the anchor. The anchor is
 * recorded as an assumption because it is a value the author did not spell out.
 */
function pushExpressionCommands(
  commands: PlanCommand[],
  sceneId: Id,
  resolved: Resolved,
  assumptions: Assumption[],
): void {
  for (const entry of resolved.cast) {
    if (entry.expressionChanges.length === 0) continue;
    const trackHandle = planExpressionTrackHandle(entry.index);
    const clipHandle = planExpressionClipHandle(entry.index);

    commands.push({
      kind: 'AddClip',
      sceneId,
      trackKind: 'actor',
      targetId: planCastHandle(entry.index),
      name: `${entry.displayName} expression`,
      start: 0,
      duration: resolved.sceneDuration,
      trackRef: trackHandle,
      clipRef: clipHandle,
    } satisfies AddClipCommand);

    if (!entry.expressionChanges.some((change) => change.at === 0)) {
      commands.push({
        kind: 'AddKeyframe',
        sceneId,
        trackId: trackHandle,
        clipId: clipHandle,
        time: 0,
        props: { expressionId: entry.expressionId },
        ease: 'step',
      } satisfies AddKeyframeCommand);
      assumptions.push({
        path: `cast[${entry.index}].expressionChanges`,
        decision: `${entry.displayName} holds ${entry.expressionId} until the first expression change.`,
        reason:
          'A discrete channel holds its previous keyframe, so the clip needs an explicit anchor at time 0.',
      });
    }

    for (const change of entry.expressionChanges) {
      commands.push({
        kind: 'AddKeyframe',
        sceneId,
        trackId: trackHandle,
        clipId: clipHandle,
        time: change.at,
        props: { expressionId: change.expressionId },
        ease: 'step',
      } satisfies AddKeyframeCommand);
    }
  }
}

/**
 * Camera: a preset is one command; a move is the rest framing, a conditional clear, and
 * one keyframed clip spanning the scene.
 *
 * The clear is emitted only when the target scene already has camera clips — a plan is a
 * statement about the shot, and layering its move over someone else's would be a bug, but
 * clearing an empty track is a no-op that would still touch the document.
 */
function pushCameraCommands(
  commands: PlanCommand[],
  sceneId: Id,
  ctx: PlanContext,
  resolved: Resolved,
): void {
  const camera = resolved.camera;
  if (camera === null) return;

  if (camera.mode === 'preset') {
    commands.push({
      kind: 'ApplyCameraPreset',
      sceneId,
      presetId: camera.presetId,
    } satisfies ApplyCameraPresetCommand);
    return;
  }

  const rest = cameraRestPatch(camera.rest);
  if (Object.keys(rest).length > 0) {
    commands.push({ kind: 'SetSceneCamera', sceneId, patch: rest } satisfies SetSceneCameraCommand);
  }
  if (!resolved.createsScene && resolved.sceneId !== null && sceneHasCameraClips(ctx.project, resolved.sceneId)) {
    commands.push({ kind: 'ClearCameraMoves', sceneId } satisfies ClearCameraMovesCommand);
  }

  commands.push({
    kind: 'AddClip',
    sceneId,
    trackKind: 'camera',
    targetId: CAMERA_TARGET_ID,
    name: CAMERA_TRACK_NAME,
    start: camera.clipStart,
    duration: camera.clipDuration,
    trackRef: PLAN_CAMERA_TRACK_HANDLE,
    clipRef: PLAN_CAMERA_CLIP_HANDLE,
  } satisfies AddClipCommand);

  for (const keyframe of camera.keyframes) {
    commands.push({
      kind: 'AddKeyframe',
      sceneId,
      trackId: PLAN_CAMERA_TRACK_HANDLE,
      clipId: PLAN_CAMERA_CLIP_HANDLE,
      time: keyframe.time,
      props: keyframe.props,
      ease: keyframe.ease,
    } satisfies AddKeyframeCommand);
  }
}

function cameraRestPatch(rest: {
  x?: number;
  y?: number;
  zoom?: number;
  rotation?: number;
}): CameraPatch {
  const patch: CameraPatch = {};
  if (rest.x !== undefined) patch.x = rest.x;
  if (rest.y !== undefined) patch.y = rest.y;
  if (rest.zoom !== undefined) patch.zoom = rest.zoom;
  if (rest.rotation !== undefined) patch.rotation = rest.rotation;
  return patch;
}

function sceneHasCameraClips(project: PlanContext['project'], sceneId: Id): boolean {
  const scene = project.scenes.find((s) => s.id === sceneId);
  return scene !== undefined && cameraClips(scene).length > 0;
}
