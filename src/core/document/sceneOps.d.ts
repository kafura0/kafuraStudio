/**
 * Scene composition: actors, props and staging-anchor binding.
 *
 * A SceneActor holds ids and a placement transform — never a character definition.
 * That is what makes asset reuse structural rather than a matter of discipline.
 */
import type { CharacterDef, ExpressionDef, Id, PoseDef, Project, Scene, SceneActor, StagingAnchor, Transform2D } from '../types';
export declare function addActorToScene(project: Project, sceneId: Id, actor: SceneActor, zIndex?: number): Project;
/** Create and place a character, defaulting pose/expression from the definition. */
export declare function placeCharacter(project: Project, sceneId: Id, character: CharacterDef, placement?: Partial<Transform2D> & {
    poseId?: string;
    expressionId?: string;
}): {
    project: Project;
    actorId: Id;
};
export declare function removeActorFromScene(project: Project, sceneId: Id, actorId: Id): Project;
export declare function updateActor(project: Project, sceneId: Id, actorId: Id, patch: Partial<Omit<SceneActor, 'id'>>): Project;
export declare function setActorTransform(project: Project, sceneId: Id, actorId: Id, patch: Partial<Transform2D>): Project;
export declare function setActorPose(project: Project, sceneId: Id, actorId: Id, poseId: Id): Project;
export declare function setActorExpression(project: Project, sceneId: Id, actorId: Id, expressionId: Id): Project;
export declare function setActorFlip(project: Project, sceneId: Id, actorId: Id, flipX: boolean): Project;
/** Change an actor's pose AND expression in one undoable step. */
export declare function setActorState(project: Project, sceneId: Id, actorId: Id, state: {
    pose?: PoseDef;
    expression?: ExpressionDef;
}): Project;
/** Reorder an actor within the depth sort. */
export declare function setActorZ(project: Project, sceneId: Id, actorId: Id, z: number): Project;
/** Bring an actor in front of every other actor. */
export declare function bringActorToFront(project: Project, sceneId: Id, actorId: Id): Project;
/**
 * Bind an actor to a staging anchor.
 *
 * Binding *replaces* the actor's free transform with the anchor's placement. That
 * is the point: staging becomes repeatable, and moving an anchor in the environment
 * re-stages every scene bound to it.
 */
export declare function bindActorToAnchor(project: Project, sceneId: Id, actorId: Id, anchorId: Id): Project;
/** Unbind, keeping the current placement so the actor stays where it appears. */
export declare function unbindActorFromAnchor(project: Project, sceneId: Id, actorId: Id): Project;
/** Move a staging anchor on the environment definition. Every bound scene follows. */
export declare function updateAnchor(project: Project, environmentId: Id, anchorId: Id, patch: Partial<Omit<StagingAnchor, 'id'>>): Project;
export declare function environmentAnchors(project: Project, scene: Scene): StagingAnchor[];
export declare function addPropToScene(project: Project, sceneId: Id, propDefId: Id, placement?: Partial<Transform2D> & {
    z?: number;
    flipX?: boolean;
}): {
    project: Project;
    propId: Id;
};
export declare function removePropFromScene(project: Project, sceneId: Id, propInstanceId: Id): Project;
export declare function updateSceneProp(project: Project, sceneId: Id, propInstanceId: Id, patch: Partial<Omit<Scene['props'][number], 'id' | 'propId'>>): Project;
export declare function setPropTransform(project: Project, sceneId: Id, propInstanceId: Id, patch: Partial<Transform2D>): Project;
