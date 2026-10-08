/**
 * G1 — the multi-series gate (ARCHITECTURE_SPEC.md §33 G1, Phase 14).
 *
 * A second, structurally different fictional series can exist in the same installation,
 * be authored, and render, with zero changes to `src/core/**`.
 *
 * The second show is built entirely through the public document operations, so the same
 * everyday path the editor uses (and the seed uses) is what has to carry it. It is a
 * deliberate *miss-Match* to the ZANZA cast in every respect the gate names:
 *
 *  - a different palette scheme (`canopy/keel/frill/bioglow/lens` instead of
 *    `skin/hair/top/bottom/shoe`);
 *  - a different rig topology: a drifted gas-bag with fins and pods, no `armL`, no legs,
 *    and no mouth part — so nothing in the engine can have assumed arms, legs or lips;
 *  - a different environment size (2560×1080 against ZANZA's 1920×1080);
 *  - different pose and expression ids from the ZANZA vocabulary.
 *
 * It is authored into the same database as the seed show, and both are *opened* — read back
 * off their repository rows through the same serialization and migration the real open path
 * uses, validated against their own series, resolved, and rendered. The gate then re-runs
 * the content-blindness grep for ZANZA *and* for the second show's own ids: if the engine
 * had special-cased anything about the first show, the second show would either fail to
 * author, fail to open, fail to render — or the grep would find the special-case.
 *
 * This file is deliberately pure-core (it sits at the same tier lint gives `src/arch`):
 * the `openProject` *store* path is exercised by `src/state/editorStore.series.test.ts`,
 * and this gate proves the same fact without reaching up a layer — the store is a thin
 * proxy over parse → validate → resolve, which is exactly what is asserted here.
 *
 * Nothing in `src/core/**` may be touched for this test to pass; it is the automated form
 * of "ZANZA is content, not architecture".
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { createProject, createSeries } from '../core/document/factories';
import { addSeriesAsset } from '../core/document/seriesOps';
import { validateProject, validateSeries } from '../core/document/invariants';
import { resolveAssets } from '../core/document/scopes';
import { addEpisode, addSceneToEpisode, createSceneInProject } from '../core/document/projectOps';
import {
  bindActorToAnchor,
  placeCharacter,
  setActorExpression,
  setActorPose,
} from '../core/document/sceneOps';
import { ellipse, limb, roundRect } from '../core/render/shapes';
import { parseProject, parseSeries, serializeProject, serializeSeries } from '../core/serialize';
import { transform } from '../core/types';
import type {
  CharacterDef,
  EnvironmentDef,
  ExpressionDef,
  PartDef,
  PoseDef,
  Project,
  SeriesDef,
  ShapeDef,
} from '../core/types';
import { layer, part, standingPart, CENTRE_PIVOT } from '../data/envHelpers';
import { SEED_PROJECT, SEED_SERIES } from '../data/seed';
import { renderToRecording } from '../test/recordingContext';

/* ------------------------------------------------------------------ */
/* The second show: REEF ALMANAC                                       */
/* ------------------------------------------------------------------ */

const REEF = {
  series: 'series_reef_almanac',
  character: 'char.reef_drifter',
  environment: 'env.reef_shelf',
  anchor: 'anchor.reef_ledge',
  poseHover: 'pose.reef_hover',
  poseDrift: 'pose.reef_drift',
  exprFlare: 'expr.reef_flare',
  exprDim: 'expr.reef_dim',
} as const;

/** Show-specific tokens that would be damning in `src/core/**`. */
const REEF_TOKENS = ['reef', 'almanac', 'drifter', 'bioluminescence', 'bioglow'] as const;

function rigPart(
  id: string,
  slot: string,
  z: number,
  shape: ShapeDef,
  colorKey: string,
  rest: Partial<PartDef['rest']>,
  parent: string | null = null,
): PartDef {
  return {
    id,
    slot,
    z,
    shape,
    colorKey,
    pivot: CENTRE_PIVOT,
    rest: transform(rest),
    visible: true,
    parent,
  };
}

