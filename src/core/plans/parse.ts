/**
 * `parsePlan` — the first thing that touches untrusted input (ARCHITECTURE_SPEC.md §9.6,
 * §23.2 — Phase 17).
 *
 * Total: never throws, never returns a partially-valid envelope. It checks *shape*
 * only — types, unions, presence — because every semantic judgement belongs to
 * `validatePlan`, which can report several diagnostics at once with severities. An
 * unknown field inside the body is therefore **accepted** here and warned about there
 * (§10.3 forward compatibility).
 */
import type { PlanEnvelope, PlanParseError, Result, ScenePlan, SchemaParseError } from './types';

const KINDS = new Set(['scene', 'episode', 'production']);
const PROVENANCE_ACTORS = new Set(['human', 'ai', 'system', 'import']);
const EASES = new Set(['linear', 'step', 'easeInOut', 'easeOut']);
const TRANSFORM_FIELDS = new Set(['x', 'y', 'rotation', 'scaleX', 'scaleY', 'alpha']);

function schema(path: string, message: string): SchemaParseError {
  return { code: 'schema', path, message };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ */
/* Field checks. Each returns null when the field is absent-and-       */
/* optional or well-typed, and a `schema` error otherwise.             */
/* ------------------------------------------------------------------ */

function optString(obj: Record<string, unknown>, key: string, path: string): SchemaParseError | null {
  if (!(key in obj) || obj[key] === undefined) return null;
  if (typeof obj[key] !== 'string') return schema(`${path}${key}`, 'expected a string');
  return null;
}

function reqString(obj: Record<string, unknown>, key: string, path: string): SchemaParseError | null {
  if (typeof obj[key] !== 'string') return schema(`${path}${key}`, 'expected a string');
  return null;
}

function optNumber(obj: Record<string, unknown>, key: string, path: string): SchemaParseError | null {
  if (!(key in obj) || obj[key] === undefined) return null;
  if (typeof obj[key] !== 'number' || !Number.isFinite(obj[key])) {
    return schema(`${path}${key}`, 'expected a finite number');
  }
  return null;
}

function optBoolean(obj: Record<string, unknown>, key: string, path: string): SchemaParseError | null {
  if (!(key in obj) || obj[key] === undefined) return null;
  if (typeof obj[key] !== 'boolean') return schema(`${path}${key}`, 'expected a boolean');
  return null;
}

function first(...checks: (SchemaParseError | null)[]): SchemaParseError | null {
  for (const check of checks) if (check) return check;
  return null;
}

function parseTransform(value: unknown, path: string): SchemaParseError | null {
  if (!isObject(value)) return schema(path, 'expected an object');
  for (const key of Object.keys(value)) {
    if (!TRANSFORM_FIELDS.has(key)) continue; // unknown keys are validate's job (§10.3)
    const v = value[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return schema(`${path}.${key}`, 'expected a finite number');
    }
  }
  return null;
}

function parseCastEntry(value: unknown, path: string): SchemaParseError | null {
  if (!isObject(value)) return schema(path, 'expected an object');
  const fields = first(
    reqString(value, 'characterId', `${path}.`),
    optString(value, 'displayName', `${path}.`),
    optString(value, 'poseId', `${path}.`),
    optString(value, 'expressionId', `${path}.`),
    optString(value, 'anchorId', `${path}.`),
    optNumber(value, 'z', `${path}.`),
    optBoolean(value, 'flipX', `${path}.`),
  );
  if (fields) return fields;
  if ('transform' in value && value.transform !== undefined) {
    const check = parseTransform(value.transform, `${path}.transform`);
    if (check) return check;
  }
  if ('expressionChanges' in value && value.expressionChanges !== undefined) {
    const changes = value.expressionChanges;
    if (!Array.isArray(changes)) return schema(`${path}.expressionChanges`, 'expected an array');
    for (let i = 0; i < changes.length; i += 1) {
      const change = changes[i];
      const changePath = `${path}.expressionChanges[${i}]`;
      if (!isObject(change)) return schema(changePath, 'expected an object');
      if (typeof change.at !== 'number' || !Number.isFinite(change.at)) {
        return schema(`${changePath}.at`, 'expected a finite number');
      }
      const check = reqString(change, 'expressionId', `${changePath}.`);
      if (check) return check;
    }
  }
  return null;
}

function parsePlannedLine(value: unknown, path: string): SchemaParseError | null {
  if (!isObject(value)) return schema(path, 'expected an object');
  return first(
    reqString(value, 'speaker', `${path}.`),
    reqString(value, 'actorRef', `${path}.`),
    reqString(value, 'text', `${path}.`),
    reqString(value, 'emotion', `${path}.`),
    optString(value, 'subtitle', `${path}.`),
    optNumber(value, 'start', `${path}.`),
    optNumber(value, 'duration', `${path}.`),
    optString(value, 'voiceId', `${path}.`),
  );
}

function parsePlannedCamera(value: unknown, path: string): SchemaParseError | null {
  if (!isObject(value)) return schema(path, 'expected an object');
  if (first(optString(value, 'preset', `${path}.`))) return optString(value, 'preset', `${path}.`);
  if ('keyframes' in value && value.keyframes !== undefined) {
    const keyframes = value.keyframes;
    if (!Array.isArray(keyframes)) return schema(`${path}.keyframes`, 'expected an array');
    for (let i = 0; i < keyframes.length; i += 1) {
      const kf = keyframes[i];
      const kfPath = `${path}.keyframes[${i}]`;
      if (!isObject(kf)) return schema(kfPath, 'expected an object');
      if (typeof kf.at !== 'number' || !Number.isFinite(kf.at)) {
        return schema(`${kfPath}.at`, 'expected a finite number');
      }
      const check = first(
        optNumber(kf, 'x', `${kfPath}.`), optNumber(kf, 'y', `${kfPath}.`),
        optNumber(kf, 'zoom', `${kfPath}.`), optNumber(kf, 'rotation', `${kfPath}.`),
      );
      if (check) return check;
      if ('ease' in kf && kf.ease !== undefined) {
        if (typeof kf.ease !== 'string' || !EASES.has(kf.ease)) {
          return schema(`${kfPath}.ease`, 'expected one of linear, step, easeInOut, easeOut');
        }
      }
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* ScenePlan body                                                      */
/* ------------------------------------------------------------------ */

/** Shape-check a body for `kind: 'scene'`. Returns the same reference, narrowed. */
export function parseScenePlan(body: unknown): Result<ScenePlan, SchemaParseError> {
  if (!isObject(body)) return { ok: false, error: schema('', 'a plan body must be an object') };

  if ('sceneId' in body && body.sceneId !== undefined && typeof body.sceneId !== 'string') {
    return { ok: false, error: schema('sceneId', 'expected a string') };
  }

  if ('newScene' in body && body.newScene !== undefined) {
    const ns = body.newScene;
    const path = 'newScene.';
    if (!isObject(ns)) return { ok: false, error: schema('newScene', 'expected an object') };
    const durationOk = typeof ns.duration === 'number' && Number.isFinite(ns.duration);
    const check = first(
      reqString(ns, 'name', path),
      reqString(ns, 'environmentId', path),
      durationOk ? null : schema('newScene.duration', 'expected a finite number'),
      optString(ns, 'backgroundColor', path),
    );
    if (check) return { ok: false, error: check };
  }

  if ('cast' in body && body.cast !== undefined) {
    if (!Array.isArray(body.cast)) return { ok: false, error: schema('cast', 'expected an array') };
    for (let i = 0; i < body.cast.length; i += 1) {
      const check = parseCastEntry(body.cast[i], `cast[${i}]`);
      if (check) return { ok: false, error: check };
    }
  }

  if ('dialogue' in body && body.dialogue !== undefined) {
    if (!Array.isArray(body.dialogue)) return { ok: false, error: schema('dialogue', 'expected an array') };
    for (let i = 0; i < body.dialogue.length; i += 1) {
      const check = parsePlannedLine(body.dialogue[i], `dialogue[${i}]`);
      if (check) return { ok: false, error: check };
    }
  }

  if ('camera' in body && body.camera !== undefined) {
    const check = parsePlannedCamera(body.camera, 'camera');
    if (check) return { ok: false, error: check };
  }

  if ('animation' in body && body.animation !== undefined) {
    const animation = body.animation;
    if (!Array.isArray(animation)) return { ok: false, error: schema('animation', 'expected an array') };
    for (let i = 0; i < animation.length; i += 1) {
      const entry = animation[i];
      const path = `animation[${i}]`;
      if (!isObject(entry)) return { ok: false, error: schema(path, 'expected an object') };
      const check = first(reqString(entry, 'clipId', `${path}.`), optNumber(entry, 'at', `${path}.`));
      if (check) return { ok: false, error: check };
    }
  }

  if ('timing' in body && body.timing !== undefined) {
    const timing = body.timing;
    if (!isObject(timing)) return { ok: false, error: schema('timing', 'expected an object') };
    const check = first(optNumber(timing, 'dialogueStart', 'timing.'), optNumber(timing, 'dialogueGap', 'timing.'));
    if (check) return { ok: false, error: check };
  }

  return { ok: true, value: body as ScenePlan };
}

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

function parseProvenance(value: unknown): SchemaParseError | null {
  if (!isObject(value)) return schema('provenance', 'expected an object');
  const actor = value.actor;
  if (typeof actor !== 'string' || !PROVENANCE_ACTORS.has(actor)) {
    return schema('provenance.actor', 'expected one of human, ai, system, import');
  }
  if (typeof value.at !== 'string') return schema('provenance.at', 'expected an ISO 8601 string');
  for (const key of ['provider', 'model', 'note'] as const) {
    const check = optString(value, key, 'provenance.');
    if (check) return check;
  }
  return null;
}

/** Total: never throws, never returns a partially-valid plan (§9.6). */
export function parsePlan(input: string | unknown): Result<PlanEnvelope, PlanParseError> {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (error) {
      return { ok: false, error: { code: 'not-json', message: error instanceof Error ? error.message : 'invalid JSON' } };
    }
  }

  if (!isObject(raw)) return { ok: false, error: schema('', 'a plan must be a JSON object') };

  const version = raw.planVersion;
  if (typeof version !== 'number') return { ok: false, error: schema('planVersion', 'expected a number') };
  if (version !== 1) return { ok: false, error: { code: 'unsupported-version', planVersion: version } };

  const kind = raw.kind;
  if (typeof kind !== 'string') return { ok: false, error: schema('kind', 'expected a string') };
  if (!KINDS.has(kind)) return { ok: false, error: { code: 'unknown-kind', kind } };

  const envelopeError = first(
    reqString(raw, 'title', ''),
    reqString(raw, 'createdAt', ''),
    optString(raw, 'parentPlanId', ''),
    'provenance' in raw && raw.provenance !== undefined ? parseProvenance(raw.provenance) : null,
    'body' in raw ? null : schema('body', 'missing body'),
  );
  if (envelopeError) return { ok: false, error: envelopeError };
  if (!isObject(raw.body)) return { ok: false, error: schema('body', 'expected an object') };

  if (kind === 'scene') {
    const body = parseScenePlan(raw.body);
    if (!body.ok) return { ok: false, error: body.error };
  }

  return { ok: true, value: raw as unknown as PlanEnvelope };
}
