import { useMemo } from 'react';
import { validateProject } from '../../core/document/invariants';
import { useOpenProject, useOpenSeries } from '../../state/editorStore';

/**
 * Surfaces invariant violations instead of swallowing them.
 *
 * The store refuses to commit a document with a *structural* error; this is the visible
 * half of that contract, so a content bug shows up as a readable message rather than a
 * silently broken frame. Warnings are the other half: a colour-key that resolves to
 * nothing is committed (it has to be, to be fixable) and surfaced here, in amber, so it
 * is neither invisible nor silently smuggling a broken document through.
 */
export function IssuePanel(): React.JSX.Element | null {
  const project = useOpenProject();
  const series = useOpenSeries();
  // Validated against the merged library, like the store does — a series-owned project
  // would otherwise report every reference as unknown (or, for colour keys, none of them).
  const issues = useMemo(() => validateProject(project, series), [project, series]);

  if (issues.length === 0) return null;

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  const hasErrors = errors.length > 0;

  return (
    <div
      className={`shrink-0 border-t px-3 py-2 ${
        hasErrors ? 'border-red-900/60 bg-red-950/40' : 'border-amber-900/60 bg-amber-950/40'
      }`}
    >
      <h2
        className={`text-[11px] font-semibold uppercase tracking-wider ${hasErrors ? 'text-red-400' : 'text-amber-400'}`}
      >
        {errors.length > 0 && `${errors.length} document error${errors.length === 1 ? '' : 's'}`}
        {errors.length > 0 && warnings.length > 0 && ' · '}
        {warnings.length > 0 && `${warnings.length} warning${warnings.length === 1 ? '' : 's'}`}
      </h2>
      <ul className="mt-1 space-y-0.5">
        {issues.slice(0, 6).map((issue) => (
          <li
            key={`${issue.path}:${issue.message}`}
            className={`font-mono text-[11px] ${issue.severity === 'error' ? 'text-red-300' : 'text-amber-300'}`}
          >
            {issue.path}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}