/**
 * Scene composition: actors, props and staging-anchor binding.
 *
 * A SceneActor holds ids and a placement transform — never a character definition.
 * That is what makes asset reuse structural rather than a matter of discipline.
 */

import type {
  CharacterDef,
  EnvironmentDef,
  ExpressionDef,
  Id,
  PoseDef,
  Project,
  Scene,
  SceneActor,
  StagingAnchor,
  Transform2D,
} from '../types';
import { transform } from '../types';
import { createActor, createSceneProp } from './factories';
import { findEnvironment, requireScene } from './lookups';
import { mapScene } from './projectOps';

/* ------------------------------------------------------------------ */
/* Actors                                                              */
/* ------------------------------------------------------------------ */

export function addActorToScene(
  project: Project,
  sceneId: Id,
  actor: SceneActor,
  zIndex?: number,
): Project {
  return mapScene(project, sceneId, (scene) => {
    const z = zIndex ?? scene.actors.length;
    // Stable z ordering: append after everything currently placed.
    return { ...scene, actors: [...scene.actors, { ...actor, z }] };
  });
}

/** Create and place a character, defaulting pose/expression from the definition. */
export function placeCharacter(
  project: Project,
  sceneId: Id,
  character: CharacterDef,
  placement: Partial<Transform2D> & { poseId?: string; expressionId?: string } = {},
): { project: Project; actorId: Id } {
  const actor = createActor(
    character.id,
    character.name,
    placement.poseId ?? character.defaultPoseId,
    placement.expressionId ?? character.defaultExpressionId,
    placement,
  );
  const next = addActorToScene(project, sceneId, actor);
  return { project: next, actorId: actor.id };
}

export function removeActorFromScene(project: Project, sceneId: Id, actorId: Id): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    actors: scene.actors.filter((a) => a.id !== actorId),
    // Dialogue pointed at this actor loses its link rather than dangling.
    dialogue: scene.dialogue.map((line) =>
      line.actorId === actorId ? { ...line, actorId: null } : line,
    ),
    // Actor animation tracks go with it.
    tracks: scene.tracks.filter((t) => !(t.kind === 'actor' && t.targetId === actorId)),
  }));
}

export function updateActor(
  project: Project,
  sceneId: Id,
  actorId: Id,
  patch: Partial<Omit<SceneActor, 'id'>>,
): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    actors: scene.actors.map((a) => (a.id === actorId ? { ...a, ...patch } : a)),
  }));
}

export function setActorTransform(
  project: Project,
  sceneId: Id,
  actorId: Id,
  patch: Partial<Transform2D>,
): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    actors: scene.actors.map((actor) =>
      actor.id === actorId
        ? { ...actor, transform: { ...actor.transform, ...patch } }
        : actor,
    ),
  }));
}

export function setActorPose(project: Project, sceneId: Id, actorId: Id, poseId: Id): Project {
  return updateActor(project, sceneId, actorId, { poseId });
}

export function setActorExpression(
  project: Project,
  sceneId: Id,
  actorId: Id,
  expressionId: Id,
): Project {
  return updateActor(project, sceneId, actorId, { expressionId });
}

export function setActorFlip(project: Project, sceneId: Id, actorId: Id, flipX: boolean): Project {
  return updateActor(project, sceneId, actorId, { flipX });
}

/** Change an actor's pose AND expression in one undoable step. */
export function setActorState(
  project: Project,
  sceneId: Id,
  actorId: Id,
  state: { pose?: PoseDef; expression?: ExpressionDef },
): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    actors: scene.actors.map((actor) =>
      actor.id === actorId
        ? {
            ...actor,
            poseId: state.pose?.id ?? actor.poseId,
            expressionId: state.expression?.id ?? actor.expressionId,
          }
        : actor,
    ),
  }));
}

/** Reorder an actor within the depth sort. */
export function setActorZ(project: Project, sceneId: Id, actorId: Id, z: number): Project {
  return updateActor(project, sceneId, actorId, { z });
}