/** A drifted gas-bag: bell, one lens, two fins, a keel and hanging pods. No limbs. */
const drifter: CharacterDef = {
  id: REEF.character,
  name: 'Drifter',
  description:
    'A non-humanoid float from the deep shelf. The G1 proof that poses do not need arms and legs.',
  tags: ['gate-fixture'],
  height: 480,
  palette: {
    canopy: '#14585c',
    keel: '#0d3a3e',
    frill: '#2baaa0',
    bioglow: '#7efca0',
    lens: '#eaffb0',
  },
  rig: [
    rigPart('p_canopy', 'canopy', 20, ellipse(280, 200), 'canopy', { y: -280 }),
    rigPart('p_lens', 'lens', 24, ellipse(90, 60), 'lens', { y: -340 }, 'p_canopy'),
    rigPart('p_finR', 'finR', 16, ellipse(70, 130), 'frill', { x: 190, y: -240 }, 'p_canopy'),
    rigPart('p_finL', 'finL', 14, ellipse(70, 130), 'frill', { x: -190, y: -240 }, 'p_canopy'),
    rigPart('p_tail', 'tail', 12, roundRect(130, 260, 40), 'keel', { y: -20 }, 'p_canopy'),
    rigPart(
      'p_podL',
      'pod',
      11,
      limb(30, 20, 230),
      'frill',
      { y: 250, x: -40 },
      'p_tail',
    ),
    rigPart('p_podC', 'pod', 11, limb(34, 22, 260), 'frill', { y: 270 }, 'p_tail'),
    rigPart(
      'p_podR',
      'pod',
      11,
      limb(30, 20, 230),
      'frill',
      { y: 250, x: 40 },
      'p_tail',
    ),
  ],
  defaultPoseId: REEF.poseHover,
  mouthSlot: 'mouth',
  defaultExpressionId: REEF.exprFlare,
};

const poseHover: PoseDef = {
  id: REEF.poseHover,
  name: 'Hover',
  description: 'Holding station on the ledge.',
  tags: ['station'],
  slots: {
    finL: { rotation: 0.35, scaleY: 1.2 },
    finR: { rotation: -0.35, scaleY: 1.2 },
    tail: { rotation: -0.08 },
  },
};

const poseDrift: PoseDef = {
  id: REEF.poseDrift,
  name: 'Drift',
  description: 'Feathered sideways with the current.',
  tags: ['travel'],
  slots: {
    canopy: { rotation: -0.25 },
    finL: { rotation: 0.12 },
    finR: { rotation: -0.12 },
  },
};

const exprFlare: ExpressionDef = {
  id: REEF.exprFlare,
  name: 'Flare',
  description: 'Lens wide and bright.',
  tags: ['lit'],
  slots: {
    lens: { scaleX: 2.3, scaleY: 2.3 },
    canopy: { alpha: 1.4 },
  },
};

const exprDim: ExpressionDef = {
  id: REEF.exprDim,
  name: 'Dim',
  description: 'Lens shuttered, bell cool.',
  tags: ['unlit'],
  slots: {
    lens: { scaleX: 0.4, scaleY: 0.4 },
    canopy: { alpha: 0.6 },
  },
};

/** A shelf twice the width of ZANZA's apartment frame — a different authored frame. */
const deepShelf: EnvironmentDef = {
  id: REEF.environment,
  name: 'Deepshelf',
  description: 'A low-lit carbon shelf, 2560px wide.',
  tags: ['gate-fixture'],
  width: 2560,
  height: 1080,
  layers: [
    layer('l.abyss', 'Abyss', 0, 0.7, [
      standingPart(roundRect(300, 420, 80), 'abyss', 400, 940),
      standingPart(roundRect(220, 340, 60), 'abyss', 1500, 960),
      standingPart(roundRect(260, 300, 70), 'abyss', 2220, 940),
    ]),
    layer('l.shelf', 'Shelf', 2, 1, [
      part(ellipse(240, 70), 'shelf', 1280, 720),
      standingPart(roundRect(1700, 260, 40), 'shelf', 1280, 1080),
    ]),
  ],
  anchors: [
    {
      id: REEF.anchor,
      name: 'Ledge',
      x: 1280,
      y: 940,
      scale: 1,
      rotation: 0,
      flipX: false,
      facing: 'right',
      kind: 'floor',
      tags: ['stand'],
    },
  ],
  lighting: { ambient: '#04121a', overlayColor: null, vignette: 0.35 },
};

