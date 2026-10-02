import type { Episode, Scene } from '../../core/types';

export interface SceneListProps {
  scenes: Scene[];
  activeSceneId: string;
  onSelect: (sceneId: string) => void;
  onCreate: (name: string) => void;
  /**
   * The project's episodes, and the two actions that change a cut.
   *
   * An episode is the exporter's unit, so a scene nobody has put into an episode is a scene
   * that cannot be exported at all. Without this the cut is only reachable by editing JSON,
   * which is not a user interface. Content-agnostic: the titles are whatever the document
   * says, and no name is baked in here.
   */
  episodes?: Episode[];
  onAddToEpisode?: (sceneId: string, episodeId: string) => void;
  onCreateEpisode?: (sceneId: string) => void;
}

export function SceneList({
  scenes,
  activeSceneId,
  onSelect,
  onCreate,
  episodes = [],
  onAddToEpisode,
  onCreateEpisode,
}: SceneListProps): React.JSX.Element {
  return (
    <section className="border-b border-ink-800">
      <div className="flex items-center justify-between px-3 py-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-ink-400">
          Scenes
        </h2>
        <button
          type="button"
          onClick={() => onCreate('')}
          className="text-[11px] text-ink-400 transition-colors hover:text-ink-100"
        >
          + New scene
        </button>
      </div>
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
                  active ? 'bg-ink-800 text-ink-100' : 'text-ink-300 hover:bg-ink-850 hover:text-ink-100',
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
              <EpisodeMenu
                sceneId={scene.id}
                sceneName={scene.name}
                episodes={episodes}
                {...(onAddToEpisode ? { onAddToEpisode } : {})}
                {...(onCreateEpisode ? { onCreateEpisode } : {})}
              />
            </li>
          );
        })}
      </ul>    </section>
  );
}

/**
 * Which cuts a scene belongs to, and the way to put it in another one.
 *
 * A `<details>` rather than a controlled menu, so the open/closed state is the browser's
 * business and this panel holds no state of its own. The summary states the membership
 * rather than just offering the action, because "is this scene in the cut" is a question
 * worth answering without a click, and the answer is what decides whether the scene can be
 * exported at all.
 */
function EpisodeMenu({
  sceneId,
  sceneName,
  episodes,
  onAddToEpisode,
  onCreateEpisode,
}: {
  sceneId: string;
  sceneName: string;
  episodes: Episode[];
  onAddToEpisode?: (sceneId: string, episodeId: string) => void;
  /**
   * Start a new cut containing this scene.
   *
   * The scene id travels with the click rather than being read from the store. This menu
   * hangs off every row, and "the open scene" is not necessarily the row that was clicked —
   * so a callback without it would quietly build a cut out of whatever scene happened to be
   * on stage, which is a cut nobody asked for and cannot explain afterwards.
   */
  onCreateEpisode?: (sceneId: string) => void;
}): React.JSX.Element | null {
  if (!onAddToEpisode && !onCreateEpisode) return null;
  const inEpisodes = episodes.filter((e) => e.sceneIds.includes(sceneId));

  return (
    <details className="px-3 pb-1.5">
      <summary
        className="cursor-pointer list-none text-[11px] text-ink-500 transition-colors hover:text-ink-300"
        aria-label={`Episode membership for ${sceneName}`}
      >
        {inEpisodes.length === 0
          ? 'Not in an episode'
          : inEpisodes.length === 1
            ? `In: ${inEpisodes[0]?.title ?? ''}`
            : `In ${inEpisodes.length} episodes`}
      </summary>
      <ul className="mt-1 space-y-0.5 pl-1">
        {episodes.map((episode) => {
          const member = episode.sceneIds.includes(sceneId);
          return (
            <li key={episode.id}>
              <button
                type="button"
                disabled={member}
                onClick={() => onAddToEpisode?.(sceneId, episode.id)}
                className="w-full text-left text-[11px] text-ink-400 transition-colors hover:text-ink-100 disabled:cursor-default disabled:text-ink-600"
              >
                {member ? '✓ ' : '+ '}
                {episode.title} ({episode.sceneIds.length})
              </button>
            </li>
          );
        })}
        {episodes.length === 0 && (
          <li className="text-[11px] text-ink-600">No episodes in this project yet.</li>
        )}
        {onCreateEpisode && (
          <li>
            <button
              type="button"
              onClick={() => onCreateEpisode(sceneId)}
              className="w-full text-left text-[11px] text-ink-400 transition-colors hover:text-ink-100"
            >
              + New episode with this scene
            </button>
          </li>
        )}
      </ul>
    </details>
  );
}
