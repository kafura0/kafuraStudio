import { useEffect, useRef, useState } from 'react';
import type { AudioDef, Id } from '../../core/types';
import { mediaIdFor, type MediaMeta } from '../../core/media/mediaStore';
import { mediaStore } from '../../state/mediaLibrary';

/**
 * AUDIO SLOTS — attach a file to a declared audio slot.
 *
 * The library ships audio assets with no file behind them, because recording the cast is a
 * production task. This panel is the other half of that honesty: it states which slots are
 * empty, lets the operator attach a real file, and reports what happened. A slot with
 * nothing behind it says "no recording" rather than being listed as though it were ready
 * (RULE 9).
 *
 * The panel holds no document state and performs no mutation itself. It is given the open
 * library and the three store actions as props, like every other panel: selecting a file
 * calls the store, the store writes bytes to the media store and commits the document, and
 * the engine reads them back. That is the only path, so an attachment cannot exist in the
 * store without a reference in the document, or the reverse.
 *
 * Bytes are read here and handed to the store, never held in component state: an
 * `ArrayBuffer` in a React state update is a large value the renderer would hold and diff.
 */
export interface AudioSlotPanelProps {
  /**
   * The resolved library, narrowed to the one collection this panel reads.
   *
   * Structural rather than a full `Project` because the audio slots moved to the series in
   * Phase 14. Passing the project would mean reading `project.assets.audio`, which is empty
   * for every series-owned show — the panel would render its honest-sounding "declares no
   * audio slots" message over a library that plainly has fifteen.
   */
  library: { audio: AudioDef[] } | null;
  onAttach: (audioId: Id, file: File) => Promise<void>;
  onClear: (audioId: Id) => void;
  onPreview: (audioId: Id) => Promise<boolean>;
  /**
   * Put the slot into the open scene.
   *
   * Separate from attaching because they are separate facts. A slot with bytes is a
   * recording that exists; a slot with a clip is a sound the scene plays. Only the second
   * reaches the engine and the mixdown, and the panel offers both rather than pretending one
   * implies the other.
   */
  onPlaceInScene: (audioId: Id) => void;
  /** True when this slot is already placed in the open scene, so the button can say so. */
  isPlaced?: (audioId: Id) => boolean;
}

export function AudioSlotPanel({
  library,
  onAttach,
  onClear,
  onPreview,
  onPlaceInScene,
  isPlaced,
}: AudioSlotPanelProps): React.JSX.Element | null {
  const [present, setPresent] = useState<Map<Id, MediaMeta>>(new Map());
  /**
   * Ids the store has actually answered for.
   *
   * Without this, "the read has not come back yet" and "the read came back empty" are the
   * same `undefined`, and the panel has to pick one word for both. It picked the alarming
   * one, so attaching a file showed `file referenced but missing from storage` for as long
   * as the IndexedDB read took — an alarm about data loss, raised by the act of saving it.
   * Absence is only a fact once a read has completed and found nothing.
   */
  const [resolved, setResolved] = useState<ReadonlySet<Id>>(new Set());

  const audioSlots = library?.audio ?? [];
  // Ids to look up. A slot with no `src` cannot be in the store, so asking about it would
  // be a pointless read on every render of a long library.
  const wanted = audioSlots
    .map((def) => mediaIdFor(def))
    .filter((id): id is string => id !== null)
    .join('|');

  // Re-read the store whenever the set of references changes. `wanted` is the dependency
  // because the array identity changes on every render while its contents do not.
  useEffect(() => {
    let live = true;
    const ids = wanted === '' ? [] : wanted.split('|');
    if (ids.length === 0) {
      setPresent(new Map());
      setResolved(new Set());
      return;
    }
    void (async () => {
      const store = mediaStore();
      const records = await Promise.all(
        ids.map(async (id) => [id, await store.get(id)] as const),
      );
      if (!live) return;
      const next = new Map<Id, MediaMeta>();
      const answered = new Set<Id>();
      for (const [id, record] of records) {
        answered.add(id);
        if (record) {
          const { data: _data, ...meta } = record;
          next.set(id, meta);
        }
      }
      setPresent(next);
      setResolved(answered);
    })();
    return () => {
      live = false;
    };
  }, [wanted]);

  if (library === null) return null;
  if (audioSlots.length === 0) {
    return (
      <section className="border-t border-ink-800 px-3 py-3">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Audio slots
        </h2>
        <p className="mt-1 text-[11px] text-ink-500">This library declares no audio slots.</p>
      </section>
    );
  }

  return (
    <section className="border-t border-ink-800 px-3 py-3" data-testid="audio-slot-panel">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        Audio slots
      </h2>
      <ul className="mt-2 space-y-2">
        {audioSlots.map((def) => {
          const id = mediaIdFor(def);
          return (
            <AudioSlotRow
              key={def.id}
              def={def}
              media={id === null ? undefined : present.get(id)}
              read={id !== null && resolved.has(id)}
              onAttach={onAttach}
              onClear={onClear}
              onPreview={onPreview}
              onPlaceInScene={onPlaceInScene}
              isPlaced={isPlaced?.(def.id) ?? false}
            />
          );
        })}
      </ul>
    </section>
  );
}

