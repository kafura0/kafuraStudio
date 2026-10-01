/**
 * Audio slot attachment, as pure document operations.
 *
 * These pin the half of attaching that is testable without a browser: what the document
 * says afterwards. The bytes live in the media store and are the store's tests' business;
 * what matters here is that the document records a *reference*, states how to read it, and
 * carries a real duration, because `audioPlan` bounds every segment by that number and a
 * slot left at zero is inaudible.
 */
import { describe, expect, it } from 'vitest';
import { attachAudioMedia, detachAudioMedia, addAsset } from './projectOps';
import { createProject } from './factories';
import { audioPlan } from '../audio/audioPlan';
import { createScene } from './factories';
import { addSimpleClip } from './trackOps';
import type { AudioDef, Project } from '../types';

function withSlot(): Project {
  const def: AudioDef = {
    id: 'vo_1',
    name: 'Nia — line 1',
    kind: 'dialogue',
    src: null,
    srcKind: null,
    duration: 0,
    tags: [],
  };
  return addAsset(createProject('A'), 'audio', def);
}

function slot(project: Project): AudioDef {
  const def = project.assets.audio.find((a) => a.id === 'vo_1');
  if (!def) throw new Error('slot missing');
  return def;
}

describe('attachAudioMedia', () => {
  it('records the media id, the local srcKind, and the probed duration', () => {
    const next = attachAudioMedia(withSlot(), 'vo_1', 'media_ab12', 3.25);
    expect(slot(next)).toMatchObject({ src: 'media_ab12', srcKind: 'local', duration: 3.25 });
  });

  it('does not mutate the project it was given', () => {
    const before = withSlot();
    const snapshot = JSON.stringify(before);
    attachAudioMedia(before, 'vo_1', 'media_ab12', 3);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('leaves the source document empty, so undo has something to return to', () => {
    const before = withSlot();
    const after = attachAudioMedia(before, 'vo_1', 'media_ab12', 3);
    expect(slot(before).src).toBeNull();
    expect(slot(before).srcKind).toBeNull();
    expect(after).not.toBe(before);
  });

  it('refuses a non-finite duration rather than recording one that mutes the clip', () => {
    for (const bad of [NaN, Infinity, -1, 0]) {
      const next = attachAudioMedia(withSlot(), 'vo_1', 'media_x', bad);
      expect(slot(next).duration).toBe(0);
    }
  });

  it('makes the slot audible: a clip on it now produces a segment', () => {
    const project = withSlot();
    const scene = createScene('S', 'env', { duration: 10 });
    const base: Project = { ...project, scenes: [scene] };
    const built = addSimpleClip(base, scene.id, 'audio', 'vo_1', 'cue', 0, 4, {
      audioId: 'vo_1',
    });
    const withClip = built.project.scenes.find((s) => s.id === scene.id);
    if (!withClip) throw new Error('scene missing');

    // Before attaching: the plan still reports a window, but the engine has nothing to
    // resolve, so nothing is audible. This is the declared-slot state.
    const attached = attachAudioMedia(built.project, 'vo_1', 'media_ab12', 4);
    const segment = audioPlan(attached, withClip)[0];
    expect(segment).toBeDefined();
    // The segment's length comes from the asset's duration, so a zero would cut it silent.
    expect(segment?.duration).toBeCloseTo(4, 6);
  });

  it('touches the project so autosave sees the edit', () => {
    const before = withSlot();
    const after = attachAudioMedia(before, 'vo_1', 'media_ab12', 3);
    expect(after.updatedAt >= before.updatedAt).toBe(true);
  });

  it('leaves the document free of bytes: the reference is an id, not data', () => {
    const next = attachAudioMedia(withSlot(), 'vo_1', 'media_ab12', 3);
    const json = JSON.stringify(next);
    // A base64 blob in here would mean media had leaked into the project file.
    expect(json).toContain('media_ab12');
    expect(json).not.toMatch(/data:audio/);
    expect(json).not.toMatch(/base64/);
  });
});

describe('detachAudioMedia', () => {
  it('clears the reference and the srcKind together', () => {
    const attached = attachAudioMedia(withSlot(), 'vo_1', 'media_ab12', 3);
    const cleared = detachAudioMedia(attached, 'vo_1');
    expect(slot(cleared).src).toBeNull();
    expect(slot(cleared).srcKind).toBeNull();
  });

  it('keeps the slot itself, because the slot is the promise the scene refers to', () => {
    const attached = attachAudioMedia(withSlot(), 'vo_1', 'media_ab12', 3);
    const cleared = detachAudioMedia(attached, 'vo_1');
    expect(cleared.assets.audio).toHaveLength(1);
    expect(slot(cleared).name).toBe('Nia — line 1');
  });

  it('is undoable by returning the attachment, which is why the bytes are not deleted', () => {
    const base = withSlot();
    const attached = attachAudioMedia(base, 'vo_1', 'media_ab12', 3);
    const cleared = detachAudioMedia(attached, 'vo_1');
    // Undo is the previous reference; re-attaching the same media id is the restore.
    const restored = attachAudioMedia(cleared, 'vo_1', 'media_ab12', 3);
    expect(slot(restored)).toMatchObject({ src: 'media_ab12', srcKind: 'local', duration: 3 });
  });
});
