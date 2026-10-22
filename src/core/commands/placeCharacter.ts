/**
 * PlaceCharacter — stage a character in a scene (ARCHITECTURE_SPEC.md §7.2, §11.6, Phase 17).
 *
 * The plan compiler's staging command. It composes three document operations so a plan's
 * cast entry becomes one command rather than three: `placeCharacter` mints the actor,
 * `bindActorToAnchor` seats it when the entry named an anchor, and `updateActor` applies
 * the fields `placeCharacter` does not carry (z, flipX, displayName override).
 *
 * `bindActorToAnchor` *throws* on an unknown anchor, so the handler resolves it first and
 * returns a `not-found` error instead — a plan must fail as a diagnostic, never as a
 * thrown exception (§9.6's spirit, R2).
 *
 * `actorRef` is a plan-compilation handle (§11.5 correction): never set by the UI,
 * bound by `applyPlan` to the actor id this command creates.
 */
import { ID_PREFIX } from '../id';
import type { Id, Provenance, Transform2D } from '../types';
import { findCharacter, findEnvironment } from '../document/lookups';
import { bindActorToAnchor, placeCharacter, updateActor } from '../document/sceneOps';
import type { Command, CommandContext } from './types';
import { commandError, notFound } from './errors';
import { defineCommand } from './registry';

export interface PlaceCharacterCommand extends Command {
  kind: 'PlaceCharacter';
  sceneId: Id;
  characterId: Id;
  displayName?: string;
  poseId?: Id;
  expressionId?: Id;
  anchorId?: Id;
  transform?: Partial<Transform2D>;
  z?: number;
  flipX?: boolean;
  /** Plan-compilation handle for the actor this command creates. */
  actorRef?: string;
  /** Stamped by `applyPlan` from the envelope's provenance (A§9.4, Phase 19). */
  provenance?: Provenance;
}

defineCommand<PlaceCharacterCommand>('PlaceCharacter', (command, ctx: CommandContext) => {
  const library = ctx.assets ?? ctx.project.assets;
  const scene = ctx.project.scenes.find((s) => s.id === command.sceneId);
  if (!scene) return { ok: false, error: notFound('scene', command.sceneId) };

  const character = findCharacter(library, command.characterId);
  if (!character) return { ok: false, error: notFound('character', command.characterId) };

  if (command.anchorId !== undefined) {
    const environment = findEnvironment(library, scene.environmentId);
    if (!environment?.anchors.some((anchor) => anchor.id === command.anchorId)) {
      return { ok: false, error: notFound('anchor', command.anchorId) };
    }
  }
  if (command.z !== undefined && !Number.isFinite(command.z)) {
    return { ok: false, error: commandError('invalid-argument', 'An actor z must be a finite number.') };
  }

  const placed = placeCharacter(
    ctx.project,
    command.sceneId,
    character,
    {
      ...(command.transform !== undefined ? command.transform : {}),
      ...(command.poseId !== undefined ? { poseId: command.poseId } : {}),
      ...(command.expressionId !== undefined ? { expressionId: command.expressionId } : {}),
    },
    {
      id: ctx.allocate(ID_PREFIX.actor),
      clock: ctx.now,
      ...(command.provenance !== undefined ? { provenance: command.provenance } : {}),
    },
  );
  let project = placed.project;

  if (command.anchorId !== undefined) {
    project = bindActorToAnchor(project, library, command.sceneId, placed.actorId, command.anchorId, ctx.now);
  }

  const patch: { z?: number; flipX?: boolean; displayName?: string } = {};
  if (command.z !== undefined) patch.z = command.z;
  if (command.flipX !== undefined) patch.flipX = command.flipX;
  if (command.displayName !== undefined) patch.displayName = command.displayName;
  if (Object.keys(patch).length > 0) {
    project = updateActor(project, command.sceneId, placed.actorId, patch, ctx.now);
  }

  return { ok: true, project };
});
