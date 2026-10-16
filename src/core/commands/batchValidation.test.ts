/**
 * P9 — end-of-batch validation is one pass, not one per command (ARCHITECTURE_SPEC.md §22.3,
 * §22.4). §8.3 originally said `applyCommands` validates after every command; §22.3
 * supersedes it precisely because that is O(200 × document) on a 200-command plan. This
 * file pins the decision two ways:
 *
 *  1. **Deterministically.** `validateProject` is counted through a wrapping mock. A
 *     200-command fold calls it exactly once; the same 200 commands applied one at a time
 *     call it 200 times. That is the property the performance decision buys, and it cannot
 *     flake.
 *  2. **As a guard.** The same 200-command fold must finish well inside a generous ceiling,
 *     so a future regression that re-introduces per-command validation (or an O(n²) fold)
 *     fails loudly rather than silently.
 *
 * The document is deliberately small, so the ceiling catches an algorithmic mistake, not
 * machine speed. It is not a benchmark.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Invariants from '../document/invariants';
import type { Command, CommandContext, CommandResult } from './types';

const calls = vi.hoisted(() => ({ validate: 0 }));

vi.mock('../document/invariants', async (importOriginal) => {
  const actual = await importOriginal<typeof Invariants>();
  return {
    ...actual,
    validateProject: (...args: Parameters<typeof actual.validateProject>) => {
      calls.validate += 1;
      return actual.validateProject(...args);
    },
  };
});

import { createProject } from '../document/factories';
import type { Project } from '../types';
import { applyCommand, applyCommands } from './index';

const BATCH = 200;
const CLOCK = (): string => '2026-01-01T00:00:00.000Z';

/** 200 CreateEpisode commands: no library dependency, each a real document edit. */
function commands(): readonly Command[] {
  return Array.from({ length: BATCH }, (_, n) => ({ kind: 'CreateEpisode', title: `Cut ${n}` }));
}

/** A stateful allocator, so every id in a run is unique. */
function countingAllocator() {
  let i = 0;
  return (prefix: string): string => `${prefix}_${i++}`;
}

function ctxFor(project: Project, allocate: (prefix: string) => string): CommandContext {
  return { project, series: null, allocate, now: CLOCK };
}

/** Apply `cmds` as single commands, threading each result into the next. */
function applyOneByOne(base: Project, cmds: readonly Command[], allocate: (prefix: string) => string): Project {
  let project = base;
  for (const command of cmds) {
    const result: CommandResult = applyCommand(command, ctxFor(project, allocate));
    if (!result.ok) throw new Error(result.error.message);
    project = result.project;
  }
  return project;
}

describe('P9 — a 200-command fold validates the document once (§22.3, §22.4)', () => {
  beforeEach(() => {
    calls.validate = 0;
  });

  it('applyCommands folds 200 commands and validates exactly once', () => {
    const project = createProject('Batch');
    const result = applyCommands(commands(), ctxFor(project, countingAllocator()));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(calls.validate).toBe(1);
    expect(result.project.episodes).toHaveLength(project.episodes.length + BATCH);
  });

  it('applying the same 200 commands one at a time validates 200 times', () => {
    const base = createProject('Batch');
    applyOneByOne(base, commands(), countingAllocator());
    // The contrast is the point: the per-command loop is the O(200 × document) shape §22.3
    // exists to avoid, and the fold above is the one-pass answer.
    expect(calls.validate).toBe(BATCH);
  });

  it('the fold and the one-at-a-time loop reach the same document', () => {
    const base = createProject('Batch');
    const folded = applyCommands(commands(), ctxFor(base, countingAllocator()));
    expect(folded.ok).toBe(true);
    if (!folded.ok) return;
    // Both allocators start at zero and see the same clock, so the fold is not merely
    // equivalent to the loop — it is identical.
    const stepped = applyOneByOne(base, commands(), countingAllocator());
    expect(folded.project).toEqual(stepped);
  });

  it('a 200-command fold stays far inside the performance ceiling', () => {
    const project = createProject('Batch');
    const start = performance.now();
    const result = applyCommands(commands(), ctxFor(project, countingAllocator()));
    const elapsed = performance.now() - start;
    expect(result.ok).toBe(true);
    // A tiny document: even a slow CI machine folds this in single-digit milliseconds. The
    // 2 s ceiling only trips on an algorithmic regression, never on hardware.
    expect(elapsed).toBeLessThan(2000);
  });
});
