/**
 * Timeline operations: tracks, clips, keyframes.
 *
 * Tracks, clips and keyframes use one uniform model for actors, props, camera,
 * dialogue and audio. That uniformity is why the timeline UI is written once.
 */
import { SNAP_THRESHOLD_SECONDS, quantizeToFrame } from '../constants';
import { createClip, createKeyframe, createTrack } from './factories';
import { mapScene } from './projectOps';
/** Default track label colours, keyed by kind. */
export const TRACK_COLORS = {
    actor: '#5b8cff',
    prop: '#7c6cff',
    camera: '#f0a13a',
    dialogue: '#38c793',
    audio: '#9aa4b8',
};
export function findOrCreateTrack(scene, kind, targetId, name) {
    const existing = scene.tracks.find((t) => t.kind === kind && t.targetId === targetId);
    if (existing)
        return { scene, track: existing, created: false };
    const track = createTrack(kind, targetId, name, TRACK_COLORS[kind]);
    return { scene: { ...scene, tracks: [...scene.tracks, track] }, track, created: true };
}
export function addTrack(project, sceneId, kind, targetId, name) {
    return mapScene(project, sceneId, (scene) => findOrCreateTrack(scene, kind, targetId, name).scene);
}
export function updateTrack(project, sceneId, trackId, patch) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        tracks: scene.tracks.map((t) => (t.id === trackId ? { ...t, ...patch } : t)),
    }));
}
export function removeTrack(project, sceneId, trackId) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        tracks: scene.tracks.filter((t) => t.id !== trackId),
    }));
}
/* ------------------------------------------------------------------ */
/* Clips                                                               */
/* ------------------------------------------------------------------ */
function mapClip(project, sceneId, trackId, clipId, fn) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        tracks: scene.tracks.map((track) => track.id !== trackId
            ? track
            : { ...track, clips: track.clips.map((clip) => (clip.id === clipId ? fn(clip) : clip)) }),
    }));
}
export function addClip(project, sceneId, trackId, clip) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        tracks: scene.tracks.map((track) => track.id === trackId ? { ...track, clips: sortClips([...track.clips, clip]) } : track),
    }));
}
export function addSimpleClip(project, sceneId, kind, targetId, name, start, duration, extras = {}) {
    return mapScene(project, sceneId, (scene) => {
        const { scene: withTrack, track } = findOrCreateTrack(scene, kind, targetId, name);
        const clip = createClip(start, duration, extras);
        return {
            ...withTrack,
            tracks: withTrack.tracks.map((t) => t.id === track.id ? { ...t, clips: sortClips([...t.clips, clip]) } : t),
        };
    });
}
export function removeClip(project, sceneId, trackId, clipId) {
    return mapScene(project, sceneId, (scene) => ({
        ...scene,
        tracks: scene.tracks.map((track) => track.id === trackId ? { ...track, clips: track.clips.filter((c) => c.id !== clipId) } : track),
    }));
}
/** Move a clip in time, keeping its duration. Snaps to nearby clip edges. */
export function moveClip(project, sceneId, trackId, clipId, start, options = {}) {
    return mapScene(project, sceneId, (scene) => {
        const track = scene.tracks.find((t) => t.id === trackId);
        if (!track)
            return scene;
        const clip = track.clips.find((c) => c.id === clipId);
        if (!clip)
            return scene;
        const others = scene.tracks
            .filter((t) => t.kind === track.kind)
            .flatMap((t) => t.clips)
            .filter((c) => c.id !== clipId);
        const edges = [0];
        for (const other of others) {
            edges.push(other.start, other.start + other.duration);
        }
        const end = clip.start + clip.duration;
        edges.push(end);
        const resolved = options.snap === false ? start : snapToEdges(start, edges, end - clip.start);
        const clamped = Math.max(0, resolved);
        return {
            ...scene,
            tracks: scene.tracks.map((t) => t.id === trackId
                ? {
                    ...t,
                    clips: sortClips(t.clips.map((c) => (c.id === clipId ? { ...c, start: clamped } : c))),
                }
                : t),
        };
    });
}
/** Trim a clip from either edge. At least `MIN_CLIP_DURATION` must remain. */
export const MIN_CLIP_DURATION = 1 / 60;
export function trimClip(project, sceneId, trackId, clipId, edge, time) {
    return mapClip(project, sceneId, trackId, clipId, (clip) => {
        if (edge === 'start') {
            const end = clip.start + clip.duration;
            const nextStart = Math.min(Math.max(0, time), end - MIN_CLIP_DURATION);
            const shift = nextStart - clip.start;
            return {
                ...clip,
                start: nextStart,
                duration: clip.duration - shift,
                keyframes: clip.keyframes.map((kf) => ({ ...kf, time: kf.time + shift })),
            };
        }
        const nextEnd = Math.max(clip.start + MIN_CLIP_DURATION, time);
        return { ...clip, duration: nextEnd - clip.start };
    });
}
export function setClipGain(project, sceneId, trackId, clipId, gain) {
    return mapClip(project, sceneId, trackId, clipId, (clip) => ({
        ...clip,
        gain: Math.max(0, Math.min(2, gain)),
    }));
}
/* ------------------------------------------------------------------ */
/* Keyframes                                                           */
/* ------------------------------------------------------------------ */
export function addKeyframe(project, sceneId, trackId, clipId, time, props, ease = 'linear') {
    return mapClip(project, sceneId, trackId, clipId, (clip) => {
        const existing = clip.keyframes.find((kf) => Math.abs(kf.time - time) < 1e-6);
        if (existing) {
            return {
                ...clip,
                keyframes: sortKeyframes(clip.keyframes.map((kf) => (kf.id === existing.id ? { ...kf, props, ease } : kf))),
            };
        }
        return {
            ...clip,
            keyframes: sortKeyframes([...clip.keyframes, createKeyframe(time, props, ease)]),
        };
    });
}
export function updateKeyframe(project, sceneId, trackId, clipId, keyframeId, patch) {
    return mapClip(project, sceneId, trackId, clipId, (clip) => ({
        ...clip,
        keyframes: sortKeyframes(clip.keyframes.map((kf) => (kf.id === keyframeId ? { ...kf, ...patch } : kf))),
    }));
}
export function removeKeyframe(project, sceneId, trackId, clipId, keyframeId) {
    return mapClip(project, sceneId, trackId, clipId, (clip) => ({
        ...clip,
        keyframes: clip.keyframes.filter((kf) => kf.id !== keyframeId),
    }));
}
export function moveKeyframe(project, sceneId, trackId, clipId, keyframeId, time) {
    return mapClip(project, sceneId, trackId, clipId, (clip) => {
        const clipEnd = clip.start + clip.duration;
        const clamped = Math.max(clip.start, Math.min(quantizeToFrame(time), clipEnd));
        return {
            ...clip,
            keyframes: sortKeyframes(clip.keyframes.map((kf) => (kf.id === keyframeId ? { ...kf, time: clamped } : kf))),
        };
    });
}
/** Drop keyframes that the clip's duration no longer covers. */
export function pruneKeyframesToClip(project, sceneId, trackId, clipId) {
    return mapClip(project, sceneId, trackId, clipId, (clip) => {
        const end = clip.start + clip.duration;
        return { ...clip, keyframes: clip.keyframes.filter((kf) => kf.time >= clip.start && kf.time <= end) };
    });
}
/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */
export function snapToEdges(time, edges, _clipDuration = 0) {
    let best = time;
    let bestDistance = SNAP_THRESHOLD_SECONDS;
    for (const edge of edges) {
        const distance = Math.abs(edge - time);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = edge;
        }
    }
    return best;
}
/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */
export function sortClips(clips) {
    return [...clips].sort((a, b) => a.start - b.start);
}
export function sortKeyframes(keyframes) {
    return [...keyframes].sort((a, b) => a.time - b.time);
}
export function findClipLocation(scene, clipId) {
    for (const track of scene.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip)
            return { trackId: track.id, clip };
    }
    return undefined;
}
export function findKeyframeLocation(scene, keyframeId) {
    for (const track of scene.tracks) {
        for (const clip of track.clips) {
            const keyframe = clip.keyframes.find((kf) => kf.id === keyframeId);
            if (keyframe)
                return { trackId: track.id, clipId: clip.id, keyframe };
        }
    }
    return undefined;
}
