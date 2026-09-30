/**
 * Shared form layout.
 *
 * A component-only module, so React Fast Refresh works when a panel using it is edited.
 * The commit-on-blur hooks and the shared input class live in `./draftFields`.
 */

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <label className="block space-y-1">
      <span className="flex items-baseline justify-between text-[10px] uppercase tracking-wider text-ink-500">
        {label}
      </span>
      {children}
      {hint && <span className="block text-[10px] leading-snug text-ink-500">{hint}</span>}
    </label>
  );
}