/** Author the show and its pilot through the public document operations. */
function authorReefAlmanac(): { series: SeriesDef; project: Project } {
  let series: SeriesDef = {
    ...createSeries('Reef Almanac', 'A structurally different second show.'),
    id: REEF.series,
  };
  series = addSeriesAsset(series, 'characters', drifter);
  series = addSeriesAsset(series, 'environments', deepShelf);
  series = addSeriesAsset(series, 'poses', poseHover);
  series = addSeriesAsset(series, 'poses', poseDrift);
  series = addSeriesAsset(series, 'expressions', exprFlare);
  series = addSeriesAsset(series, 'expressions', exprDim);

  let project = addEpisode(
    createProject('Reef Almanac — Issue 1', REEF.series),
    'Episode 01 — Bioluminescence',
  );
  const episodeId = project.episodes[0]?.id;
  if (!episodeId) throw new Error('Reef Almanac episode was not created');

  const intoScene = createSceneInProject(project, series.assets, {
    name: 'Deep Cove',
    environmentId: REEF.environment,
    duration: 8,
  });
  project = intoScene.project;
  const sceneId = intoScene.sceneId;

  const staged = placeCharacter(project, sceneId, drifter, { scaleX: 0.9, scaleY: 0.9 });
  project = staged.project;
  project = bindActorToAnchor(project, series.assets, sceneId, staged.actorId, REEF.anchor);
  project = setActorPose(project, sceneId, staged.actorId, REEF.poseHover);
  project = setActorExpression(project, sceneId, staged.actorId, REEF.exprFlare);
  project = addSceneToEpisode(project, episodeId, sceneId);

  return { series, project };
}

/* ------------------------------------------------------------------ */
/* Content-blindness scan (the pure half of G2, run here against BOTH shows) */
/* ------------------------------------------------------------------ */

const CORE_DIR = join(process.cwd(), 'src', 'core');

function coreFiles(dir = CORE_DIR): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...coreFiles(full));
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

