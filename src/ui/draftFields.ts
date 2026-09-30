/**
 * Commit-on-blur form state.
 *
 * Extracted from `DialoguePanel` because the camera panel needs exactly the same
 * behaviour, and a second copy of it would be a second thing to keep correct. RULE 6's
 * "one commit per gesture" is a property of every text field in the editor, not a detail
 * of one panel.
 *
 * The behaviour worth stating: the draft is local while the field has focus, so an
 * external change (an undo, a reload) cannot overwrite what is half-typed, and the
 * document never sees a keystroke it was not asked to accept.
 *
 * No components live here, deliberately: a file exporting both components and
 * non-components defeats React Fast Refresh, and the lint rule says so.
 */

import { useEffect, useRef, useState } from 'react';

export const inputClass =
  'w-full min-w-0 rounded border border-ink-700 bg-ink-950 px-1.5 py-1 text-[11px] text-ink-100 outline-none focus:border-zanza-500 disabled:opacity-40';

export const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface DraftField {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** A text field whose document edit happens on blur. */
export function useDraftField(value: string, onCommit: (next: string) => void): DraftField {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);

  return {
    value: draft,
    onChange: (event) => setDraft(event.target.value),
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      onCommit(draft);
    },
  };
}

/**
 * A numeric field, committed on blur, reporting unreadable input honestly.
 *
 * `Number('')` and `Number('  ')` are both 0, so an emptied field would silently write a
 * zero. They are rejected instead, and `invalid` is set whenever the draft holds
 * something that cannot be read — not only while focused, because a field left holding
 * nonsense should keep saying so after the blur that refused to accept it. Dropping the
 * edit without comment would teach the user that the field is broken.
 */
export function useDraftNumber(
  value: number,
  onCommit: (next: number) => void,
  round?: (n: number) => number,
): DraftField & { invalid: boolean } {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setDraft(String(value));
  }, [value]);

  return {
    value: draft,
    invalid: draft.trim() !== '' && !Number.isFinite(Number(draft)),
    onChange: (event) => setDraft(event.target.value),
    onFocus: () => {
      focused.current = true;
    },
    onBlur: () => {
      focused.current = false;
      const parsed = Number(draft);
      if (draft.trim() === '' || !Number.isFinite(parsed)) return;
      onCommit(round ? round(parsed) : parsed);
    },
  };
}
