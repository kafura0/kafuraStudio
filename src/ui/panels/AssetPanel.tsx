import type { Project } from '../../core/types';

/**
 * The asset library browser.
 *
 * Read-only in this phase: it shows that assets exist and are shared, which is the
 * point of the product. Editing an asset is a later phase; presenting a control
 * that does nothing would be a placeholder pretending to be a feature (RULE 9).
 */
export function AssetPanel({ project }: { project: Project }): React.JSX.Element {
  const { assets } = project;
  const groups: { label: string; count: number; names: string[] }[] = [
    { label: 'Characters', count: assets.characters.length, names: assets.characters.map((c) => c.name) },
    { label: 'Environments', count: assets.environments.length, names: assets.environments.map((e) => e.name) },
    { label: 'Poses', count: assets.poses.length, names: assets.poses.map((p) => p.name) },
    { label: 'Expressions', count: assets.expressions.length, names: assets.expressions.map((e) => e.name) },
    { label: 'Props', count: assets.props.length, names: assets.props.map((p) => p.name) },
    { label: 'Audio', count: assets.audio.length, names: assets.audio.map((a) => a.name) },
  ];

  return (
    <section className="px-3 py-2">
      <h2 className="py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        Asset library
      </h2>
      <dl className="space-y-3">
        {groups.map((group) => (
          <div key={group.label}>
            <dt className="flex items-baseline justify-between text-xs text-ink-200">
              <span>{group.label}</span>
              <span className="font-mono text-[11px] text-ink-500">{group.count}</span>
            </dt>
            <dd className="mt-1 space-y-0.5">
              {group.names.map((name) => (
                <p key={name} className="truncate text-[11px] text-ink-400" title={name}>
                  {name}
                </p>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