interface AudioSlotRowProps {
  def: AudioDef;
  /** Metadata for the attached file, or `undefined` when the slot holds nothing usable. */
  media: MediaMeta | undefined;
  /**
   * True once the media store has answered for this slot's reference.
   *
   * False means "still reading", which is not the same as "gone" — see the note on
   * `resolved` above.
   */
  read: boolean;
  onAttach: (audioId: Id, file: File) => Promise<void>;
  onClear: (audioId: Id) => void;
  onPreview: (audioId: Id) => Promise<boolean>;
  onPlaceInScene: (audioId: Id) => void;
  /** The open scene already carries a clip for this slot. */
  isPlaced: boolean;
}

function AudioSlotRow({
  def,
  media,
  read,
  onAttach,
  onClear,
  onPreview,
  onPlaceInScene,
  isPlaced,
}: AudioSlotRowProps): React.JSX.Element {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // A slot can claim media the store does not have — a copy-forward that never ran, a
  // record swept while the document kept its reference. That is not "empty", and it is not
  // "attached" either, so it gets its own message: the truth is that something is missing.
  // Only claimed *and read* counts, or the panel would cry wolf on every attach.
  const missing = def.src !== null && def.srcKind === 'local' && read && media === undefined;

  async function handleFile(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setMessage(null);
    try {
      await onAttach(def.id, file);
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview(): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const played = await onPreview(def.id);
      setMessage(played ? 'Playing.' : 'Nothing to play — this slot has no readable file.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="text-[11px]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-ink-300" title={def.name}>
          {def.name}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-ink-500">{def.kind}</span>
      </div>

      <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[10px] text-ink-500">
        {media ? (
          <>
            <span className="truncate text-ink-400" title={media.name}>
              {media.name}
            </span>
            <span aria-hidden>·</span>
            <span className="font-mono">
              {media.duration === null ? '?' : media.duration.toFixed(1)}s
            </span>
            <span aria-hidden>·</span>
            <span className="font-mono">{formatBytes(media.size)}</span>
          </>
        ) : missing ? (
          <span className="text-amber-500/80" data-testid="audio-missing-media">
            · file referenced but missing from storage
          </span>
        ) : def.src !== null ? (
          // Claimed, and the read is still in flight. Saying nothing alarming is the whole
          // requirement here: the previous state of this panel called it missing.
          <span className="text-ink-500" data-testid="audio-reading">
            · reading…
          </span>
        ) : (
          <span className="text-amber-500/80" data-testid="audio-no-file">
            · no recording
          </span>
        )}
      </p>

      <div className="mt-1 flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800 disabled:opacity-50"
        >
          {media ? 'Replace…' : 'Attach file…'}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="audio/*"
          className="hidden"
          data-testid={`audio-file-input-${def.id}`}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so re-picking the same file fires `change` again.
            event.target.value = '';
            void handleFile(file);
          }}
        />
        <button
          type="button"
          disabled={busy || !media}
          onClick={() => void handlePreview()}
          // Named for the slot, not just "Play": the transport bar has a Play button too,
          // and two controls with the same accessible name in one view are ambiguous to a
          // screen reader and to anything else asking "which Play?".
          aria-label={`Play ${def.name}`}
          className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800 disabled:opacity-50"
        >
          Play
        </button>
        <button
          type="button"
          disabled={busy || def.src === null}
          onClick={() => {
            onClear(def.id);
            setMessage(null);
          }}
          aria-label={`Clear audio for ${def.name}`}
          className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-400 hover:bg-ink-800 disabled:opacity-50"
        >
          Clear
        </button>
        {/*
          The scene button reads "In scene" once the clip exists, because a live-looking
          button that does nothing on the second click is how a sound gets doubled in an
          export without anyone deciding to double it.
        */}
        <button
          type="button"
          disabled={busy || def.src === null || isPlaced}
          onClick={() => {
            onPlaceInScene(def.id);
            setMessage(null);
          }}
          aria-label={`${isPlaced ? 'Already in' : 'Add'} ${def.name} to the open scene`}
          className="rounded border border-ink-700 px-1.5 py-0.5 text-[10px] text-ink-200 hover:bg-ink-800 disabled:opacity-50"
        >
          {isPlaced ? 'In scene' : 'Add to scene'}
        </button>
      </div>

      {message !== null && (
        <p className="mt-1 text-[10px] text-ink-400" role="status">
          {message}
        </p>
      )}
    </li>
  );
}

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(0)} kB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
