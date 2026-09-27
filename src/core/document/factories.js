/**
 * Constructors for every persisted shape.
 *
 * Every document mutation in the app starts here, which is what guarantees that a
 * newly created node has every field populated and a unique id.
 */
import { createId, ID_PREFIX } from '../id';
import { DEFAULT_SCENE_DURATION, STAGE_FPS, STAGE_HEIGHT, STAGE_WIDTH } from '../constants';
import { transform } from '../types';
export function emptyAssetLibrary() {
    return {
        characters: [],
        environments: [],
        poses: [],
        expressions: [],
        props: [],
        audio: [],
    };
}
export function defaultProjectSettings() {
    return {
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        fps: STAGE_FPS,
        autosave: true,
    };
}
export function defaultRenderSettings() {
    return {
        width: STAGE_WIDTH,
        height: STAGE_HEIGHT,
        fps: STAGE_FPS,
        format: 'webm',
    };
}
export function defaultCamera(environment) {
    if (environment) {
        return {
            x: environment.width / 2,
            y: environment.height / 2,
            zoom: 1,
            rotation: 0,
        };
    }
    return { x: STAGE_WIDTH / 2, y: STAGE_HEIGHT / 2, zoom: 1, rotation: 0 };
}
export function createProject(name, description = '') {
    const now = new Date().toISOString();
    return {
        id: createId(ID_PREFIX.project),
        name,
        description,
        createdAt: now,
        updatedAt: now,
        formatVersion: 1,
        settings: defaultProjectSettings(),
        assets: emptyAssetLibrary(),
        episodes: [],
        scenes: [],
    };
}
export function createEpisode(title, description = '') {
    return {
        id: createId(ID_PREFIX.episode),
        title,
        description,
        sceneIds: [],
        renderSettings: defaultRenderSettings(),
        metadata: {},
    };
}
export function createScene(name, environmentId, options = {}) {
    return {
        id: createId(ID_PREFIX.scene),
        name,
        description: options.description ?? '',
        environmentId,
        actors: [],
        props: [],
        dialogue: [],
        tracks: [],
        camera: options.camera ?? { x: 0, y: 0, zoom: 1, rotation: 0 },
        duration: options.duration ?? DEFAULT_SCENE_DURATION,
        backgroundColor: '#0b0d12',
        metadata: {},
    };
}
export function createAnchor(name, x, y, options = {}) {
    return {
        id: createId(ID_PREFIX.anchor),
        name,
        x,
        y,
        scale: options.scale ?? 1,
        rotation: options.rotation ?? 0,
        flipX: options.flipX ?? false,
        facing: options.facing ?? 'right',
        kind: options.kind ?? 'stand',
        tags: options.tags ?? [],
    };
}
export function createActor(characterId, displayName, poseId, expressionId, transformOverrides = {}) {
    return {
        id: createId(ID_PREFIX.actor),
        characterId,
        poseId,
        expressionId,
        displayName,
        transform: transform(transformOverrides),
        flipX: false,
        z: 0,
        visible: true,
        anchorId: null,
    };
}
export function createSceneProp(propId, transformOverrides = {}) {
    return {
        id: createId(ID_PREFIX.propInstance),
        propId,
        transform: transform(transformOverrides),
        flipX: false,
        z: 0,
        visible: true,
    };
}
export function createTrack(kind, targetId, name, color) {
    return {
        id: createId(ID_PREFIX.track),
        kind,
        targetId,
        name,
        muted: false,
        locked: false,
        color,
        clips: [],
    };
}
export function createClip(start, duration, extras = {}) {
    return {
        id: createId(ID_PREFIX.clip),
        start,
        duration,
        keyframes: [],
        audioId: extras.audioId ?? null,
        dialogueLineId: extras.dialogueLineId ?? null,
        gain: extras.gain ?? 1,
    };
}
export function createKeyframe(time, props, ease = 'linear') {
    return {
        id: createId(ID_PREFIX.keyframe),
        time,
        ease,
        props,
    };
}
export function createDialogueLine(speaker, text, actorId = null) {
    return {
        id: createId(ID_PREFIX.dialogue),
        speaker,
        actorId,
        text,
        emotion: 'neutral',
        voiceAudioId: null,
        subtitle: null,
    };
}
