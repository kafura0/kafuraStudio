/**
 * parsePlan is total (ARCHITECTURE_SPEC.md §9.6, §26 step 1 — Phase 17).
 *
 * Every untrusted-input shape has exactly one outcome: a `PlanParseError`, never a
 * throw and never a half-valid envelope. G7 test 3 leans on the prose / truncated /
 * future-version cases.
 */
import { describe, expect, it } from 'vitest';
import { parsePlan, parseScenePlan } from './parse';
import type { PlanParseError } from './types';

const VALID_BODY = {
  sceneId: 'scene_00000001',
  cast: [{ characterId: 'char.nia', poseId: 'pose.sitting', z: 4 }],
  dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Hello.', emotion: 'flat' }],
  camera: { preset: 'camp.medium' },
};

const VALID: unknown = {
  planVersion: 1,
  kind: 'scene',
  title: 'A scene',
  createdAt: '2026-10-16T10:00:00.000Z',
  provenance: { actor: 'ai', provider: 'anthropic', at: '2026-10-16T10:00:00.000Z' },
  body: VALID_BODY,
};

function envelope(patch: Record<string, unknown>): unknown {
  return { ...(VALID as Record<string, unknown>), ...patch };
}

function body(patch: Record<string, unknown>): unknown {
  return envelope({ body: { ...(VALID_BODY as Record<string, unknown>), ...patch } });
}

type ParseFailure = PlanParseError & { path?: string; kind?: string; planVersion?: number };

function errorOf(input: unknown): ParseFailure {
  const result = parsePlan(input);
  if (result.ok) throw new Error(`expected a parse error for ${JSON.stringify(input)}`);
  return result.error;
}

