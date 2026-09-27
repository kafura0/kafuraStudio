/**
 * Scene composition: actors, props and staging-anchor binding.
 *
 * A SceneActor holds ids and a placement transform — never a character definition.
 * That is what makes asset reuse structural rather than a matter of discipline.
 */
import { transform } from '../types';
import { createActor, createSceneProp } from './factories';
import { findEnvironment, requireScene } from './lookups';
import { mapScene } from './projectOps';
/* ------------------------------------------------------------------ */
/* Actors                                                              */
/* ------------------------------------------------------------------ */
export function addActorToScene(project, sceneId, actor, zIndex) {
    return mapScene(project, sceneId, (scene) => {
        const z = zIndex ?? scene.actors.length;
        // Stable z ordering: append after everything currently placed.
        return { ...scene, actors: [...scene.actors, { ...actor, z }] };
    });
}
/** Create and place a character, defaulting pose/expression from the definition. */
export function placeCharacter(project, sceneId, character, placement = {}) {
    const actor = createActor(character.id, character.name, placement.poseId ?? character.defaultPoseId, placement.expressionId ?? character.defaultExpressionId, placement);
    const next = addActorToScene(project, sceneId, actor);
    return { project: next, actorId: actor.id };
}
export function removeActorFromScene(project, sceneId, actorId) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        actors: scene.actors.filter((a) => a.id !== actorId),
        // Dialogue pointed at this actor loses its link rather than dangling.
        dialogue: scene.dialogue.map((line) => line.actorId === actorId ? { ...line, actorId: null } : line),
        // Actor animation tracks go with it.
        tracks: scene.tracks.filter((t) => !(t.kind === 'actor' && t.targetId === actorId)),
    }));
}
export function updateActor(project, sceneId, actorId, patch) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        actors: scene.actors.map((a) => (a.id === actorId ? { ...a, ...patch } : a)),
    }));
}
export function setActorTransform(project, sceneId, actorId, patch) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        actors: scene.actors.map((actor) => actor.id === actorId
            ? { ...actor, transform: { ...actor.transform, ...patch } }
            : actor),
    }));
}
export function setActorPose(project, sceneId, actorId, poseId) {
    return updateActor(project, sceneId, actorId, { poseId });
}
export function setActorExpression(project, sceneId, actorId, expressionId) {
    return updateActor(project, sceneId, actorId, { expressionId });
}
export function setActorFlip(project, sceneId, actorId, flipX) {
    return updateActor(project, sceneId, actorId, { flipX });
}
/** Change an actor's pose AND expression in one undoable step. */
export function setActorState(project, sceneId, actorId, state) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        actors: scene.actors.map((actor) => actor.id === actorId
            ? {
                ...actor,
                poseId: state.pose?.id ?? actor.poseId,
                expressionId: state.expression?.id ?? actor.expressionId,
            }
            : actor),
    }));
}
/** Reorder an actor within the depth sort. */
export function setActorZ(project, sceneId, actorId, z) {
    return updateActor(project, sceneId, actorId, { z });
}
/** Bring an actor in front of every other actor. */
export function bringActorToFront(project, sceneId, actorId) {
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
export function bindActorToAnchor(project, sceneId, actorId, anchorId) {
    const scene = requireScene(project, sceneId);
    const environment = findEnvironment(project, scene.environmentId);
    const anchor = environment?.anchors.find((a) => a.id === anchorId);
    if (!anchor)
        throw new Error(`Anchor not found in environment: ${anchorId}`);
    return mapScene(project, sceneId, (current) => ({
        ...current,
        actors: current.actors.map((actor) => actor.id === actorId
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
            : actor),
    }));
}
/** Unbind, keeping the current placement so the actor stays where it appears. */
export function unbindActorFromAnchor(project, sceneId, actorId) {
    return updateActor(project, sceneId, actorId, { anchorId: null });
}
/** Move a staging anchor on the environment definition. Every bound scene follows. */
export function updateAnchor(project, environmentId, anchorId, patch) {
    return {
        ...project,
        updatedAt: new Date().toISOString(),
        assets: {
            ...project.assets,
            environments: project.assets.environments.map((env) => env.id === environmentId
                ? {
                    ...env,
                    anchors: env.anchors.map((a) => (a.id === anchorId ? { ...a, ...patch } : a)),
                }
                : env),
        },
    };
}
export function environmentAnchors(project, scene) {
    const environment = findEnvironment(project, scene.environmentId);
    return environment?.anchors ?? [];
}
/* ------------------------------------------------------------------ */
/* Props                                                               */
/* ------------------------------------------------------------------ */
export function addPropToScene(project, sceneId, propDefId, placement = {}) {
    const prop = createSceneProp(propDefId, placement);
    const z = placement.z ?? 0;
    const next = mapScene(project, sceneId, (scene) => ({
        ...scene,
        props: [...scene.props, { ...prop, z, flipX: placement.flipX ?? prop.flipX }],
    }));
    return { project: next, propId: prop.id };
}
export function removePropFromScene(project, sceneId, propInstanceId) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        props: scene.props.filter((p) => p.id !== propInstanceId),
        tracks: scene.tracks.filter((t) => !(t.kind === 'prop' && t.targetId === propInstanceId)),
    }));
}
export function updateSceneProp(project, sceneId, propInstanceId, patch) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        props: scene.props.map((p) => (p.id === propInstanceId ? { ...p, ...patch } : p)),
    }));
}
export function setPropTransform(project, sceneId, propInstanceId, patch) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        props: scene.props.map((prop) => prop.id === propInstanceId ? { ...prop, transform: { ...prop.transform, ...patch } } : prop),
    }));
}
