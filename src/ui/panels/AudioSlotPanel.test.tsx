/**
 * The audio slot panel.
 *
 * What the operator is *told* is the point of this panel, and it is where an
 * implementation that half-works does its damage: a slot that lists as attached while
 * nothing is behind it, or a clear button that appears to work and does not. The store
 * tests cover what attaching does to a document; these cover what the screen says about it.
 *
 * The three states a slot can be in are all visible, and all three are honest:
 * empty, attached, and — the one a naive implementation misses — *referencing media that is
 * not in storage*, which is neither of the other two.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { AudioSlotPanel } from './AudioSlotPanel';
import { starterAssetLibrary } from '../../data/starter';
import { attachAudioMedia } from '../../core/document/projectOps';
import { createProject } from '../../core/document/factories';
import { MemoryMediaStore, type MediaRecord } from '../../core/media/mediaStore';
import type { AudioDef, Project } from '../../core/types';

const media = new MemoryMediaStore();
vi.mock('../../state/mediaLibrary', () => ({
  mediaStore: () => media,
  resetMediaStore: () => undefined,
  MEDIA_DB_NAME: 'zanza-studio',
}));

function projectWith(def: AudioDef): Project {
  return {
    ...createProject('A'),
    assets: { ...createProject('A').assets, audio: [def] },
  };
}

const emptySlot: AudioDef = {
  id: 'audio.1',
  name: 'Room tone',
  kind: 'ambience',
  src: null,
  srcKind: null,
  duration: 0,
  tags: [],
};

function record(id: string, over: Partial<MediaRecord> = {}): MediaRecord {
  return {
    id,
    name: 'room-tone.wav',
    type: 'audio/wav',
    size: 2048,
    createdAt: '2026-01-01T00:00:00.000Z',
    duration: 4.5,
    data: new ArrayBuffer(8),
    ...over,
  };
}

beforeEach(async () => {
  for (const meta of await media.list()) await media.remove(meta.id);
});

describe('an empty slot', () => {
  it('says so, rather than implying a recording exists', async () => {
    render(
      <AudioSlotPanel
        project={projectWith(emptySlot)}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('audio-no-file')).toBeInTheDocument();
  });

  it('cannot be cleared, because there is nothing to clear', async () => {
    render(
      <AudioSlotPanel
        project={projectWith(emptySlot)}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    const clear = await screen.findByRole('button', { name: 'Clear audio for Room tone' });
    expect(clear).toBeDisabled();
  });

  it('cannot be previewed, because a slot with no file would be silence', async () => {
    render(
      <AudioSlotPanel
        project={projectWith(emptySlot)}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    const play = await screen.findByRole('button', { name: 'Play Room tone' });
    expect(play).toBeDisabled();
  });
});

describe('an attached slot', () => {
  it('shows the filename, the measured length, and the size', async () => {
    await media.put(record('media_1'));
    const attached = attachAudioMedia(projectWith(emptySlot), 'audio.1', 'media_1', 4.5);
    render(
      <AudioSlotPanel
        project={attached}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(await screen.findByText('room-tone.wav')).toBeInTheDocument();
    expect(screen.getByText('4.5s')).toBeInTheDocument();
    expect(screen.getByText('2 kB')).toBeInTheDocument();
    expect(screen.queryByTestId('audio-no-file')).not.toBeInTheDocument();
  });

  it('enables preview and clear, because both now do something', async () => {
    await media.put(record('media_1'));
    const attached = attachAudioMedia(projectWith(emptySlot), 'audio.1', 'media_1', 4.5);
    render(
      <AudioSlotPanel
        project={attached}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Play Room tone' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Clear audio for Room tone' })).toBeEnabled();
  });

  it('reports a preview that played nothing instead of claiming success', async () => {
    await media.put(record('media_1'));
    const attached = attachAudioMedia(projectWith(emptySlot), 'audio.1', 'media_1', 4.5);
    render(
      <AudioSlotPanel
        project={attached}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(async () => false)}
        onPlaceInScene={vi.fn()}
      />,
    );
    const play = await screen.findByRole('button', { name: 'Play Room tone' });
    play.click();
    await waitFor(() => {
      expect(screen.getByRole('status').textContent).toMatch(/no readable file/i);
    });
  });

  it('calls onClear, and does not clear the document itself', async () => {
    await media.put(record('media_1'));
    const attached = attachAudioMedia(projectWith(emptySlot), 'audio.1', 'media_1', 4.5);
    const onClear = vi.fn();
    render(
      <AudioSlotPanel
        project={attached}
        onAttach={vi.fn()}
        onClear={onClear}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    (await screen.findByRole('button', { name: 'Clear audio for Room tone' })).click();
    // The panel asks; the store decides. A panel that mutated the document directly would
    // bypass `commit` and take undo with it.
    expect(onClear).toHaveBeenCalledWith('audio.1');
  });
});

describe('a slot whose media is missing from storage', () => {
  it('says the file is missing, which is neither "empty" nor "attached"', async () => {
    // The document references media the store does not have: a copy-forward that never ran,
    // or a record reclaimed while a document still pointed at it.
    const attached = attachAudioMedia(projectWith(emptySlot), 'audio.1', 'media_gone', 4.5);
    render(
      <AudioSlotPanel
        project={attached}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(await screen.findByTestId('audio-missing-media')).toBeInTheDocument();
    expect(screen.queryByTestId('audio-no-file')).not.toBeInTheDocument();
  });

  it('still allows a clear, which is the only way out of that state', async () => {
    const attached = attachAudioMedia(projectWith(emptySlot), 'audio.1', 'media_gone', 4.5);
    render(
      <AudioSlotPanel
        project={attached}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(await screen.findByRole('button', { name: 'Clear audio for Room tone' })).toBeEnabled();
  });
});

describe('the panel in other states', () => {
  it('renders nothing when no project is open', () => {
    const { container } = render(
      <AudioSlotPanel
        project={null}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('says a project with no slots has none, rather than showing an empty box', () => {
    const project = { ...createProject('A'), assets: starterAssetLibrary() };
    render(
      <AudioSlotPanel
        project={{ assets: { audio: [] } }}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(project.assets.audio).toHaveLength(1); // the starter declares one
    expect(screen.getByText(/declares no audio slots/i)).toBeInTheDocument();
  });

  it('lists every slot in the library', async () => {
    const many: AudioDef[] = [
      { ...emptySlot, id: 'a', name: 'Room tone' },
      { ...emptySlot, id: 'b', name: 'Line 1' },
      { ...emptySlot, id: 'c', name: 'Line 2' },
    ];
    render(
      <AudioSlotPanel
        project={{ assets: { audio: many } }}
        onAttach={vi.fn()}
        onClear={vi.fn()}
        onPreview={vi.fn(() => Promise.resolve(true))}
        onPlaceInScene={vi.fn()}
      />,
    );
    expect(await screen.findByText('Room tone')).toBeInTheDocument();
    expect(screen.getByText('Line 1')).toBeInTheDocument();
    expect(screen.getByText('Line 2')).toBeInTheDocument();
  });
});
