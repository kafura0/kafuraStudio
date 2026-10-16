/**
 * Plan validation (ARCHITECTURE_SPEC.md §10 — Phase 17).
 *
 * `validatePlan` is the only place a plan is checked against reality, and the only
 * place `ResolvedPlanReferences` is produced. The compiler never re-resolves: it
 * consumes the validator's resolution verbatim, so §11.3 rule 4 (what the validator
 * accepted is what the compiler emits) holds by construction.
 *
 * Diagnostics use the §10.2 vocabulary with body-relative paths. Codes that only the
 * episode/street-plan kinds will need (`unknown-series`, `cycle`, `missing-prop`,
 * `missing-audio`, `voice-incompatible`, `style-mismatch`, `wardrobe-mismatch`) are
 * declared but not emitted by a scene plan — deliberately, per RULE 9.
 */
import type {
  Assumption,
  CastEntry,
  PlanContext,
  PlanDiagnostic,
  PlanEnvelope,
  PlanValidation,
  ResolvedCastEntry,
  ResolvedCamera,
  ResolvedLine,
  ResolvedPlanReferences,
  ScenePlan,
} from './types';
import { parseScenePlan } from './parse';
import { layoutDialogue } from './layout';
import {
  findAudioDef,
  findCharacter,
  findEnvironment,
  findExpression,
  findPose,
  resolveCameraPresets,
} from '../document/lookups';

/** An empty resolution, returned whenever the body cannot be trusted. */
function emptyResolution(): ResolvedPlanReferences {
  return {
    sceneId: null,
    createsScene: false,
    sceneDuration: 0,
    environmentId: '',
    backgroundColor: null,
    cast: [],
    lines: [],
    camera: null,
    assumptions: [],
  };
}