function codeOf(file: string): string {
  const source = readFileSync(file, 'utf8');
  // Comments legitimately discuss the rules by name; only code is checked.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

function offendersInCore(banned: RegExp): string[] {
  const offenders: string[] = [];
  for (const file of coreFiles()) {
    const lines = codeOf(file).split('\n');
    lines.forEach((line, index) => {
      banned.lastIndex = 0;
      if (banned.test(line)) {
        offenders.push(`${file.replace(CORE_DIR, 'core')}:${index + 1} ${line.trim()}`);
      }
    });
  }
  return offenders;
}

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

describe('G1 — a second, structurally different series', () => {
  const { series, project } = authorReefAlmanac();

  it('has a rig topology a humanoid would never have', () => {
    const slots = drifter.rig.map((p) => p.slot);
    expect(slots).toContain('finL');
    expect(slots).toContain('pod');
    expect(slots).not.toContain('armL');
    expect(slots).not.toContain('armR');
    expect(slots).not.toContain('thighL');
    expect(slots).not.toContain('shinL');
    expect(slots).not.toContain('footL');
    expect(slots).not.toContain('mouth');
    expect(Object.keys(drifter.palette)).not.toEqual(
      expect.arrayContaining(['skin', 'hair', 'top', 'bottom', 'shoe']),
    );
  });

  it('authors the show and its pilot through the public document operations', () => {
    expect(series.assets.characters.map((c) => c.id)).toContain(REEF.character);
    expect(series.assets.environments.map((e) => e.id)).toContain(REEF.environment);
    expect(project.episodes).toHaveLength(1);
    expect(project.scenes).toHaveLength(1);
    expect(project.scenes[0]?.actors[0]?.characterId).toBe(REEF.character);
  });

  it('is valid, against its own series and the seeded show', () => {
    expect(validateSeries(series)).toEqual([]);
    expect(validateProject(project, series)).toEqual([]);
  });

  it('renders: a balanced draw log with its own palette reaching pixels', () => {
    const scene = project.scenes[0];
    if (!scene) throw new Error('No scene');
    const ctx = renderToRecording(resolveAssets(project, series), scene, 4);
    expect(ctx.isBalanced()).toBe(true);
    expect(ctx.countOf('fill')).toBeGreaterThan(0);
    const fills = ctx.calls
      .filter((call) => call.op === 'set:fillStyle')
      .map((call) => String(call.args[0]))
      .join(' ');
    expect(fills).toContain('#14585c'); // canopy
    expect(fills).toContain('#0d3a3e'); // keel
    expect(fills).toContain('#eaffb0'); // lens
  });

  it('coexists with ZANZA in one database, both openable and rendering in turn', () => {
    // Persist exactly what the two repositories hold: an `{ formatVersion, series }` row per
    // show and an `{ formatVersion, project }` row per production.
    const seriesRows = new Map<string, string>([
      [SEED_SERIES.id, serializeSeries(SEED_SERIES)],
      [series.id, serializeSeries(series)],
    ]);
    const projectRows = new Map<string, string>([
      [SEED_PROJECT.id, serializeProject(SEED_PROJECT)],
      [project.id, serializeProject(project)],
    ]);

    // "Open" is the read side the editor actually runs: parse the rows the repository read,
    // and rebuild context the way resolveProjectContext does — validation then resolve.
    for (const [id, row] of projectRows) {
      const opened = parseProject(row);
      const owner = seriesRows.get(opened.seriesId ?? '') ?? null;
      expect(owner, `series of ${id} is in the same database`).not.toBeNull();
      const seriesDef = owner === null ? null : parseSeries(owner);
      expect(validateProject(opened, seriesDef)).toEqual([]);
      const scene = opened.scenes[0];
      if (!scene || seriesDef === null) throw new Error('open did not yield a scene');
      const ctx = renderToRecording(resolveAssets(opened, seriesDef), scene, 4);
      expect(ctx.isBalanced()).toBe(true);
      expect(ctx.countOf('fill')).toBeGreaterThan(0);
      // The seed frame stays the seed frame; the second show's palette reaches its own pixels.
      if (id === project.id) {
        const fills = ctx.calls
          .filter((call) => call.op === 'set:fillStyle')
          .map((call) => String(call.args[0]))
          .join(' ');
        expect(fills).toContain('#14585c');
        expect(fills).toContain('#0d3a3e');
      }
    }
  });

  it('finds no trace of either show in src/core code', () => {
    const zanza = /\b(?:nia|kito|zanza|sheng|nairobi|kilimani|proj_zanza)\w*|\b2097\b/gi;
    const reef = new RegExp(`\\b(?:${REEF_TOKENS.join('|')})\\w*`, 'gi');
    expect(offendersInCore(zanza), 'ZANZA tokens must not appear in src/core code').toEqual([]);
    expect(
      offendersInCore(reef),
      'the second show\'s own tokens must not appear in src/core code',
    ).toEqual([]);
    // The second show's ids are the damning case: they could only be there as a special case.
    const ids = [
      REEF.series,
      REEF.character,
      REEF.environment,
      REEF.poseHover,
      REEF.poseDrift,
      REEF.exprFlare,
      REEF.exprDim,
    ];
    for (const id of ids) {
      expect(
        offendersInCore(new RegExp(id.replace(/[/.\\]/g, '\\$&'), 'gi')),
        `no core code may name the fixture id ${id}`,
      ).toEqual([]);
    }
  });
});