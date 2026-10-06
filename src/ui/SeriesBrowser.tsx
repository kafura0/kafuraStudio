/**
 * THE SERIES BROWSER.
 *
 * Phase 14 made the workspace two-scoped: a series is the reusable show library, and a
 * project is one production inside it. This tab is where a show itself is managed — listed,
 * created, renamed and removed — because the project tab is the wrong place for a row whose
 * deletion is a decision about every project that names it.
 *
 * Presentation and wiring only. Every action is a store call; the refusals the store raises
 * (a deletion while projects still reference it, an asset removal while a scene still uses
 * it) land in the same `statusMessage` strip the project browser uses.
 */

import { useEffect, useState } from 'react';
import { useEditor } from '../state/editorStore';
import type { SeriesSummary } from '../core/persistence/repository';

function formatDate(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  return new Date(at).toLocaleString();
}

export function SeriesBrowser(): React.JSX.Element {
  const seriesList = useEditor((s) => s.seriesList);
  const status = useEditor((s) => s.status);
  const statusMessage = useEditor((s) => s.statusMessage);
  const createSeries = useEditor((s) => s.createSeries);
  const renameSeries = useEditor((s) => s.renameSeries);
  const deleteSeries = useEditor((s) => s.deleteSeries);
  const removeSeriesAsset = useEditor((s) => s.removeSeriesAsset);
  const createProject = useEditor((s) => s.createProject);
  const refreshSeries = useEditor((s) => s.refreshSeries);
  const clearStatus = useEditor((s) => s.clearStatus);

  const [name, setName] = useState('');

  // The listing is reloaded when the tab appears, the same way the Projects tab reloads its
  // own. `refreshProjects` runs on the browser mount; this is the series counterpart, and a
  // series created in another tab has to show up here without a manual reload.
  useEffect(() => {
    void refreshSeries();
  }, [refreshSeries]);

  const onRename = async (summary: SeriesSummary): Promise<void> => {
    const next = window.prompt('Series name', summary.name);
    if (next === null) return;
    await renameSeries(summary.id, next);
  };

  const onDelete = async (summary: SeriesSummary): Promise<void> => {
    const confirmed = window.confirm(
      `Delete "${summary.name}"?\n\n` +
        `This removes the show and its library from this browser. It is refused while any ` +
        `project still belongs to it, so a referenced show cannot be destroyed by accident.`,
    );
    if (!confirmed) return;
    await deleteSeries(summary.id);
  };

  const onNewProjectHere = async (seriesId: string): Promise<void> => {
    const title = window.prompt('Project name', 'Episode 001');
    if (title === null || title.trim() === '') return;
    // Consistent with the Projects tab's own "New project": the row is created, listed and
    // left to be opened — a browser that jumps away the moment a row is added is a list you
    // cannot add a second row to.
    await createProject(title.trim(), seriesId);
  };

  const onRemoveAsset = async (summary: SeriesSummary): Promise<void> => {
    const collection = window.prompt(
      `Remove an asset from "${summary.name}".\n\nCollection (characters | environments | ` +
        `poses | expressions | props | audio), then a space, then the asset id. Leave the ` +
        `collection blank to use "characters".`,
    );
    if (collection === null) return;
    const [kind = 'characters', ...rest] = collection.trim().split(/\s+/);
    const assetId = rest.join(' ');
    if (assetId === '') return;
    const collections = [
      'characters',
      'environments',
      'poses',
      'expressions',
      'props',
      'audio',
    ] as const;
    const library = collections.find((c) => c === kind);
    if (!library) {
      window.alert(`Unknown collection "${kind}". Choose from ${collections.join(', ')}.`);
      return;
    }
    await removeSeriesAsset(summary.id, library, assetId);
  };

  const busy = status === 'loading';

  return (
    <div>
      {statusMessage !== null && (
        <div
          role="status"
          className="mb-6 flex items-start gap-3 rounded border border-amber-700 bg-amber-950/40 px-3 py-2 text-sm text-amber-200"
        >
          <p className="flex-1">{statusMessage}</p>
          <button
            type="button"
            onClick={clearStatus}
            aria-label="Dismiss message"
            className="rounded px-1 text-amber-300 hover:bg-amber-900"
          >
            ×
          </button>
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-xs text-ink-400">
          Series name
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                void createSeries(name);
                setName('');
              }
            }}
            placeholder="The second show…"
            className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
          />
        </label>
        <button
          type="button"
          onClick={() => {
            void createSeries(name);
            setName('');
          }}
          disabled={busy}
          className="rounded bg-zanza-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-zanza-500 disabled:opacity-40"
        >
          New series
        </button>
      </div>

      <p className="mb-3 border-b border-ink-800 pb-2 text-xs text-ink-500">
        A series is the show that owns the reusable library. Projects inside it resolve their
        characters, sets and poses from its library and can override any asset they need to.
      </p>

      {seriesList.length === 0 ? (
        <p className="rounded border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-ink-400">
          No series yet. Name one above and choose “New series”.
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {seriesList.map((summary) => (
            <li
              key={summary.id}
              className="flex items-center gap-4 rounded border border-ink-800 bg-ink-900 px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{summary.name}</p>
                <p className="text-xs text-ink-500">
                  {summary.projectCount === null
                    ? 'projects unknown'
                    : `${summary.projectCount} project${summary.projectCount === 1 ? '' : 's'}`}{' '}
                  · {formatDate(summary.updatedAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void onNewProjectHere(summary.id)}
                disabled={busy}
                className="rounded bg-zanza-600 px-3 py-1.5 text-xs font-medium text-ink-950 hover:bg-zanza-500 disabled:opacity-40"
              >
                New project here
              </button>
              <button
                type="button"
                onClick={() => void onRename(summary)}
                className="rounded px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
              >
                Rename
              </button>
              <button
                type="button"
                onClick={() => void onRemoveAsset(summary)}
                className="rounded px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
              >
                Remove asset…
              </button>
              <button
                type="button"
                onClick={() => void onDelete(summary)}
                className="rounded px-2 py-1.5 text-xs text-red-300 hover:bg-ink-800"
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}