export function validatePlan(ctx: PlanContext, envelope: PlanEnvelope): PlanValidation {
  const diagnostics: PlanDiagnostic[] = [];
  const assumptions: Assumption[] = [];
  const error = (path: string, code: PlanDiagnostic['code'], message: string, hint?: string): void => {
    diagnostics.push(hint === undefined
      ? { severity: 'error', path, code, message }
      : { severity: 'error', path, code, message, hint });
  };
  const warn = (path: string, code: PlanDiagnostic['code'], message: string, hint?: string): void => {
    diagnostics.push(hint === undefined
      ? { severity: 'warning', path, code, message }
      : { severity: 'warning', path, code, message, hint });
  };
  const info = (path: string, code: PlanDiagnostic['code'], message: string, hint?: string): void => {
    diagnostics.push(hint === undefined
      ? { severity: 'info', path, code, message }
      : { severity: 'info', path, code, message, hint });
  };

  if (envelope.kind !== 'scene') {
    error('kind', 'unknown-field', `A scene plan cannot carry kind '${envelope.kind}'.`);
    return { ok: false, diagnostics, resolved: emptyResolution() };
  }

  const parsed = parseScenePlan(envelope.body);
  if (!parsed.ok) {
    error(parsed.error.path, 'unknown-field', parsed.error.message);
    return { ok: false, diagnostics, resolved: emptyResolution() };
  }
  const plan: ScenePlan = parsed.value;

  /* --- the target scene ------------------------------------------- */

  let createsScene = false;
  let sceneId: string | null = null;
  let sceneDuration = 0;
  let environmentId = '';

  if (plan.sceneId !== undefined && plan.newScene !== undefined) {
    error('sceneId', 'unknown-field', 'A plan targets one scene: either sceneId or newScene, not both.');
  } else if (plan.sceneId !== undefined) {
    const scene = ctx.project.scenes.find((s) => s.id === plan.sceneId);
    if (!scene) {
      error('sceneId', 'unknown-scene', `No scene '${plan.sceneId}' in this project.`);
    } else {
      sceneId = scene.id;
      sceneDuration = scene.duration;
      environmentId = scene.environmentId;
    }
  } else if (plan.newScene !== undefined) {
    createsScene = true;
    sceneDuration = plan.newScene.duration;
    environmentId = plan.newScene.environmentId;
    if (!Number.isFinite(sceneDuration) || sceneDuration <= 0) {
      error('newScene.duration', 'invalid-duration', `A scene needs a positive duration, not ${sceneDuration}.`);
    }
    if (!findEnvironment(ctx.assets, environmentId)) {
      error('newScene.environmentId', 'missing-environment', `No environment '${environmentId}' in the library.`);
    }
  } else {
    error('', 'unknown-field', 'A scene plan must carry either sceneId or newScene.');
  }

  const environment = environmentId ? findEnvironment(ctx.assets, environmentId) : undefined;

  /* --- cast --------------------------------------------------------- */

  const resolvedCast: ResolvedCastEntry[] = [];
  const seenCharacterIds = new Set<string>();

  (plan.cast ?? []).forEach((entry: CastEntry, index) => {
    const path = `cast[${index}]`;
    const character = findCharacter(ctx.assets, entry.characterId);

    if (!character) {
      error(`${path}.characterId`, 'missing-character', `No character '${entry.characterId}' in the library.`);
    } else {
      if (seenCharacterIds.has(character.id)) {
        warn(`${path}.characterId`, 'duplicate-id', `Character '${character.id}' is placed twice in this plan.`);
      }
      seenCharacterIds.add(character.id);
    }

    // With no character there is no default pose to resolve; an explicit pose is still checked.
    const poseId = entry.poseId ?? character?.defaultPoseId ?? '';
    const pose = character !== undefined || entry.poseId !== undefined
      ? findPose(ctx.assets, poseId)
      : undefined;
    if (pose === undefined && (character !== undefined || entry.poseId !== undefined)) {
      error(`${path}.poseId`, 'missing-pose', `No pose '${poseId}' in the library.`);
    } else if (pose && character) {
      const rigSlots = new Set(character.rig.map((part) => part.slot));
      const poseSlots = Object.keys(pose.slots);
      const overlap = poseSlots.filter((slot) => rigSlots.has(slot));
      if (overlap.length === 0 && poseSlots.length > 0) {
        warn(
          `${path}.poseId`,
          'pose-incompatible',
          `Pose '${poseId}' overrides no slot '${character.id}' actually has.`,
          'The actor will not visibly change when this pose is applied.',
        );
      } else if (poseSlots.some((slot) => !rigSlots.has(slot))) {
        info(
          `${path}.poseId`,
          'pose-incompatible',
          `Pose '${poseId}' overrides slots '${poseSlots.filter((s) => !rigSlots.has(s)).join(', ')}' that '${character.id}' does not have.`,
        );
      }
    }

    // As with the pose: no character means no default expression to resolve.
    const expressionId = entry.expressionId ?? character?.defaultExpressionId ?? '';
    if ((character !== undefined || entry.expressionId !== undefined)
      && !findExpression(ctx.assets, expressionId)) {
      error(`${path}.expressionId`, 'missing-expression', `No expression '${expressionId}' in the library.`);
    }

    if (entry.anchorId !== undefined && environment
      && !environment.anchors.some((anchor) => anchor.id === entry.anchorId)) {
      error(
        `${path}.anchorId`,
        'missing-anchor',
        `Environment '${environment.id}' has no anchor '${entry.anchorId}'.`,
      );
    } else if (entry.anchorId === undefined && entry.transform === undefined) {
      info(
        path,
        'missing-anchor',
        `No anchor or transform for '${entry.characterId}'; the actor will use default placement.`,
        'Name an anchorId of the scene environment, or a transform.',
      );
    }

    const expressionChanges = [...(entry.expressionChanges ?? [])]
      .map((change, changeIndex) => {
        const sceneResolved = createsScene || sceneId !== null;
        if (change.at < 0) {
          error(
            `${path}.expressionChanges[${changeIndex}].at`,
            'negative-value',
            `Expression changes cannot happen at a negative time (${change.at}).`,
          );
        } else if (sceneResolved && change.at > sceneDuration) {
          error(
            `${path}.expressionChanges[${changeIndex}].at`,
            'invalid-timing',
            `Expression change at ${change.at}s falls past the ${sceneDuration}s scene.`,
          );
        }
        if (!findExpression(ctx.assets, change.expressionId)) {
          error(
            `${path}.expressionChanges[${changeIndex}].expressionId`,
            'missing-expression',
            `No expression '${change.expressionId}' in the library.`,
          );
        }
        return change;
      })
      .sort((a, b) => a.at - b.at);

    resolvedCast.push({
      index,
      characterId: entry.characterId,
      displayName: entry.displayName ?? character?.name ?? entry.characterId,
      poseId,
      expressionId,
      anchorId: entry.anchorId ?? null,
      transform: entry.transform ?? null,
      z: entry.z ?? null,
      flipX: entry.flipX ?? false,
      expressionChanges,
    });
  });

  /* --- dialogue ----------------------------------------------------- */

  const planLines = plan.dialogue ?? [];
  const layout = layoutDialogue({
    lines: planLines,
    sceneDuration,
    mode: createsScene ? 'create' : 'modify',
    timing: plan.timing,
  });
  sceneDuration = layout.sceneDuration;

  if (layout.extended) {
    assumptions.push({
      path: 'newScene.duration',
      decision: `The scene lasts ${sceneDuration}s instead of the requested duration.`,
      reason: 'Dialogue cues would otherwise run past the end of the scene.',
    });
  }

  const sceneActors = sceneId
    ? (ctx.project.scenes.find((s) => s.id === sceneId)?.actors ?? [])
    : [];

  const resolvedLines: ResolvedLine[] = planLines.map((line, index) => {
    const path = `dialogue[${index}]`;

    let actor: ResolvedLine['actor'] = { source: 'none' };
    const castMatch = resolvedCast.find((entry) => entry.characterId === line.actorRef)
      ?? resolvedCast.find((entry) => entry.displayName === line.actorRef);
    if (castMatch) {
      actor = { source: 'cast', castIndex: castMatch.index };
    } else {
      const sceneMatch = sceneActors.find((a) => a.characterId === line.actorRef)
        ?? sceneActors.find((a) => a.displayName === line.actorRef);
      if (sceneMatch) {
        actor = { source: 'scene-actor', actorId: sceneMatch.id };
      } else {
        warn(
          `${path}.actorRef`,
          'unknown-actor-ref',
          `Nothing named '${line.actorRef}' is in this plan's cast or this scene.`,
          'Add the character to cast, or name an actor the scene already contains.',
        );
      }
    }

    if (actor.source === 'cast') {
      const entry = resolvedCast[actor.castIndex];
      if (entry && !findCharacter(ctx.assets, entry.characterId)) {
        error(
          `${path}.actorRef`,
          'missing-character',
          `No character '${entry.characterId}' in the library.`,
        );
      }
    }

    if (line.voiceId !== undefined && !findAudioDef(ctx.assets, line.voiceId)) {
      error(`${path}.voiceId`, 'missing-voice', `No audio asset '${line.voiceId}' in the library.`);
    }

    if (line.start !== undefined) {
      if (line.start < 0) {
        error(`${path}.start`, 'negative-value', `A cue cannot start at a negative time (${line.start}).`);
      } else if (!createsScene && sceneId && line.start >= sceneDuration) {
        error(
          `${path}.start`,
          'invalid-timing',
          `Cue starts at ${line.start}s, at or after the ${sceneDuration}s scene end.`,
        );
      }
    }
    if (line.duration !== undefined) {
      if (line.duration < 0) {
        error(`${path}.duration`, 'negative-value', `A cue duration cannot be negative (${line.duration}).`);
      } else if (!createsScene && sceneId && line.start !== undefined && line.start >= 0
        && line.start + line.duration > sceneDuration) {
        error(
          `${path}.duration`,
          'invalid-timing',
          `Cue would end at ${line.start + line.duration}s, past the ${sceneDuration}s scene end.`,
        );
      }
    }

    return {
      speaker: line.speaker,
      text: line.text,
      emotion: line.emotion,
      subtitle: line.subtitle ?? null,
      voiceAudioId: line.voiceId ?? null,
      actor,
      cue: layout.cues[index] ?? { start: 0, duration: 0, generated: true, truncated: false },
    };
  });

  for (const overlapIndex of layout.overlapIndices) {
    warn(
      `dialogue[${overlapIndex}]`,
      'invalid-timing',
      'This cue overlaps the cue before it.',
      'Give the cues a gap, or start this one after the previous one ends.',
    );
  }

  resolvedLines.forEach((line, index) => {
    if (line.cue.truncated) {
      warn(
        `dialogue[${index}]`,
        'invalid-timing',
        `Cue shortened to end at the scene end (${sceneDuration}s).`,
      );
      assumptions.push({
        path: `dialogue[${index}]`,
        decision: `The cue now runs ${line.cue.start}s to ${line.cue.start + line.cue.duration}s.`,
        reason: 'The scene is not resized, so cues are truncated rather than dropped.',
      });
    } else if (line.cue.generated) {
      assumptions.push({
        path: `dialogue[${index}]`,
        decision: `The cue runs ${line.cue.start}s to ${line.cue.start + line.cue.duration}s.`,
        reason: 'No explicit start and duration were given; the cue was laid out from its text length.',
      });
    }
  });

  /* --- camera ------------------------------------------------------- */

  let camera: ResolvedCamera | null = null;
  if (plan.camera !== undefined) {
    const cameraPath = 'camera';
    if (plan.camera.preset !== undefined && plan.camera.keyframes !== undefined) {
      error(`${cameraPath}.keyframes`, 'unknown-field', 'A camera is either a preset or keyframes, not both.');
    } else if (plan.camera.preset !== undefined) {
      const preset = resolveCameraPresets(ctx.project, ctx.series ?? null)
        .find((p) => p.id === plan.camera?.preset || p.name === plan.camera?.preset);
      if (!preset) {
        error(`${cameraPath}.preset`, 'unknown-preset', `No camera preset '${plan.camera.preset}'.`);
      } else {
        camera = { mode: 'preset', presetId: preset.id };
      }
    } else if (plan.camera.keyframes !== undefined) {
      const keyframes = plan.camera.keyframes
        .map((keyframe, index) => ({ keyframe, index }))
        .sort((a, b) => a.keyframe.at - b.keyframe.at || a.index - b.index);

      for (const { keyframe, index } of keyframes) {
        if (keyframe.at < 0) {
          error(
            `${cameraPath}.keyframes[${index}].at`,
            'negative-value',
            `Camera keyframes cannot sit at a negative time (${keyframe.at}).`,
          );
        } else if (keyframe.at > sceneDuration) {
          error(
            `${cameraPath}.keyframes[${index}].at`,
            'invalid-timing',
            `Camera keyframe at ${keyframe.at}s falls past the ${sceneDuration}s scene.`,
          );
        }
        if (keyframe.zoom !== undefined && keyframe.zoom <= 0) {
          error(
            `${cameraPath}.keyframes[${index}].zoom`,
            'out-of-range',
            `Zoom must be positive, not ${keyframe.zoom}.`,
          );
        } else if (keyframe.zoom !== undefined && keyframe.zoom > 10) {
          warn(
            `${cameraPath}.keyframes[${index}].zoom`,
            'out-of-range',
            `Zoom ${keyframe.zoom} is beyond the tested range (0, 10].`,
          );
        }
      }

      const first = keyframes[0]?.keyframe;
      if (first) {
        if (first.at > 0) {
          assumptions.push({
            path: `${cameraPath}.keyframes[0]`,
            decision: `The scene rests at x ${first.x ?? 0}, y ${first.y ?? 0}, zoom ${first.zoom ?? 1} until ${first.at}s.`,
            reason: 'The first camera keyframe is not at 0, so the framing before it was assumed from that keyframe.',
          });
        }
        camera = {
          mode: 'move',
          keyframes: keyframes.map(({ keyframe }) => ({
            time: keyframe.at,
            props: {
              ...(keyframe.x !== undefined ? { x: keyframe.x } : {}),
              ...(keyframe.y !== undefined ? { y: keyframe.y } : {}),
              ...(keyframe.zoom !== undefined ? { scaleX: keyframe.zoom } : {}),
              ...(keyframe.rotation !== undefined ? { rotation: keyframe.rotation } : {}),
            },
            ease: keyframe.ease ?? 'linear',
          })),
          rest: {
            ...(first.x !== undefined ? { x: first.x } : {}),
            ...(first.y !== undefined ? { y: first.y } : {}),
            ...(first.zoom !== undefined ? { zoom: first.zoom } : {}),
            ...(first.rotation !== undefined ? { rotation: first.rotation } : {}),
          },
          clipStart: 0,
          clipDuration: sceneDuration,
        };
      }
    }
  }

  /* --- animation (RULE 9: accepted, not yet compiled) --------------- */
  // A PlannedAnimation is existence-checked only once an `AnimationAsset` kind exists.

  /* --- assemble ------------------------------------------------------ */

  if (createsScene && plan.newScene?.backgroundColor === undefined) {
    assumptions.push({
      path: 'newScene.backgroundColor',
      decision: 'The scene keeps the default background colour.',
      reason: 'The plan did not name one.',
    });
  }

  const resolved: ResolvedPlanReferences = {
    sceneId,
    createsScene,
    sceneDuration,
    environmentId,
    backgroundColor: plan.newScene?.backgroundColor ?? null,
    cast: resolvedCast,
    lines: resolvedLines,
    camera,
    assumptions,
  };

  const ok = !diagnostics.some((d) => d.severity === 'error');
  return { ok, diagnostics, resolved };
}
