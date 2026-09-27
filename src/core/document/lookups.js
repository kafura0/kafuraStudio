/**
 * Read-only lookups over the project.
 *
 * These run in the render hot path, so they are written as plain scans over small
 * arrays rather than building indexes. An MVP project holds tens of scenes and
 * hundreds of assets; a Map index would cost more to maintain than it saves.
 */
export function findScene(project, sceneId) {
    return project.scenes.find((s) => s.id === sceneId);
}
export function requireScene(project, sceneId) {
    const scene = findScene(project, sceneId);
    if (!scene)
        throw new Error(`Scene not found: ${sceneId}`);
    return scene;
}
export function findActor(scene, actorId) {
    return scene.actors.find((a) => a.id === actorId);
}
export function requireActor(scene, actorId) {
    const actor = findActor(scene, actorId);
    if (!actor)
        throw new Error(`Actor not found in scene ${scene.id}: ${actorId}`);
    return actor;
}
export function findSceneProp(scene, propId) {
    return scene.props.find((p) => p.id === propId);
}
export function findCharacter(project, id) {
    return project.assets.characters.find((c) => c.id === id);
}
export function findEnvironment(project, id) {
    return project.assets.environments.find((e) => e.id === id);
}
export function findPose(project, id) {
    return project.assets.poses.find((p) => p.id === id);
}
export function findExpression(project, id) {
    return project.assets.expressions.find((e) => e.id === id);
}
export function findPropDef(project, id) {
    return project.assets.props.find((p) => p.id === id);
}
export function findAudioDef(project, id) {
    return project.assets.audio.find((a) => a.id === id);
}
export function findDialogueLine(scene, id) {
    return scene.dialogue.find((d) => d.id === id);
}
export function findTrack(scene, id) {
    return scene.tracks.find((t) => t.id === id);
}
export function requireTrack(scene, id) {
    const track = findTrack(scene, id);
    if (!track)
        throw new Error(`Track not found in scene ${scene.id}: ${id}`);
    return track;
}
export function requireClip(track, clipId) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (!clip)
        throw new Error(`Clip not found on track ${track.id}: ${clipId}`);
    return clip;
}
export function findEpisode(project, id) {
    return project.episodes.find((e) => e.id === id);
}
export function requireEpisode(project, id) {
    const episode = findEpisode(project, id);
    if (!episode)
        throw new Error(`Episode not found: ${id}`);
    return episode;
}
/** All clips on a scene, paired with the track that owns them. */
export function allClips(scene) {
    const out = [];
    for (const track of scene.tracks) {
        for (const clip of track.clips)
            out.push({ track, clip });
    }
    return out;
}
/** Clips whose [start, start + duration) window contains `time`. */
export function activeClips(scene, time, kind) {
    return allClips(scene).filter(({ track, clip }) => (kind === undefined || track.kind === kind) &&
        !track.muted &&
        time >= clip.start &&
        time < clip.start + clip.duration);
}
/** Clips matching a specific target (an actor, prop, camera, or dialogue line). */
export function clipsForTarget(scene, kind, targetId) {
    const out = [];
    for (const track of scene.tracks) {
        if (track.kind !== kind || track.targetId !== targetId)
            continue;
        for (const clip of track.clips)
            out.push(clip);
    }
    return out;
}
/** The environment backing a scene, or undefined if the reference is dangling. */
export function sceneEnvironment(project, scene) {
    return findEnvironment(project, scene.environmentId);
}
export function scenesOfEpisode(project, episodeId) {
    const episode = findEpisode(project, episodeId);
    if (!episode)
        return [];
    const out = [];
    for (const id of episode.sceneIds) {
        const scene = findScene(project, id);
        if (scene)
            out.push(scene);
    }
    return out;
}
