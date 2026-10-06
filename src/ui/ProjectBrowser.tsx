/**
 * THE PROJECT BROWSER.
 *
 * What you are looking at when no project is open. Every project in the local workspace
 * is here, and every lifecycle operation the phase promises — open, create, duplicate,
 * import, export, archive, delete — is reachable from this one screen.
 *
 * Presentation and wiring only: every action is a store call, and the file APIs are
 * handled here because the browser owns them, not core.
 */

import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { isIndexedDbAvailable } from '../core/persistence/indexedDb.browser';
import type { ProjectSummary } from '../core/persistence/repository';
import { SeriesBrowser } from './SeriesBrowser';

/**
 * The extension this product ships under.
 *
 * A product decision, so it lives with the UI rather than in core. The alternative —
 * hardcoding it in the IO layer — makes the content-blind test fail, which is exactly
 * what that test is for.
 */
const FILE_EXTENSION = '.zanza.json';

function formatDate(iso: string): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return '';
  return new Date(at).toLocaleString();
}

export function ProjectBrowser(): React.JSX.Element {
  const projects = useEditor((s) => s.projects);
  const status = useEditor((s) => s.status);
  const statusMessage = useEditor((s) => s.statusMessage);
  const openProject = useEditor((s) => s.openProject);
  const createProject = useEditor((s) => s.createProject);
  const deleteProject = useEditor((s) => s.deleteProject);
  const archiveProject = useEditor((s) => s.archiveProject);
  const addEpisodeToProject = useEditor((s) => s.addEpisodeToProject);
  const importProjectText = useEditor((s) => s.importProjectText);
  const exportProjectFile = useEditor((s) => s.exportProjectFile);
  const refreshProjects = useEditor((s) => s.refreshProjects);
  const refreshSeries = useEditor((s) => s.refreshSeries);
  const seriesList = useEditor((s) => s.seriesList);
  const clearStatus = useEditor((s) => s.clearStatus);

  const [name, setName] = useState('');
  const [view, setView] = useState<'projects' | 'series'>('projects');
  const [seriesId, setSeriesId] = useState<string>('__free__');
  const [showArchived, setShowArchived] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    void refreshProjects();
    void refreshSeries();
  }, [refreshProjects, refreshSeries]);

  // Archive means "hidden from the default list", so the default list is the live ones.
  // The archived rows are one click away rather than gone, because a project that can be
  // hidden but never found again is a delete with a kinder button.
  const live = projects.filter((p) => p.archivedAt === null);
  const archived = projects.filter((p) => p.archivedAt !== null);
  const visible = showArchived ? archived : live;

  const onExport = async (id: string): Promise<void> => {
    // Export reads the project from storage rather than from the open editor, because the
    // open editor holds nothing when the browser is showing. Reading it without opening it
    // keeps the browser's scroll position and selection intact.
    //
    // The store assembles the file because it can read the series the project names as well
    // as the project itself; the browser only has a file extension to contribute.
    const result = await exportProjectFile(id, { extension: FILE_EXTENSION });
    if (result === null) return;
    const { text, filename } = result;
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    // Revoking immediately can cancel the download in some browsers, so it is deferred
    // past the current task.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const onImportFile = async (file: File): Promise<void> => {
    const text = await file.text();
    await importProjectText(text, file.name);
  };

  /**
   * Add an episode, asking for its title first.
   *
   * `window.prompt` for the same reason as `window.confirm` below: it is the one control a
   * homemade version cannot be mistaken for, and the default it offers is a usable name
   * rather than an empty box the user has to guess the format of.
   */
  const onAddEpisode = async (id: string): Promise<void> => {
    const title = window.prompt('Episode title', 'New Episode');
    // `null` is cancel. An empty string is not: the store falls back to the same default.
    if (title === null) return;
    await addEpisodeToProject(id, title);
  };

  /**
   * Delete, after the operator has been told exactly what is going.
   *
   * `window.confirm` is the right tool rather than a homemade dialog: it is the only
   * confirmation that cannot be styled into looking like another button, and the message
   * is forced to name the project, so "are you sure?" can never be answered without
   * knowing what is being destroyed. Delete removes the project and its stored audio;
   * there is no undo for it and no quarantine, which is why it is behind a confirmation
   * and archive is the button next to it.
   */
  const onDelete = async (summary: ProjectSummary): Promise<void> => {
    const confirmed = window.confirm(
      `Delete "${summary.name}"?\n\n` +
        `This permanently removes the project and its ${summary.sceneCount} scene(s) from this ` +
        `browser. It cannot be undone. Use Archive instead to hide it and keep it.`,
    );
    if (!confirmed) return;
    await deleteProject(summary.id);
  };

  const busy = status === 'loading';

  return (
    <div className="h-full overflow-y-auto bg-ink-950 px-8 py-10 text-ink-100">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 flex items-baseline justify-between">
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-zanza-500">ZANZA STUDIO</h1>
            <p className="mt-1 text-sm text-ink-400">Projects</p>
          </div>
          <button
            type="button"
            onClick={() => void createProject(name, seriesId === '__free__' ? null : seriesId)}
            className="rounded bg-zanza-600 px-3 py-1.5 text-sm font-medium text-ink-950 hover:bg-zanza-500"
          >
            New project
          </button>
        </header>

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
            Project name
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Episode 002"
              className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-ink-400">
            In series
            <select
              value={seriesId}
              onChange={(event) => setSeriesId(event.target.value)}
              className="rounded border border-ink-700 bg-ink-900 px-2 py-1.5 text-sm text-ink-100"
            >
              <option value="__free__">— free project —</option>
              {seriesList.map((series) => (
                <option key={series.id} value={series.id}>
                  {series.name}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="rounded border border-ink-700 px-3 py-1.5 text-sm text-ink-200 hover:bg-ink-800"
          >
            Import file…
          </button>
          <input
            ref={fileInput}
            type="file"
            accept={`application/json,${FILE_EXTENSION}`}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              // Cleared so re-picking the same file fires `change` again.
              event.target.value = '';
              if (file) void onImportFile(file);
            }}
          />
        </div>

        {!isIndexedDbAvailable() && (
          <p className="mb-6 rounded border border-ink-700 bg-ink-900 px-3 py-2 text-sm text-ink-300">
            Local storage is unavailable in this browser, so projects cannot be saved. Edits
            still work for this session and will be lost when the tab closes.
          </p>
        )}

        <div className="mb-3 flex items-center gap-1 border-b border-ink-800">
          <TabButton
            active={view === 'projects'}
            onClick={() => setView('projects')}
          >
            Projects
          </TabButton>
          <TabButton active={view === 'series'} onClick={() => setView('series')}>
            Series ({seriesList.length})
          </TabButton>
        </div>

        {view === 'series' ? (
          <SeriesBrowser />
        ) : (
          <>
            {projects.length > 0 && (
              <div className="mb-3 flex items-center gap-1 border-b border-ink-800">
                <TabButton active={!showArchived} onClick={() => setShowArchived(false)}>
                  Projects ({live.length})
                </TabButton>
                <TabButton active={showArchived} onClick={() => setShowArchived(true)}>
                  Archived ({archived.length})
                </TabButton>
              </div>
            )}
            {projects.length === 0 ? (
              <p className="rounded border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-ink-400">
                No projects yet. Name one above and choose “New project”.
              </p>
            ) : visible.length === 0 ? (
              <p className="rounded border border-dashed border-ink-700 px-4 py-8 text-center text-sm text-ink-400">
                {showArchived ? 'Nothing archived.' : 'Every project is archived.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {visible.map((summary) => (
                  <li
                    key={summary.id}
                    className="flex items-center gap-4 rounded border border-ink-800 bg-ink-900 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {summary.name}
                        {summary.archivedAt !== null && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-ink-500">
                            archived
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-ink-500">
                        {summary.sceneCount} scenes · {summary.episodeCount} episodes ·{' '}
                        {formatDate(summary.updatedAt)}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openProject(summary.id)}
                      disabled={busy}
                      className="rounded bg-ink-800 px-3 py-1.5 text-xs text-ink-100 hover:bg-ink-700 disabled:opacity-40"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => void onAddEpisode(summary.id)}
                      className="rounded px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
                    >
                      + Episode
                    </button>
                    <button
                      type="button"
                      onClick={() => void onExport(summary.id)}
                      className="rounded px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
                    >
                      Export
                    </button>
                    <button
                      type="button"
                      onClick={() => void archiveProject(summary.id, summary.archivedAt === null)}
                      className="rounded px-2 py-1.5 text-xs text-ink-300 hover:bg-ink-800"
                    >
                      {summary.archivedAt === null ? 'Archive' : 'Restore'}
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
          </>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px border-b-2 px-3 py-1.5 text-sm ${
        active
          ? 'border-zanza-500 text-ink-100'
          : 'border-transparent text-ink-400 hover:text-ink-200'
      }`}
    >
      {children}
    </button>
  );
}
