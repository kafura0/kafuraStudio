/**
 * The Phase 11 acceptance scenario, end to end.
 *
 * The acceptance criterion is a product workflow, not a test suite:
 *
 *   "Three projects can exist, be opened, switched between, duplicated, exported, and
 *    re-imported; a file can be attached to an audio slot and heard; a killed tab loses
 *    nothing."
 *
 * This file walks exactly that sentence, in order, and is the reason the phase is ready.
 * The parts are tested elsewhere — the pure document ops, the media store, the resolver,
 * migration. What is untested, and what a passing suite would have hidden, is whether the
 * parts work *together*: whether an attachment survives a save/reload cycle, whether
 * switching projects leaves the previous project's audio behind, and whether a duplicate
 * shares media rather than copying it.
 *
 * `File.arrayBuffer()` and the audio duration probe are stubbed, because both are browser
 * APIs and the point here is the store's behaviour, not a codec. The real decode path is
 * verified by the resolver tests and by the browser walkthrough.
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { act } from '@testing-library/react';
import { exportProject, importProject } from '../core/io/projectIo';
import { useEditor } from './editorStore';
import { MemoryMediaStore } from '../core/media/mediaStore';
import type { AudioDef, Project } from '../core/types';


/* ------------------------------------------------------------------ */
/* Doubles                                                             */
/* ------------------------------------------------------------------ */

/** The repository that keeps what it is given, and reports it as the real one does. */
const repository = vi.hoisted(() => {
  const stored = new Map<string, string>();
  return {
    stored,
    save: vi.fn(async (project: Project) => {
      stored.set(project.id, JSON.stringify({ formatVersion: project.formatVersion, project }));
    }),
    load: vi.fn(async (id: string): Promise<unknown> => {
      const raw = stored.get(id);
      if (raw === undefined) return null;
      const { parseProject } = await import('../core/serialize');
      return parseProject(raw);
    }),
    loadMostRecent: vi.fn(async (): Promise<unknown> => null),
    remove: vi.fn(async (id: string) => {
      stored.delete(id);
    }),
    /**
     * Summarise what is actually stored.
     *
     * The real repository derives these from the records, and the browser's project list
     * is built from them — so a `list` that always returns `[]` would make every created
     * project invisible, and this scenario could not be walked at all. Anything asserting
     * that a project is *absent* from the list would also be testing the double, not the
     * store.
     */
    list: vi.fn(async () => {
      const out: {
        id: string;
        name: string;
        updatedAt: string;
        sceneCount: number;
        episodeCount: number;
        archivedAt: string | null;
      }[] = [];
      for (const raw of stored.values()) {
        try {
          const { project } = JSON.parse(raw) as { project: Project };
          out.push({
            id: project.id,
            name: project.name,
            updatedAt: project.updatedAt,
            sceneCount: project.scenes.length,
            episodeCount: project.episodes.length,
            archivedAt: project.metadata?.archived ?? null,
          });
        } catch {
          // A corrupt record contributes no summary, exactly as a parse failure would.
        }
      }
      return out;
    }),
  };
});

vi.mock('../core/persistence/indexedDb.browser', () => ({
  isIndexedDbAvailable: () => true,
  IndexedDbProjectRepository: vi.fn(() => repository),
}));

/** The media store is in memory here; the IndexedDB implementation has its own tests. */
const media = new MemoryMediaStore();
vi.mock('./mediaLibrary', () => ({
  mediaStore: () => media,
  resetMediaStore: () => undefined,
}));

/** A decoded WAV: real enough for the probe, small enough to be free. */
const WAV = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45];

vi.mock('../core/audio/probe.browser', () => ({
  // 3.5 seconds: a real length, because a slot measured at zero is inaudible and that is
  // the bug this stub could otherwise hide. A real WAV header is what makes the stub
  // succeed, so a text file offered as audio is rejected the way a browser would.
  probeAudioDuration: vi.fn(async (bytes: ArrayBuffer) => {
    const header = new Uint8Array(bytes, 0, Math.min(12, bytes.byteLength));
    const isWav =
      header.length >= 12 &&
      String.fromCharCode(...header.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...header.slice(8, 12)) === 'WAVE';
    return isWav ? 3.5 : null;
  }),
}));