describe('parsePlan — happy path', () => {
  it('parses a valid envelope from a JSON string', () => {
    const result = parsePlan(JSON.stringify(VALID));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('scene');
    expect(result.value.title).toBe('A scene');
    expect(result.value.provenance?.provider).toBe('anthropic');
  });

  it('passes the body through by reference for object input', () => {
    const source = VALID;
    const result = parsePlan(source);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect((result.value as { body: unknown }).body).toBe((source as { body: unknown }).body);
  });

  it('accepts an envelope with no provenance (§9.3 rule 6)', () => {
    const result = parsePlan({ planVersion: 1, kind: 'scene', title: 'T', createdAt: 'now', body: {} });
    expect(result.ok).toBe(true);
  });

  it('accepts unknown body fields — forward compatibility is validate\'s warning, not a parse failure (§10.3)', () => {
    const result = parsePlan(body({ futureField: 123 }));
    expect(result.ok).toBe(true);
  });

  it('accepts kind "episode" at the envelope level (body support is a later phase)', () => {
    const result = parsePlan(envelope({ kind: 'episode', body: {} }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.kind).toBe('episode');
  });

  it('survives a JSON round trip unchanged (§9.3 rule 1)', () => {
    const plan = JSON.parse(JSON.stringify(VALID));
    expect(parsePlan(plan).ok).toBe(true);
    expect(JSON.parse(JSON.stringify(plan))).toEqual(plan);
  });
});

describe('parsePlan — untrusted input', () => {
  it('prose is not-json', () => {
    expect(errorOf('I would like a scene please')).toEqual({ code: 'not-json', message: expect.any(String) });
  });

  it('truncated JSON is not-json', () => {
    expect(errorOf('{"planVersion": 1, "kind": "scen').code).toBe('not-json');
  });

  it('a non-object is a schema error', () => {
    expect(errorOf(42)).toEqual({ code: 'schema', path: '', message: 'a plan must be a JSON object' });
    expect(errorOf(null).code).toBe('schema');
    expect(errorOf([1, 2]).code).toBe('schema');
  });

  it('a missing or non-numeric planVersion is a schema error', () => {
    expect(errorOf(envelope({ planVersion: undefined })).code).toBe('schema');
    expect(errorOf(envelope({ planVersion: '1' })).path).toBe('planVersion');
  });

  it('a future planVersion is unsupported-version', () => {
    expect(errorOf(envelope({ planVersion: 2 }))).toEqual({ code: 'unsupported-version', planVersion: 2 });
  });

  it('an unknown kind is unknown-kind', () => {
    expect(errorOf(envelope({ kind: 'movie' }))).toEqual({ code: 'unknown-kind', kind: 'movie' });
  });

  it('missing kind / title / createdAt / body are schema errors on their path', () => {
    expect(errorOf(envelope({ kind: undefined })).path).toBe('kind');
    expect(errorOf(envelope({ title: 7 })).path).toBe('title');
    expect(errorOf(envelope({ createdAt: undefined })).path).toBe('createdAt');
    expect(errorOf(envelope({ body: undefined })).path).toBe('body');
    expect(errorOf(envelope({ body: 'nope' })).path).toBe('body');
  });

  it('rejects a malformed provenance on its path', () => {
    expect(errorOf(envelope({ provenance: { actor: 'robot', at: 'now' } })).path).toBe('provenance.actor');
    expect(errorOf(envelope({ provenance: { actor: 'ai' } })).path).toBe('provenance.at');
    expect(errorOf(envelope({ provenance: { actor: 'ai', at: 'now', provider: 9 } })).path).toBe('provenance.provider');
    expect(errorOf(envelope({ provenance: 'yes' })).path).toBe('provenance');
  });
});

describe('parseScenePlan — body shape', () => {
  it('requires an object body', () => {
    expect(parseScenePlan('body').ok).toBe(false);
    expect(parseScenePlan([]).ok).toBe(false);
  });

  it('checks newScene field types on their paths', () => {
    expect(errorOf(body({ sceneId: 7, newScene: undefined })).path).toBe('sceneId');
    expect(errorOf(body({ newScene: { name: 'S', environmentId: 'env.x', duration: '12' } })).path).toBe('newScene.duration');
    expect(errorOf(body({ newScene: { environmentId: 'env.x', duration: 12 } })).path).toBe('newScene.name');
    expect(errorOf(body({ newScene: { name: 'S', duration: 12 } })).path).toBe('newScene.environmentId');
    expect(errorOf(body({ newScene: { name: 'S', environmentId: 'env.x', duration: 12, backgroundColor: 5 } })).path)
      .toBe('newScene.backgroundColor');
  });

  it('checks cast entries element by element', () => {
    expect(errorOf(body({ cast: 'nia' })).path).toBe('cast');
    expect(errorOf(body({ cast: [{ poseId: 'pose.sitting' }] })).path).toBe('cast[0].characterId');
    expect(errorOf(body({ cast: [{ characterId: 9 }] })).path).toBe('cast[0].characterId');
    expect(errorOf(body({ cast: [{ characterId: 'char.nia', z: '4' }] })).path).toBe('cast[0].z');
    expect(errorOf(body({ cast: [{ characterId: 'char.nia', flipX: 1 }] })).path).toBe('cast[0].flipX');
    expect(errorOf(body({ cast: [{ characterId: 'char.nia', transform: { x: '1' } }] })).path).toBe('cast[0].transform.x');
    expect(errorOf(body({ cast: [{ characterId: 'char.nia', transform: [] }] })).path).toBe('cast[0].transform');
    expect(errorOf(body({ cast: [{ characterId: 'char.nia', expressionChanges: [{ expressionId: 'expr.happy' }] }] })).path)
      .toBe('cast[0].expressionChanges[0].at');
  });

  it('checks dialogue entries element by element', () => {
    expect(errorOf(body({ dialogue: [{}] })).path).toBe('dialogue[0].speaker');
    expect(errorOf(body({ dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', text: 'Hi', emotion: 'flat', duration: '2' }] })).path)
      .toBe('dialogue[0].duration');
    expect(errorOf(body({ dialogue: [{ speaker: 'NIA', actorRef: 'char.nia', emotion: 'flat', text: 3 }] })).path)
      .toBe('dialogue[0].text');
  });

  it('checks camera keyframes, including the ease union', () => {
    expect(errorOf(body({ camera: { keyframes: [{ x: 1 }] } })).path).toBe('camera.keyframes[0].at');
    expect(errorOf(body({ camera: { keyframes: [{ at: 0, zoom: '2' }] } })).path).toBe('camera.keyframes[0].zoom');
    expect(errorOf(body({ camera: { keyframes: [{ at: 0, ease: 'bounce' }] } })).path).toBe('camera.keyframes[0].ease');
    expect(errorOf(body({ camera: { preset: 3 } })).path).toBe('camera.preset');
    expect(errorOf(body({ camera: 'close' })).path).toBe('camera');
  });

  it('checks animation and timing shapes', () => {
    expect(errorOf(body({ animation: 'run' })).path).toBe('animation');
    expect(errorOf(body({ animation: [{ at: 1 }] })).path).toBe('animation[0].clipId');
    expect(errorOf(body({ timing: { dialogueGap: 'soon' } })).path).toBe('timing.dialogueGap');
  });
});
