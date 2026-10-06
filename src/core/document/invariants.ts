/**
 * Project integrity checks.
 *
 * `parseProject` refuses a document that violates these, so a corrupted or
 * hand-edited file cannot enter the editor in a broken state. This is the
 * mechanical form of RULE 2 (reusable assets) and RULE 3 (Nia is not special).
 *
 * `series` is the owning series, or `null` for a free project and for a project whose
 * owner has not been loaded yet. Reference resolution runs against the **merged** library
 * rather than `project.assets`, because that is the library the renderer will read. A
 * project whose scenes reference characters that live in its series is valid; one that
 * references a character from neither is not, and neither verdict can be reached by
 * looking at `project.assets` alone.
 */

import type { Camera, Id, Project, SeriesDef } from '../types';
import { resolveAssets } from './scopes';

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateProject(project: Project, series: SeriesDef | null = null): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  // A project file carries its document, not its library. When the project is series-owned
  // and no series was supplied, the character and environment ids simply are not in this
  // function's hands, so every reference check below would report the entire cast as unknown
  // — 55 "unknown character" issues for a perfectly healthy file.
  //
  // That is not a warning to be tolerated, it is a question being answered wrongly. `series`
  // being absent means the library is *unknown*, and unknown is not the same as empty, so the
  // asset-reference half of the validation is skipped rather than failed. Callers that have
  // the library — the store, the repository — pass it and get the real check; callers that
  // genuinely have no series, such as the editor opening a file off disk, still get the
  // structural half, which is all a project file can be held to.
  const libraryKnown = project.seriesId === null || series !== null;
  const library = resolveAssets(project, series).assets;

  const characterIds = new Set(library.characters.map((a) => a.id));
  const environmentIds = new Set(library.environments.map((a) => a.id));
  const poseIds = new Set(library.poses.map((a) => a.id));
  const expressionIds = new Set(library.expressions.map((a) => a.id));
  const propDefIds = new Set(library.props.map((a) => a.id));
  const audioIds = new Set(library.audio.map((a) => a.id));

  project.scenes.forEach((scene, sceneIndex) => {
    const base = `scenes[${sceneIndex}]`;

    if (libraryKnown && !environmentIds.has(scene.environmentId)) {
      add(`${base}.environmentId`, `Unknown environment: ${scene.environmentId}`);
    }

    const actorIds = new Set<Id>();
    scene.actors.forEach((actor, actorIndex) => {
      const path = `${base}.actors[${actorIndex}]`;
      if (actorIds.has(actor.id)) add(`${path}.id`, `Duplicate actor id: ${actor.id}`);
      actorIds.add(actor.id);
      if (libraryKnown && !characterIds.has(actor.characterId)) {
        add(`${path}.characterId`, `Unknown character: ${actor.characterId}`);
      }
      if (libraryKnown && !poseIds.has(actor.poseId)) add(`${path}.poseId`, `Unknown pose: ${actor.poseId}`);
      if (libraryKnown && !expressionIds.has(actor.expressionId)) {
        add(`${path}.expressionId`, `Unknown expression: ${actor.expressionId}`);
      }
    });

    scene.props.forEach((prop, propIndex) => {
      if (libraryKnown && !propDefIds.has(prop.propId)) {
        add(`${base}.props[${propIndex}].propId`, `Unknown prop: ${prop.propId}`);
      }
    });

    const dialogueIds = new Set<Id>();
    scene.dialogue.forEach((line, lineIndex) => {
      const path = `${base}.dialogue[${lineIndex}]`;
      if (dialogueIds.has(line.id)) add(`${path}.id`, `Duplicate dialogue id: ${line.id}`);
      dialogueIds.add(line.id);
      if (line.actorId !== null && !actorIds.has(line.actorId)) {
        add(`${path}.actorId`, `Dialogue references missing actor: ${line.actorId}`);
      }
      if (libraryKnown && line.voiceAudioId !== null && !audioIds.has(line.voiceAudioId)) {
        add(`${path}.voiceAudioId`, `Unknown audio asset: ${line.voiceAudioId}`);
      }
    });

    const propIds = new Set(scene.props.map((p) => p.id));
    scene.tracks.forEach((track, trackIndex) => {
      const path = `${base}.tracks[${trackIndex}]`;
      if (track.kind === 'actor' && !actorIds.has(track.targetId)) {
        add(`${path}.targetId`, `Actor track targets a missing actor: ${track.targetId}`);
      }
      if (track.kind === 'prop' && !propIds.has(track.targetId)) {
        add(`${path}.targetId`, `Prop track targets a missing prop: ${track.targetId}`);
      }
      if (track.kind === 'camera' && track.targetId !== 'camera') {
        add(`${path}.targetId`, `Camera track target must be "camera", got ${track.targetId}`);
      }
      if (track.kind === 'dialogue' && !dialogueIds.has(track.targetId)) {
        add(`${path}.targetId`, `Dialogue track targets a missing line: ${track.targetId}`);
      }
      if (libraryKnown && track.kind === 'audio' && !audioIds.has(track.targetId)) {
        add(`${path}.targetId`, `Audio track targets a missing asset: ${track.targetId}`);
      }

      track.clips.forEach((clip, clipIndex) => {
        const clipPath = `${path}.clips[${clipIndex}]`;
        if (clip.start < 0) add(`${clipPath}.start`, 'Clip start is negative');
        if (clip.duration <= 0) add(`${clipPath}.duration`, 'Clip duration must be positive');
        if (clip.start + clip.duration > scene.duration + 1e-6) {
          add(`${clipPath}`, `Clip extends past the scene end (${scene.duration}s)`);
        }
        if (clip.dialogueLineId !== null && !dialogueIds.has(clip.dialogueLineId)) {
          add(`${clipPath}.dialogueLineId`, `Clip references a missing dialogue line`);
        }
        if (libraryKnown && clip.audioId !== null && !audioIds.has(clip.audioId)) {
          add(`${clipPath}.audioId`, `Clip references a missing audio asset: ${clip.audioId}`);
        }
        let previous = -Infinity;
        for (const kf of clip.keyframes) {
          if (kf.time < previous) {
            add(`${clipPath}.keyframes`, 'Keyframes are not sorted by time');
            break;
          }
          previous = kf.time;
          if (kf.time < clip.start - 1e-6 || kf.time > clip.start + clip.duration + 1e-6) {
            add(`${clipPath}.keyframes`, `Keyframe at ${kf.time}s falls outside its clip`);
            break;
          }
        }
      });
    });
  });

  const sceneIds = new Set(project.scenes.map((s) => s.id));
  project.episodes.forEach((episode, episodeIndex) => {
    const seen = new Set<Id>();
    episode.sceneIds.forEach((sceneId, orderIndex) => {
      const path = `episodes[${episodeIndex}].sceneIds[${orderIndex}]`;
      if (!sceneIds.has(sceneId)) add(path, `Unknown scene: ${sceneId}`);
      if (seen.has(sceneId)) add(path, `Scene listed twice in the cut: ${sceneId}`);
      seen.add(sceneId);
    });
  });

  // Whether a library must be populated depends on whether there is anything to draw.
  //
  // The requirement is not "a project owns a character" - it is "the renderer is never
  // handed a scene it cannot draw". A project with no scenes draws nothing, so an empty
  // library is a legitimate starting state: that is exactly what `createProject` returns,
  // and refusing it meant a newly created project saved fine and was then quarantined as
  // unreadable the first time anyone opened it, leaving a record in the list that could
  // never be opened again.
  //
  // So the rule is scoped to the scenes. Once a project has one, the art it refers to has
  // to exist, and the checks above that reject a dangling character or environment id are
  // what actually make it drawable.
  if (project.scenes.length > 0 && libraryKnown) {
    if (library.characters.length === 0) {
      add('assets.characters', 'A project with scenes needs at least one character');
    }
    if (library.environments.length === 0) {
      add('assets.environments', 'A project with scenes needs at least one environment');
    }
  }

  // Asset ids are the join keys for the whole document, so they must be unique *within a
  // scope* — across every collection of a single library. They must NOT be unique across
  // series and project, because sharing an id across the two is precisely how a project
  // override is expressed (scopes.ts). Checking the merged set would flag every override as
  // a duplicate, which would make the feature impossible to use.
  const seenAssetIds = new Set<Id>();
  const collections = [
    'characters',
    'environments',
    'poses',
    'expressions',
    'props',
    'audio',
  ] as const;
  for (const scope of [library, project.assets] as const) {
    seenAssetIds.clear();
    for (const collection of collections) {
      scope[collection].forEach((asset, index) => {
        if (seenAssetIds.has(asset.id)) {
          add(`assets.${collection}[${index}].id`, `Duplicate asset id: ${asset.id}`);
        }
        seenAssetIds.add(asset.id);
      });
    }
  }

  // Camera presets are referenced by name in Phase 14, so their ids must be unique
  // today or that override rule would be ambiguous from the start.
  const seenPresetIds = new Set<Id>();
  (project.cameraPresets ?? []).forEach((preset, index) => {
    const path = `cameraPresets[${index}]`;
    if (seenPresetIds.has(preset.id)) {
      add(`${path}.id`, `Duplicate camera preset id: ${preset.id}`);
    }
    seenPresetIds.add(preset.id);
    // A non-finite value here renders as a blank frame, and the renderer would not
    // complain — so it is caught at validation rather than discovered in playback.
    const values: Array<[keyof Camera, number]> = [
      ['x', preset.camera.x],
      ['y', preset.camera.y],
      ['zoom', preset.camera.zoom],
      ['rotation', preset.camera.rotation],
    ];
    for (const [field, value] of values) {
      if (!Number.isFinite(value)) {
        add(`${path}.camera.${field}`, `Camera preset ${field} is not a finite number`);
      }
    }
  });

  return issues;
}

