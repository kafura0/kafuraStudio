import { useMemo } from 'react';
import { validateProject } from '../../core/document/invariants';
import { useEditor } from '../../state/editorStore';

/**
 * Surfaces invariant violations instead of swallowing them.
 *
 * The store already refuses to commit an invalid document; this is the visible
 * half of that contract, so a content bug shows up as a readable message rather
 * than a silently broken frame.
 */
export function IssuePanel(): React.JSX.Element | null {
  const project = useEditor((s) => s.project);
  const issues = useMemo(() => validateProject(project), [project]);

  if (issues.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-red-900/60 bg-red-950/40 px-3 py-2">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-red-400">
        {issues.length} document issue{issues.length === 1 ? '' : 's'}
      </h2>
      <ul className="mt-1 space-y-0.5">
        {issues.slice(0, 6).map((issue) => (
          <li key={`${issue.path}:${issue.message}`} className="font-mono text-[11px] text-red-300">
            {issue.path}: {issue.message}
          </li>
        ))}
      </ul>
    </div>
  );
}
