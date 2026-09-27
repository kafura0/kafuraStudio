import type { Scene } from '../../core/types';

export interface SceneListProps {
  scenes: Scene[];
  activeSceneId: string;
  onSelect: (sceneId: string) => void;
}

export function SceneList({ scenes, activeSceneId, onSelect }: SceneListProps): React.JSX.Element {
  return (
    <section className="border-b border-ink-800">
      <h2 className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-400">
        Scenes
      </h2>
      <ul>
        {scenes.map((scene, index) => {
          const active = scene.id === activeSceneId;
          return (
            <li key={scene.id}>
              <button
                type="button"
                onClick={() => onSelect(scene.id)}
                aria-current={active ? 'true' : undefined}
                className={[
                  'w-full px-3 py-2 text-left text-sm transition-colors',
                  active
                    ? 'bg-ink-800 text-ink-100'
                    : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100',
                ].join(' ')}
              >
                <span className="mr-2 font-mono text-[11px] text-ink-500">
                  {String(index + 1).padStart(2, '0')}
                </span>
                {scene.name}
                <span className="mt-0.5 block font-mono text-[11px] text-ink-500">
                  {scene.duration.toFixed(1)}s · {scene.actors.length} actors ·{' '}
                  {scene.dialogue.length} lines
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
