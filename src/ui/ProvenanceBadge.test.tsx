import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProvenanceBadge } from './ProvenanceBadge';
import { anyAIProvenance } from '../lib/provenance';
import type { Provenance } from '../core/types';

const AI: Provenance = { actor: 'ai', provider: 'anthropic', model: 'claude-sonnet-4', at: '2026-10-16T00:00:00.000Z' };
const HUMAN: Provenance = { actor: 'human', at: '2026-10-16T00:00:00.000Z' };

describe('ProvenanceBadge (Phase 19 step 6)', () => {
  it('renders nothing for a human or absent provenance', () => {
    const { container: human } = render(<ProvenanceBadge provenance={HUMAN} />);
    expect(human.textContent).toBe('');
    const { container: none } = render(<ProvenanceBadge />);
    expect(none.textContent).toBe('');
  });

  it('marks an AI record and names the provider', () => {
    render(<ProvenanceBadge provenance={AI} />);
    expect(screen.getByText(/AI/)).toBeDefined();
    expect(screen.getByText(/anthropic/)).toBeDefined();
  });

  it('anyAIProvenance returns the first AI record, and undefined for none', () => {
    expect(anyAIProvenance([{ provenance: HUMAN }, { provenance: AI }])).toEqual(AI);
    expect(anyAIProvenance([{ provenance: HUMAN }, {}])).toBeUndefined();
    expect(anyAIProvenance([])).toBeUndefined();
  });
});
