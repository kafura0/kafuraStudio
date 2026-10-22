import { describe, expect, it } from 'vitest';
import {
  MemoryPlanRepository,
  planActor,
  planRecordId,
  toPlanRecord,
} from './plans';
import { WORKED_EXAMPLE_PLAN } from '../../data/plans';
import type { PlanEnvelope } from '../plans/types';

function plan(over: Partial<PlanEnvelope> = {}): PlanEnvelope {
  return {
    planVersion: 1,
    kind: 'scene',
    title: 'A plan',
    createdAt: '2026-10-16T00:00:00.000Z',
    body: { sceneId: 'scene_0001' },
    ...over,
  };
}

describe('planRecordId', () => {
  it('is stable for the same envelope and differs between envelopes', () => {
    const a = plan();
    expect(planRecordId(a)).toBe(planRecordId(structuredClone(a)));
    expect(planRecordId(a)).not.toBe(planRecordId(plan({ title: 'A different plan' })));
  });

  it('is prefixed and fixed-width, so ids are recognisable and sortable', () => {
    expect(planRecordId(plan())).toMatch(/^plan_[0-9a-f]{8}$/);
  });
});

describe('planActor', () => {
  it('reads the provenance actor, defaulting to human', () => {
    expect(planActor(plan())).toBe('human');
    expect(planActor(plan({ provenance: { actor: 'ai', at: '2026-10-16T00:00:00.000Z' } }))).toBe('ai');
  });
});

describe('toPlanRecord', () => {
  it('keys the record by content and copies the envelope', () => {
    const envelope = plan();
    const record = toPlanRecord(envelope);
    expect(record.id).toBe(planRecordId(envelope));
    expect(record.planVersion).toBe(1);
    expect(record.envelope).toEqual(envelope);
    expect(record.envelope).not.toBe(envelope);
  });
});

describe('MemoryPlanRepository', () => {
  it('saves, loads and removes a record', async () => {
    const repository = new MemoryPlanRepository();
    const record = toPlanRecord(plan());

    expect(await repository.load(record.id)).toBeNull();
    await repository.save(record);
    expect(await repository.load(record.id)).toEqual(record);
    await repository.remove(record.id);
    expect(await repository.load(record.id)).toBeNull();
  });

  it('hands out copies, so a caller cannot mutate stored state', async () => {
    const repository = new MemoryPlanRepository();
    const record = toPlanRecord(plan());
    await repository.save(record);

    const loaded = await repository.load(record.id);
    (loaded!.envelope as { title: string }).title = 'mutated';
    expect((await repository.load(record.id))!.envelope.title).toBe('A plan');
  });

  it('lists summaries newest first, carrying title and actor', async () => {
    const repository = new MemoryPlanRepository();
    await repository.save(toPlanRecord(plan({ title: 'Older', createdAt: '2026-10-01T00:00:00.000Z' })));
    await repository.save(
      toPlanRecord(
        plan({
          title: 'Newer',
          createdAt: '2026-10-20T00:00:00.000Z',
          provenance: { actor: 'ai', at: '2026-10-20T00:00:00.000Z' },
        }),
      ),
    );

    expect(await repository.list()).toEqual([
      { id: planRecordId(plan({ title: 'Newer', createdAt: '2026-10-20T00:00:00.000Z', provenance: { actor: 'ai', at: '2026-10-20T00:00:00.000Z' } })), title: 'Newer', createdAt: '2026-10-20T00:00:00.000Z', actor: 'ai' },
      { id: planRecordId(plan({ title: 'Older', createdAt: '2026-10-01T00:00:00.000Z' })), title: 'Older', createdAt: '2026-10-01T00:00:00.000Z', actor: 'human' },
    ]);
  });

  it('overwrites rather than duplicates when the same plan is saved twice', async () => {
    const repository = new MemoryPlanRepository();
    await repository.save(toPlanRecord(WORKED_EXAMPLE_PLAN));
    await repository.save(toPlanRecord(WORKED_EXAMPLE_PLAN));
    expect(await repository.list()).toHaveLength(1);
  });
});