export function isProjectValid(project: Project, series: SeriesDef | null = null): boolean {
  return validateProject(project, series).length === 0;
}

/**
 * Series integrity checks.
 *
 * The checks are about the series *as a library owner*, not about what it contains. An empty
 * series is valid — it is a show that has not defined anybody yet, and it is what
 * `createSeries` returns — so the "needs at least one character" rules that apply to a
 * project with scenes have no analogue here. Whether a *project* of this series is drawable
 * is that project's question, asked by `validateProject`.
 *
 * The one thing this does check is that the ids are unique within the series, because a
 * duplicate makes an override ambiguous in exactly the way `mergeById` cannot repair: the
 * winner would depend on collection order rather than on anything the author chose.
 */
export function validateSeries(series: SeriesDef): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (path: string, message: string) => issues.push({ path, message });

  if (series.id === '') add('id', 'A series needs an id');
  if (series.name.trim() === '') add('name', 'A series needs a name');
  if (Number.isNaN(Date.parse(series.createdAt))) {
    add('createdAt', 'createdAt is not a valid date');
  }
  if (Number.isNaN(Date.parse(series.updatedAt))) {
    add('updatedAt', 'updatedAt is not a valid date');
  }

  const seen = new Set<Id>();
  const collections = [
    'characters',
    'environments',
    'poses',
    'expressions',
    'props',
    'audio',
  ] as const;
  for (const collection of collections) {
    series.assets[collection].forEach((asset, index) => {
      if (seen.has(asset.id)) {
        add(`assets.${collection}[${index}].id`, `Duplicate asset id: ${asset.id}`);
      }
      seen.add(asset.id);
    });
  }

  return issues;
}
