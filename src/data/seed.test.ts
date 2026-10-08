/**
 * SEED INTEGRITY.
 *
 * These tests are the contract between the ZANZA creative content and the generic
 * engine. If a character, set or pose is malformed, it fails here rather than
 * halfway through a render.
 */

import { describe, expect, it } from 'vitest';
import { validateProject } from '../core/document/invariants';
import { findScene } from '../core/document/lookups';
import { episodeScenes } from '../core/document/projectOps';
import { parseProject, ProjectParseError, serializeProject } from '../core/serialize';
import { SEED_PROJECT, SEED_SERIES } from './seed';
import { CHARACTERS, KITO, MAMA_NIA, NIA, THE_LANDLORD } from './characters';
import { ENVIRONMENTS, NIA_APARTMENT, ZANZA_LOUNGE, ZANZA_STREET } from './environments';
import { EXPRESSIONS } from './expressions';
import { POSES } from './poses';
import { PROPS } from './props';

describe('seed project', () => {
  it('passes every invariant with zero issues', () => {
    const issues = validateProject(SEED_PROJECT);
    expect(issues).toEqual([]);
  });

  it('passes every invariant at load time too, with no colour-key surprises (R3)', () => {
    // Authoring mode tolerates a colour-key warning; load mode turns it into a refusal, so
    // the seed must be clean under the strictest lens — every rig part has to resolve
    // against its own palette or be a literal colour.
    expect(validateProject(SEED_PROJECT, SEED_SERIES, { mode: 'load' })).toEqual([]);
  });

  it('survives a serialize/parse round trip unchanged', () => {
    // `parseProject` returns a Project and throws `ProjectParseError` on bad input.
    // A round trip that comes back byte-identical is what makes versioned project
    // files safe to trust.
    const text = serializeProject(SEED_PROJECT);
    const parsed = parseProject(text);
    expect(parsed).toEqual(SEED_PROJECT);
    expect(serializeProject(parsed)).toBe(text);
  });

  it('rejects a corrupt file instead of opening it', () => {
    expect(() => parseProject('{ not json')).toThrow(ProjectParseError);
    expect(() => parseProject('{"formatVersion":1}')).toThrow(/Missing `project` key/);
    expect(() => parseProject(JSON.stringify({ formatVersion: 99, project: {} }))).toThrow(/newer than this build/);
  });

  it('holds EP001 with all five scenes in order', () => {
    const episode = SEED_PROJECT.episodes[0];
    expect(episode).toBeDefined();
    if (!episode) return;

    const scenes = episodeScenes(SEED_PROJECT, episode.id);
    expect(scenes).toHaveLength(5);
    expect(scenes[0]?.name).toBe('SC01 — Bro, Where Have You Been?');
    expect(scenes.map((s) => s.environmentId)).toEqual([
      NIA_APARTMENT.id,
      NIA_APARTMENT.id,
      ZANZA_STREET.id,
      ZANZA_LOUNGE.id,
      NIA_APARTMENT.id,
    ]);
  });

  it('stages the acceptance scene with Nia on the couch and Kito at the door', () => {
    const scene = findScene(SEED_PROJECT, SEED_PROJECT.scenes[0]?.id ?? '');
    expect(scene).toBeDefined();
    if (!scene) return;

    const nia = scene.actors.find((a) => a.characterId === NIA.id);
    const kito = scene.actors.find((a) => a.characterId === KITO.id);

    expect(nia?.anchorId).toBe('anchor.nia_couch');
    expect(nia?.poseId).toBe('pose.sittingSofa');
    expect(kito?.anchorId).toBe('anchor.kito_door');
    expect(kito?.poseId).toBe('pose.walkingIn');
  });

  it('carries the four acceptance lines at their authored times', () => {
    const scene = findScene(SEED_PROJECT, SEED_PROJECT.scenes[0]?.id ?? '');
    expect(scene).toBeDefined();
    if (!scene) return;

    expect(scene.dialogue.map((d) => d.text)).toEqual([
      'Bro, where have you been?',
      'Building my empire.',
      'You owe me rent.',
      '...the empire is still in development.',
    ]);
  });

  it('references assets by id only — never by value', () => {
    // A SceneActor may hold ids and a placement transform. It must never hold a
    // value-shaped field copied out of a CharacterDef — that is what would make
    // asset reuse a matter of discipline instead of structure. `poseId` and
    // `expressionId` are ids, so they are the one legitimate name overlap.
    const scene = SEED_PROJECT.scenes[0];
    expect(scene).toBeDefined();
    if (!scene) return;

    const copiedFields = ['name', 'description', 'tags', 'palette', 'rig', 'height'];
    for (const actor of scene.actors) {
      for (const key of copiedFields) {
        expect(actor).not.toHaveProperty(key);
      }
      expect(actor.transform).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    }
  });

  it('uses every character in the library somewhere', () => {
    const used = new Set(SEED_PROJECT.scenes.flatMap((s) => s.actors.map((a) => a.characterId)));
    for (const character of CHARACTERS) {
      expect(used.has(character.id)).toBe(true);
    }
  });

  it('resolves every pose, expression and prop reference it makes', () => {
    const poseIds = new Set(POSES.map((p) => p.id));
    const expressionIds = new Set(EXPRESSIONS.map((e) => e.id));
    const propIds = new Set(PROPS.map((p) => p.id));

    for (const scene of SEED_PROJECT.scenes) {
      for (const actor of scene.actors) {
        expect(poseIds.has(actor.poseId)).toBe(true);
        expect(expressionIds.has(actor.expressionId)).toBe(true);
      }
      for (const prop of scene.props) {
        expect(propIds.has(prop.propId)).toBe(true);
      }
    }
  });
});

describe('asset libraries', () => {
  it('defines all four pilot characters', () => {
    expect([NIA, KITO, MAMA_NIA, THE_LANDLORD].map((c) => c.id)).toEqual([
      'char.nia',
      'char.kito',
      'char.mama_nia',
      'char.landlord',
    ]);
  });

  it('gives every character a real rig and default slots that exist', () => {
    const poseIds = new Set(POSES.map((p) => p.id));
    const expressionIds = new Set(EXPRESSIONS.map((e) => e.id));

    for (const character of CHARACTERS) {
      expect(character.rig.length).toBeGreaterThan(10);
      expect(character.height).toBeGreaterThan(0);
      expect(poseIds.has(character.defaultPoseId)).toBe(true);
      expect(expressionIds.has(character.defaultExpressionId)).toBe(true);
      expect(Object.keys(character.palette).length).toBeGreaterThan(2);
      for (const color of Object.values(character.palette)) {
        expect(color).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it('defines three environments, each with staging anchors', () => {
    expect(ENVIRONMENTS).toHaveLength(3);
    for (const env of ENVIRONMENTS) {
      expect(env.layers.length).toBeGreaterThan(0);
      expect(env.anchors.length).toBeGreaterThan(0);
      for (const anchor of env.anchors) {
        expect(anchor.id.startsWith('anchor.')).toBe(true);
        expect(['left', 'right']).toContain(anchor.facing);
        expect(['stand', 'sit', 'door', 'table', 'floor']).toContain(anchor.kind);
        expect(anchor.scale).toBeGreaterThan(0);
      }
    }
  });

  it('anchors every acceptance-scene staging position', () => {
    const ids = new Set(NIA_APARTMENT.anchors.map((a) => a.id));
    expect(ids.has('anchor.nia_couch')).toBe(true);
    expect(ids.has('anchor.nia_couch_right')).toBe(true);
    expect(ids.has('anchor.kito_door')).toBe(true);
  });
});
