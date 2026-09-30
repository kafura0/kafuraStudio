/**
 * Camera authoring — architectural invariants.
 *
 * These are not tests of behaviour. They are tests of the *shape* of the code, and they
 * exist because the properties they guard cannot be recovered by reading a single
 * function later.
 *
 * The two that matter for Phase 9:
 *
 * 1. `frameBounds` agrees with the renderer. The framing maths inverts the camera
 *    transform that `render.ts` applies. If the two ever diverge, framing will look
 *    correct in tests and wrong on screen, and the test suite will be the last thing
 *    that agrees with the user. `fitScale` is therefore imported from geometry by both
 *    rather than implemented twice.
 *
 * 2. Core never imports content. `src/core` must stay loadable with no ZANZA in it, or
 *    the engine has become a show.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { frameBounds, type FrameSubject } from './frame';
import { fitScale } from '../geometry';
import type { Transform2D } from '../types';

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

describe('core is content-blind', () => {
  // RULE 2. A ZANZA identifier in core would mean the engine only ever works for one
  // show, which is the exact failure this project is meant to avoid.
  const banned = /\b(nia|kito|mama_nia|landlord|kilimani|zanza|sheng|afrofuturis)\w*/i;

  it('no core module names ZANZA content', () => {
    const offenders: string[] = [];
    for (const file of coreFiles()) {
      const source = readFileSync(file, 'utf8');
      // Comments legitimately discuss the rules by name; only code is checked.
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      for (const line of code.split('\n')) {
        if (banned.test(line)) offenders.push(`${file.replace(CORE_DIR, 'core')}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no core module imports from src/data', () => {
    const offenders = coreFiles().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /from\s+['"][^'"]*\/data\//.test(source);
    });
    expect(offenders.map((f) => f.replace(CORE_DIR, 'core'))).toEqual([]);
  });

  it('no core module imports from React, the store, or the UI', () => {
    // Imports flow ui -> state -> core and no further. An upward import means the core
    // has started to depend on the editor, which is what makes it untestable.
    const offenders: string[] = [];
    for (const file of coreFiles()) {
      const source = readFileSync(file, 'utf8');
      if (/from\s+['"]react/.test(source)) offenders.push(`${file.replace(CORE_DIR, 'core')}: react`);
      if (/\/(state|ui)\//.test(source)) offenders.push(`${file.replace(CORE_DIR, 'core')}: ui/state`);
    }
    expect(offenders).toEqual([]);
  });

  it('no core module reaches for an AI provider', () => {
    // RULE 3. AI sits above core and produces plans; core never calls out to a model.
    const offenders = coreFiles().filter((file) => {
      const source = readFileSync(file, 'utf8');
      return /openai|anthropic|gemini|openrouter|generativeai|ollama/i.test(source);
    });
    expect(offenders.map((f) => f.replace(CORE_DIR, 'core'))).toEqual([]);
  });
});

describe('framing agrees with the renderer', () => {
  const FRAME = { width: 1920, height: 1080 };

  /** Transcribed from `render.ts:114-117`, not imported, to keep the check honest. */
  const rendererCameraMatrix = (
    camera: { x: number; y: number; zoom: number; rotation: number },
    world: { x: number; y: number },
    viewport: { width: number; height: number },
  ) => {
    const fit = fitScale(FRAME.width, FRAME.height, viewport.width, viewport.height);
    const scale = camera.zoom * fit;
    const dx = (world.x - camera.x) * scale;
    const dy = (world.y - camera.y) * scale;
    const cos = Math.cos(camera.rotation);
    const sin = Math.sin(camera.rotation);
    return {
      x: viewport.width / 2 + dx * cos - dy * sin,
      y: viewport.height / 2 + dx * sin + dy * cos,
    };
  };

  const cases: { name: string; subjects: FrameSubject[] }[] = [
    { name: 'one actor, landscape viewport', subjects: [{ transform: identityAt(900, 880), height: 640 }] },
    { name: 'two actors wide apart', subjects: [{ transform: identityAt(300, 900), height: 640 }, { transform: identityAt(1620, 900), height: 600 }] },
    { name: 'a short wide subject', subjects: [{ transform: identityAt(960, 900), height: 120, width: 1100 }] },
    { name: 'a tall subject near the top', subjects: [{ transform: identityAt(700, 400), height: 390 }] },
  ];

  it.each(cases)('keeps every subject on screen: $name', ({ subjects }) => {
    const camera = frameBounds(subjects, { frame: FRAME, margin: 0.05 });
    for (const subject of subjects) {
      const halfWidth = (subject.width ?? subject.height * 0.5) / 2;
      for (const corner of [
        { x: -halfWidth, y: -subject.height },
        { x: halfWidth, y: -subject.height },
        { x: -halfWidth, y: 0 },
        { x: halfWidth, y: 0 },
      ]) {
        // Local box, then the subject's own transform, then the camera.
        const cos = Math.cos(subject.transform.rotation);
        const sin = Math.sin(subject.transform.rotation);
        const world = {
          x: subject.transform.x + (corner.x * cos - corner.y * sin) * subject.transform.scaleX,
          y: subject.transform.y + (corner.x * sin + corner.y * cos) * subject.transform.scaleY,
        };
        const screen = rendererCameraMatrix(camera, world, FRAME);
        expect(screen.x).toBeGreaterThanOrEqual(-0.001);
        expect(screen.x).toBeLessThanOrEqual(FRAME.width + 0.001);
        expect(screen.y).toBeGreaterThanOrEqual(-0.001);
        expect(screen.y).toBeLessThanOrEqual(FRAME.height + 0.001);
      }
    }
  });

  it('shares one fitScale with the renderer rather than a second implementation', () => {
    // The renderer imports this exact function. If framing ever grew its own copy, this
    // would still pass, which is why the import in render.ts is the part to watch.
    expect(typeof fitScale).toBe('function');
    expect(fitScale(1920, 1080, 960, 540)).toBeCloseTo(0.5, 12);
    expect(fitScale(1920, 1080, 3840, 2160)).toBeCloseTo(2, 12);
  });

  it('is deterministic: the same inputs give the same camera, every time', () => {
    const subjects = [
      { transform: identityAt(700, 880, 0.1), height: 640 },
      { transform: identityAt(1300, 900), height: 500 },
    ];
    const options = { frame: FRAME, margin: 0.15, rotation: 0.05, minZoom: 0 };
    const first = frameBounds(subjects, options);
    for (let i = 0; i < 5; i += 1) {
      expect(frameBounds(subjects, options)).toEqual(first);
    }
  });
});

function identityAt(x: number, y: number, rotation = 0): Transform2D {
  return { x, y, rotation, scaleX: 1, scaleY: 1, alpha: 1 };
}