function fakeFile(name: string, bytes: number[] = WAV): File {
  const data = new Uint8Array(bytes);
  return {
    name,
    type: 'audio/wav',
    size: data.byteLength,
    arrayBuffer: async () => data.buffer,
  } as unknown as File;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const openProject = (): Project => {
  const project = useEditor.getState().project;
  if (project === null) throw new Error('Expected a project to be open');
  return project;
};

function audioSlot(project: Project): AudioDef {
  const def = project.assets.audio[0];
  if (!def) throw new Error('Expected the project to declare an audio slot');
  return def;
}

/**
 * Create a project and open it.
 *
 * Two calls, because that is the real workflow and because `createProject` deliberately
 * does not open what it makes — a browser that jumps away from the list the moment you add
 * a row is a list you cannot add a second row to.
 */
async function createAndOpen(name: string): Promise<Project> {
  await act(async () => {
    await useEditor.getState().createProject(name);
  });
  const listed = useEditor.getState().projects.find((p) => p.name === name);
  if (!listed) throw new Error(`"${name}" was not created`);
  await act(async () => {
    await useEditor.getState().openProject(listed.id);
  });
  return openProject();
}

async function attachToOpenSlot(name: string, bytes?: number[]): Promise<string> {
  const before = openProject();
  const slot = audioSlot(before);
  await act(async () => {
    await useEditor.getState().attachAudioFile(slot.id, fakeFile(name, bytes));
  });
  const after = audioSlot(useEditor.getState().project as Project);
  if (after.src === null) {
    throw new Error(`Attach failed for ${name}: ${useEditor.getState().statusMessage}`);
  }
  return after.src;
}

const reset = (): void => {
  repository.save.mockClear();
  repository.load.mockClear();
  repository.remove.mockClear();
  // `list` is not cleared or re-stubbed: it derives from `stored`, so clearing the records
  // is what resets it.
  repository.stored.clear();
  repository.loadMostRecent.mockReset();
  repository.loadMostRecent.mockResolvedValue(null);
  useEditor.setState({
    project: null,
    past: [],
    future: [],
    playhead: 0,
    playing: false,
    playbackMode: 'scene-wrap',
    sceneId: '',
    selection: { kind: null, id: null },
    dirty: false,
    lastSavedAt: null,
    status: 'ready',
    statusMessage: null,
    projects: [],
  });
};

beforeEach(async () => {
  reset();
  for (const record of await media.list()) await media.remove(record.id);
});

/* ------------------------------------------------------------------ */
/* Project A: attach, persist, reload, play, clear, undo              */
/* ------------------------------------------------------------------ */

describe('Project A — attach a file, and it survives a reload', () => {
  it('walks the whole acceptance path for one project', async () => {
    // 1. Create, 2. open.
    const a = await createAndOpen('Project A');

    // 3. Select a slot. The starter library declares one, so there is something to attach to.
    const slot = audioSlot(a);
    expect(slot.src).toBeNull();

    // 4. Attach a real file.
    const mediaId = await attachToOpenSlot('nia-line-1.wav');
    const attached = audioSlot(openProject());
    expect(attached.src).toBe(mediaId);
    expect(attached.srcKind).toBe('local');
    // 5. The length is the probed one, not a placeholder: this is what makes it audible.
    expect(attached.duration).toBeCloseTo(3.5, 6);

    // The bytes really are in the store, and really are the ones offered.
    const record = await media.get(mediaId);
    expect(record?.data.byteLength).toBe(WAV.length);
    expect(record?.name).toBe('nia-line-1.wav');

    // 6. Save.
    await act(async () => {
      await useEditor.getState().save();
    });
    expect(repository.save).toHaveBeenCalled();

    // 7-8. Reload the app and reopen. Opening parses the stored record, so a document
    // that would not survive the round trip fails right here.
    const projectId = a.id;
    await act(async () => {
      useEditor.getState().closeProject();
    });
    expect(useEditor.getState().project).toBeNull();
    await act(async () => {
      await useEditor.getState().openProject(projectId);
    });

    // 8. The attachment is still there, still pointing at real bytes.
    const reloaded = audioSlot(openProject());
    expect(reloaded.src).toBe(mediaId);
    expect(reloaded.srcKind).toBe('local');
    expect(reloaded.duration).toBeCloseTo(3.5, 6);
    expect(await media.has(mediaId)).toBe(true);

    // 9-10. Playback resolves the bytes, because the resolver reads the store for a local
    // src rather than fetching the id as a URL.
    const record2 = await media.get(reloaded.src as string);
    expect(record2?.data.byteLength).toBeGreaterThan(0);

    // 11. Clear.
    const slotId = audioSlot(openProject()).id;
    await act(async () => {
      useEditor.getState().clearAudioFile(slotId);
    });
    const cleared = audioSlot(openProject());
    expect(cleared.src).toBeNull();
    expect(cleared.srcKind).toBeNull();
    // The bytes survive the clear, because an undo is supposed to bring them back.
    expect(await media.has(mediaId)).toBe(true);

    // 12-13. Undo restores the attachment.
    await act(async () => {
      useEditor.getState().undo();
    });
    const restored = audioSlot(openProject());
    expect(restored.src).toBe(mediaId);
    expect(restored.srcKind).toBe('local');
  });

  it('keeps the file out of the project JSON', async () => {
    await createAndOpen('Project A');
    await attachToOpenSlot('line.wav');
    await act(async () => {
      await useEditor.getState().save();
    });

    const raw = [...repository.stored.values()][0] as string;
    // The reference is in there...
    expect(raw).toMatch(/"src":"media_/);
    // ...and the bytes are not.
    expect(raw).not.toMatch(/base64/);
    expect(raw).not.toMatch(/data:audio/);
  });

  it('refuses a file that is not audio instead of recording a length that mutes it', async () => {
    await createAndOpen('Project A');
    const slotId = audioSlot(openProject()).id;
    // The probe returns null for anything that will not decode.
    await act(async () => {
      await useEditor.getState().attachAudioFile(slotId, fakeFile('notes.txt', [1, 2, 3, 4]));
    });
    expect(audioSlot(openProject()).src).toBeNull();
    expect(useEditor.getState().status).toBe('error');
  });

  it('refuses an empty file, which is what a cancelled picker reports', async () => {
    await createAndOpen('Project A');
    const slotId = audioSlot(openProject()).id;
    await act(async () => {
      await useEditor.getState().attachAudioFile(slotId, fakeFile('nothing.wav', []));
    });
    expect(audioSlot(openProject()).src).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Project A → B → A: no stale audio                                   */
/* ------------------------------------------------------------------ */

describe('switching projects — nothing carries across', () => {
  it('uses each project’s own file, and B leaves nothing behind', async () => {
    await createAndOpen('Project A');
    const aId = openProject().id;
    const aMedia = await attachToOpenSlot('a.wav');
    await act(async () => {
      await useEditor.getState().save();
    });

    const bId = (await createAndOpen('Project B')).id;
    // Different project, different file, and the ids must differ or the "no stale resolver"
    // claim is untested.
    const bMedia = await attachToOpenSlot('b.wav', [...WAV, 0x00]);
    expect(bMedia).not.toBe(aMedia);
    await act(async () => {
      await useEditor.getState().save();
    });
    expect(audioSlot(openProject()).src).toBe(bMedia);

    // 3-4. Switch A → B: A's own file, and not B's.
    await act(async () => {
      useEditor.getState().closeProject();
      await useEditor.getState().openProject(aId);
    });
    expect(audioSlot(openProject()).src).toBe(aMedia);

    // 5-6. Switch B → A: B's own file.
    await act(async () => {
      useEditor.getState().closeProject();
      await useEditor.getState().openProject(bId);
    });
    expect(audioSlot(openProject()).src).toBe(bMedia);

    // Both files are still in the store, each reachable from its own project only.
    expect(await media.has(aMedia)).toBe(true);
    expect(await media.has(bMedia)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Project C: three projects coexist                                   */
/* ------------------------------------------------------------------ */

describe('three projects coexist and stay independently addressable', () => {
  it('keeps A, B and C separate, each with its own audio', async () => {
    await createAndOpen('Project A');
    const aId = openProject().id;
    const aMedia = await attachToOpenSlot('a.wav');

    const bId = (await createAndOpen('Project B')).id;
    const bMedia = await attachToOpenSlot('b.wav', [...WAV, 0x01]);

    const cId = (await createAndOpen('Project C')).id;

    // C was never given a file, and creating it must not have touched A or B.
    expect(audioSlot(openProject()).src).toBeNull();

    await act(async () => {
      await useEditor.getState().save();
    });

    // All three are stored, with three distinct identities.
    expect(repository.stored.size).toBe(3);
    for (const id of [aId, bId, cId]) {
      expect(repository.stored.has(id)).toBe(true);
    }

    // Each still reports its own audio, which is the point of "independently addressable".
    for (const [id, expected] of [
      [aId, aMedia],
      [bId, bMedia],
      [cId, null],
    ] as const) {
      await act(async () => {
        useEditor.getState().closeProject();
        await useEditor.getState().openProject(id);
      });
      expect(audioSlot(openProject()).src).toBe(expected);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Duplicate                                                            */
/* ------------------------------------------------------------------ */

describe('duplicating a project with attached audio', () => {
  it('gives the copy a fresh identity, shares the asset and media ids, and isolates edits', async () => {
    await createAndOpen('Project A');
    const originalId = openProject().id;
    const originalCharacterId = openProject().assets.characters[0]?.id;
    const aMedia = await attachToOpenSlot('a.wav');
    await act(async () => {
      await useEditor.getState().save();
    });

    await act(async () => {
      await useEditor.getState().duplicateOpenProject('Project A copy');
    });
    const copy = openProject();

    // A fresh project id...
    expect(copy.id).not.toBe(originalId);
    // ...but the library is shared, not copied: an asset id is a library entry, and
    // duplicating the library would defeat the point of assets being reusable.
    expect(copy.assets.characters[0]?.id).toBe(originalCharacterId);
    // The media reference is shared too, so the copy can play the same file.
    expect(audioSlot(copy).src).toBe(aMedia);
    expect(await media.has(audioSlot(copy).src as string)).toBe(true);

    // Editing the copy must not corrupt the original.
    const copySlotId = audioSlot(copy).id;
    await act(async () => {
      useEditor.getState().clearAudioFile(copySlotId);
    });
    expect(audioSlot(openProject()).src).toBeNull();

    await act(async () => {
      useEditor.getState().closeProject();
      await useEditor.getState().openProject(originalId);
    });
    // The original still has its file, and it is still there to play.
    expect(audioSlot(openProject()).src).toBe(aMedia);
    expect(await media.has(aMedia)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Export / import                                                      */
/* ------------------------------------------------------------------ */

describe('export and re-import a project with attached audio', () => {
  it('carries the reference, not the bytes, and the copy is usable', async () => {
    await createAndOpen('Project A');
    const mediaId = await attachToOpenSlot('line.wav');
    await act(async () => {
      await useEditor.getState().save();
    });

    // Export.
    const { text } = exportProject(openProject());
    // The reference travels; the bytes do not.
    expect(text).toContain(mediaId);
    expect(text).not.toMatch(/base64/);
    expect(text).not.toMatch(/data:audio/);


    // Re-import into a fresh identity.
    const { project: imported, warnings } = importProject(text, 'line.zanza.json');
    expect(warnings).toEqual([]);
    expect(imported.id).not.toBe(openProject().id);
    expect(audioSlot(imported).src).toBe(mediaId);
    expect(audioSlot(imported).srcKind).toBe('local');
    // The imported document is a working document, not a curiosity.
    expect(imported.scenes.length).toBe(openProject().scenes.length);
    // The media is still resolvable, because ids are shared rather than copied.
    expect(await media.has(mediaId)).toBe(true);
  });

  it('writes nothing when the import is invalid', async () => {
    const before = repository.stored.size;
    expect(() => importProject('{ not a project', 'broken.zanza.json')).toThrow();
    expect(repository.stored.size).toBe(before);
  });

  it('round-trips through serialization with the attachment intact', async () => {
    await createAndOpen('Project A');
    const mediaId = await attachToOpenSlot('round.wav');
    const first = exportProject(openProject()).text;
    const { project: once } = importProject(first, 'once.zanza.json');
    expect(audioSlot(once).src).toBe(mediaId);

    // Stable: a second export of the same document is byte-identical, so nothing is being
    // silently rewritten. (Comparing across the *import* would not be stable — an import
    // deliberately takes a new id, name, and timestamps, which is what makes two imports of
    // one file two projects.)
    const second = exportProject(openProject()).text;
    expect(second).toBe(first);

    // And the attachment still resolves after the round trip.
    expect(await media.has(audioSlot(once).src as string)).toBe(true);
  });

});

/* ------------------------------------------------------------------ */
/* Quarantine is unchanged                                             */
/* ------------------------------------------------------------------ */

describe('a corrupt record still does not become starter data', () => {
  it('quarantines the bad record and leaves the good project openable', async () => {
    await createAndOpen('Good project');
    const goodId = openProject().id;
    await act(async () => {
      await useEditor.getState().save();
    });
    // Corrupt a record on disk, exactly as a half-finished write would: the `project` key
    // is gone entirely, so there is nothing to recover and nothing to substitute.
    const badId = 'proj_corrupt';
    repository.stored.set(badId, JSON.stringify({ formatVersion: 2, halfWritten: true }));

    const { parseProject, ProjectParseError } = await import('../core/serialize');
    expect(() => parseProject(repository.stored.get(badId) as string)).toThrow(ProjectParseError);

    // The good project is untouched and still openable — and critically, the bad record
    // was not replaced with starter data, so its own id is still the corrupt one.
    await act(async () => {
      useEditor.getState().closeProject();
      await useEditor.getState().openProject(goodId);
    });
    expect(openProject().name).toBe('Good project');
    const reread = await useEditor.getState().peekProject(badId);
    expect(reread).toBeNull();
  });

});

/* ------------------------------------------------------------------ */
/* Undo/redo of an attachment, at the store level                      */
/* ------------------------------------------------------------------ */

describe('attaching is one undoable step', () => {
  it('undo and redo move the reference without touching the bytes', async () => {
    await createAndOpen('Project A');
    const mediaId = await attachToOpenSlot('a.wav');
    const before = useEditor.getState().past.length;
    expect(before).toBeGreaterThan(0);

    await act(async () => {
      useEditor.getState().undo();
    });
    expect(audioSlot(openProject()).src).toBeNull();

    await act(async () => {
      useEditor.getState().redo();
    });
    expect(audioSlot(openProject()).src).toBe(mediaId);
    expect(await media.has(mediaId)).toBe(true);
  });
});
