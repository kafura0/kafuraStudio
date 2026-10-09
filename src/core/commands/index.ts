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
import './createEpisode';
import './deleteScene';
import './addSceneToEpisode';
import './setSceneCamera';
import './applyCameraPreset';
import './clearCameraMoves';
import './frameSelection';
import "./addClip";
import "./moveClip";
import "./trimClip";
import "./moveClipToTrack";
import "./removeClip";
import "./addKeyframe";
import "./moveKeyframe";
import "./removeKeyframe";
import "./moveTrack";
import "./removeTrack";
import "./updateTrack";

export * from './errors';
export * from './registry';
export * from './types';