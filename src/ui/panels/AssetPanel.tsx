import type { AssetLibrary, AudioDef } from '../../core/types';
import { hasRecording } from '../../core/audio/recording';

/**
 * The asset library browser.
 *
 * Read-only in this phase: it shows that assets exist and are shared, which is the
 * point of the product. Editing an asset is a later phase; presenting a control that
 * does nothing would be a placeholder pretending to be a feature (RULE 9).
 *
 * Takes an `AssetLibrary` rather than a `Project`, and that is the whole point of the change:
 * the library moved to the series in Phase 14, so a panel handed the project would show six
 * empty groups for every series-owned show. The caller resolves the library; the panel stays
 * content-agnostic and has no idea whether it is looking at a project or a series.
 *
 * Audio is the one group that is not a bare list of names. An audio entry without a
 * file is a declared slot waiting on a recording, and the whole library ships that way;
 * listing those names with no marker would let a user believe a voice exists when none
 * does. So each slot states its kind, its length, and whether there is anything behind
 * it (RULE 9).
 */
export function AssetPanel({ assets }: { assets: AssetLibrary }): React.JSX.Element {
  const groups: { label: string; count: number; names: string[] }[] = [
    { label: 'Characters', count: assets.characters.length, names: assets.characters.map((c) => c.name) },
    { label: 'Environments', count: assets.environments.length, names: assets.environments.map((e) => e.name) },
    { label: 'Poses', count: assets.poses.length, names: assets.poses.map((p) => p.name) },
    { label: 'Expressions', count: assets.expressions.length, names: assets.expressions.map((e) => e.name) },
    { label: 'Props', count: assets.props.length, names: assets.props.map((p) => p.name) },
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
        <div>
          <dt className="flex items-baseline justify-between text-xs text-ink-200">
            <span>Audio</span>
            <span className="font-mono text-[11px] text-ink-500">{assets.audio.length}</span>
          </dt>
          <dd className="mt-1 space-y-1">
            {assets.audio.map((asset) => (
              <AudioRow key={asset.id} asset={asset} />
            ))}
          </dd>
        </div>
      </dl>
    </section>
  );
}

function AudioRow({ asset }: { asset: AudioDef }): React.JSX.Element {
  const recorded = hasRecording(asset);
  return (
    <div className="text-[11px]" title={asset.src ?? 'No file attached'}>
      <p className="truncate text-ink-400">{asset.name}</p>
      <p className="flex items-center gap-1.5 text-[10px] text-ink-500">
        <span className="font-mono">{asset.kind}</span>
        <span aria-hidden>·</span>
        <span className="font-mono">{asset.duration.toFixed(1)}s</span>
        {recorded ? (
          <span className="text-ink-500">· file attached</span>
        ) : (
          // Namespaced, because `AudioSlotPanel` states the same fact about the same slot
          // and used `audio-no-file` first. Two elements answering to one test id makes
          // "is this slot empty?" ambiguous to any test that does not scope itself to one
          // panel, and it is how a harness ends up asserting against the wrong row.
          <span className="text-amber-500/80" data-testid="asset-audio-no-file">
            · no recording
          </span>
        )}
      </p>
    </div>
  );
}