/** Bring an actor in front of every other actor. */
export function bringActorToFront(project: Project, sceneId: Id, actorId: Id): Project {
  return mapScene(project, sceneId, (scene) => {
    const maxZ = scene.actors.reduce((max, a) => Math.max(max, a.z), -1);
    return {
      ...scene,
      actors: scene.actors.map((a) => (a.id === actorId ? { ...a, z: maxZ + 1 } : a)),
    };
  });
}

/* ------------------------------------------------------------------ */
/* Staging anchors                                                     */
/* ------------------------------------------------------------------ */

/**
 * Bind an actor to a staging anchor.
 *
 * Binding *replaces* the actor's free transform with the anchor's placement. That
 * is the point: staging becomes repeatable, and moving an anchor in the environment
 * re-stages every scene bound to it.
 */
export function bindActorToAnchor(
  project: Project,
  sceneId: Id,
  actorId: Id,
  anchorId: Id,
): Project {
  const scene = requireScene(project, sceneId);
  const environment = findEnvironment(project, scene.environmentId);
  const anchor = environment?.anchors.find((a) => a.id === anchorId);
  if (!anchor) throw new Error(`Anchor not found in environment: ${anchorId}`);

  return mapScene(project, sceneId, (current) => ({
    ...current,
    actors: current.actors.map((actor) =>
      actor.id === actorId
        ? {
            ...actor,
            anchorId,
            flipX: anchor.flipX,
            transform: transform({
              x: anchor.x,
              y: anchor.y,
              rotation: anchor.rotation,
              scaleX: anchor.scale,
              scaleY: anchor.scale,
            }),
          }
        : actor,
    ),
  }));
}

/** Unbind, keeping the current placement so the actor stays where it appears. */
export function unbindActorFromAnchor(project: Project, sceneId: Id, actorId: Id): Project {
  return updateActor(project, sceneId, actorId, { anchorId: null });
}

/** Move a staging anchor on the environment definition. Every bound scene follows. */
export function updateAnchor(
  project: Project,
  environmentId: Id,
  anchorId: Id,
  patch: Partial<Omit<StagingAnchor, 'id'>>,
): Project {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
    assets: {
      ...project.assets,
      environments: project.assets.environments.map((env) =>
        env.id === environmentId
          ? {
              ...env,
              anchors: env.anchors.map((a) => (a.id === anchorId ? { ...a, ...patch } : a)),
            }
          : env,
      ),
    },
  };
}

export function environmentAnchors(project: Project, scene: Scene): StagingAnchor[] {
  const environment: EnvironmentDef | undefined = findEnvironment(project, scene.environmentId);
  return environment?.anchors ?? [];
}

/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */

export function addPropToScene(
  project: Project,
  sceneId: Id,
  propDefId: Id,
  placement: Partial<Transform2D> & { z?: number; flipX?: boolean } = {},
): { project: Project; propId: Id } {
  const prop = createSceneProp(propDefId, placement);
  const z = placement.z ?? 0;
  const next = mapScene(project, sceneId, (scene) => ({
    ...scene,
    props: [...scene.props, { ...prop, z, flipX: placement.flipX ?? prop.flipX }],
  }));
  return { project: next, propId: prop.id };
}

export function removePropFromScene(project: Project, sceneId: Id, propInstanceId: Id): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    props: scene.props.filter((p) => p.id !== propInstanceId),
    tracks: scene.tracks.filter((t) => !(t.kind === 'prop' && t.targetId === propInstanceId)),
  }));
}

export function updateSceneProp(
  project: Project,
  sceneId: Id,
  propInstanceId: Id,
  patch: Partial<Omit<Scene['props'][number], 'id' | 'propId'>>,
): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    props: scene.props.map((p) => (p.id === propInstanceId ? { ...p, ...patch } : p)),
  }));
}

export function setPropTransform(
  project: Project,
  sceneId: Id,
  propInstanceId: Id,
  patch: Partial<Transform2D>,
): Project {
  return mapScene(project, sceneId, (scene) => ({
    ...scene,
    props: scene.props.map((prop) =>
      prop.id === propInstanceId ? { ...prop, transform: { ...prop.transform, ...patch } } : prop,
    ),
  }));
}
