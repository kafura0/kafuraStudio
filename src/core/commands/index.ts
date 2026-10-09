/**
 * Command layer entry point (ARCHITECTURE_SPEC.md §7, Phase 16).
 *
 * Importing this module registers every command kind as a side effect, so each command
 * module below must appear as a bare import. Import the command layer through this path,
 * never through `./registry` directly — the registry alone holds no kinds.
 */
import './createScene';
import './setActorPose';
import './addDialogueLine';
import './setDialogueLine';
import './deleteDialogueLine';
import './setDialogueCue';
import './setDialogueVoice';
import './setClipGain';

export * from './errors';
export * from './registry';
export * from './types';