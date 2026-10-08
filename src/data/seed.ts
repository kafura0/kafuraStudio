/**
 * THE ZANZA SEED PROJECT — EP001 "RENT IS DUE".
 *
 * Built entirely through the public document operations, so the seed exercises the
 * same code paths the editor uses and cannot drift away from the invariants.
 *
 * Scene 1 is the MVP acceptance scene: Nia on the couch, Kito walks in through the
 * door anchor, four lines, expression beats, and a slow camera push-in.
 */

import { addDialogueLineWithCue } from '../core/document/dialogueOps';
import {
  addEpisode,
  addSceneToEpisode,
  createSceneInProject,
} from '../core/document/projectOps';
import {
  addPropToScene,
  bindActorToAnchor,
  placeCharacter,
  setActorPose,
  setActorTransform,
} from '../core/document/sceneOps';
import { addKeyframe, addSimpleClip } from '../core/document/trackOps';
import { emptyAssetLibrary } from '../core/document/factories';
import { resolveAssets } from '../core/document/scopes';
import { DEFAULT_SUBTITLE_STYLE } from '../core/render/render';
import type { EaseType, Id, KeyframeTarget, Project, SceneContext, SeriesDef } from '../core/types';
import { CURRENT_FORMAT_VERSION } from '../core/constants';
import { AUDIO } from './audio';
import { CAMERA_PRESETS } from './cameraPresets';
import { CHARACTERS, KITO, MAMA_NIA, NIA, THE_LANDLORD } from './characters';
import { ENVIRONMENTS, NIA_APARTMENT, ZANZA_LOUNGE, ZANZA_STREET } from './environments';
import { EXPRESSIONS } from './expressions';
import { POSES } from './poses';
import { PROPS } from './props';

const A = {
  niaCouch: 'anchor.nia_couch',
  niaCouchRight: 'anchor.nia_couch_right',
  kitoDoor: 'anchor.kito_door',
  niaStreet: 'anchor.nia_street',
  kitoStreet: 'anchor.kito_street',
  niaBar: 'anchor.nia_bar',
  kitoBar: 'anchor.kito_bar',
} as const;

/** One keyframe beat: an absolute scene time plus the properties it changes. */
interface Beat {
  time: number;
  props: KeyframeTarget;
  ease?: EaseType;
}

function addBeats(
  project: Project,
  sceneId: Id,
  trackId: Id,
  clipId: Id,
  beats: Beat[],
): Project {
  let next = project;
  for (const beat of beats) {
    next = addKeyframe(next, sceneId, trackId, clipId, beat.time, beat.props, beat.ease ?? 'linear');
  }
  return next;
}

/** An actor animation track: one clip spanning the scene, holding every beat. */
function animate(
  project: Project,
  sceneId: Id,
  actorId: Id,
  name: string,
  duration: number,
  beats: Beat[],
): Project {
  const { project: withClip, trackId, clipId } = addSimpleClip(
    project,
    sceneId,
    'actor',
    actorId,
    name,
    0,
    duration,
  );
  return addBeats(withClip, sceneId, trackId, clipId, beats);
}

function moveCamera(project: Project, sceneId: Id, duration: number, beats: Beat[]): Project {
  const { project: withClip, trackId, clipId } = addSimpleClip(
    project,
    sceneId,
    'camera',
    'camera',
    'Camera',
    0,
    duration,
  );
  return addBeats(withClip, sceneId, trackId, clipId, beats.map((b) => ({ ...b, ease: b.ease ?? 'easeInOut' })));
}

function placeProp(
  project: Project,
  sceneId: Id,
  propDefId: Id,
  x: number,
  y: number,
  z: number,
): Project {
  return addPropToScene(project, sceneId, propDefId, { x, y, z }).project;
}

/**
 * ZANZA's reusable library, as a series.
 *
 * Every character, environment, pose, expression, prop and audio slot in the show lives
 * here, which is the point: this function has no idea what it is building, and neither does
 * anything downstream. Swapping it for a fishing show or a spaceship is a data change
 * (ARCHITECTURE_SPEC.md §29.4), and that is the multi-series gate G1 asserting.
 *
 * The id is `series_zanza`, not derived from a project id, because this is a *hand-authored*
 * show rather than a migrated project. The v2→v3 migration derives ids instead — see
 * `serialize.ts` — and the two must not be confused: this one is chosen, that one is
 * computed.
 */
export function createSeedSeries(): SeriesDef {
  return {
    id: 'series_zanza',
    name: 'ZANZA',
    description:
      'ZANZA is the original Afrofuturist adult animated comedy set in Zanza City, 2097.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    formatVersion: CURRENT_FORMAT_VERSION,
    assets: {
      characters: [...CHARACTERS],
      environments: [...ENVIRONMENTS],
      poses: [...POSES],
      expressions: [...EXPRESSIONS],
      props: [...PROPS],
      audio: [...AUDIO],
    },
    cameraPresets: [...CAMERA_PRESETS],
    metadata: {},
  };
}

/**
 * ZANZA's pilot episode, as a production document.
 *
 * `assets` is empty on purpose and stays empty. This project does not redraw anybody: it
 * references the show's own library through `seriesId`. The scene data below is byte-for-byte
 * what it was before Phase 14 — only where the art comes from moved, which is the entire
 * claim the migration makes.
 *
 * The `seriesId` is an argument because the caller may be opening the seed in a library where
 * ZANZA already exists under its own id. Threading it through beats letting the two ids drift
 * apart and fail validation later, in a much less obvious place.
 */
export function createSeedProject(seriesId: Id = 'series_zanza'): Project {
  // The library the scene-building operations below resolve against. It is the show's, not
  // the project's: `createSceneInProject` and `bindActorToAnchor` need to read the
  // environment they are staging into, and in a series-owned document that environment is
  // not in `project.assets`.
  //
  // Built from the same arrays `createSeedSeries` uses, via the series, so the two cannot
  // drift: if ZANZA gained a character, this picks it up rather than going stale.
  const library = createSeedSeries().assets;

  let project: Project = {
    id: 'proj_zanza_ep001',
    name: 'ZANZA — Pilot',
    description:
      'Episode 001 of ZANZA, the original Afrofuturist adult animated comedy set in Zanza City, 2097.',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    formatVersion: CURRENT_FORMAT_VERSION,
    seriesId,
    settings: { width: 1920, height: 1080, fps: 24, autosave: true, subtitleStyle: { ...DEFAULT_SUBTITLE_STYLE } },
    assets: emptyAssetLibrary(),
    cameraPresets: [],
    episodes: [],
    scenes: [],
    metadata: { archived: null, duplicatedFrom: null, snapshotOf: null },
  };

  project = addEpisode(
    project,
    'EP001 — Rent Is Due',
    'Nia asks where Kito has been. The answer is worse than the question.',
  );
  const episodeId = project.episodes[0]?.id;
  if (!episodeId) throw new Error('Seed episode was not created');

  /* ---------------------------------------------------------------- */
  /* SC01 — the acceptance scene                                       */
  /* ---------------------------------------------------------------- */
  const s1 = createSceneInProject(project, library, {
    name: 'SC01 — Bro, Where Have You Been?',
    environmentId: NIA_APARTMENT.id,
    description: 'Nia on the couch. Kito walks in. The empire, it turns out, is theoretical.',
    duration: 10,
  });
  project = s1.project;
  const scene1Id = s1.sceneId;

  // Nia is already settled on the couch when the scene opens.
  const nia = placeCharacter(project, scene1Id, NIA, { x: 0, y: 0, scaleX: 1, scaleY: 1 });
  project = nia.project;
  project = bindActorToAnchor(project, library, scene1Id, nia.actorId, A.niaCouch);
  project = setActorPose(project, scene1Id, nia.actorId, 'pose.sittingSofa');

  // Kito starts off-stage at the door, then walks in.
  const kito = placeCharacter(project, scene1Id, KITO, { x: 0, y: 0, scaleX: 1, scaleY: 1 });
  project = kito.project;
  project = bindActorToAnchor(project, library, scene1Id, kito.actorId, A.kitoDoor);
  project = setActorPose(project, scene1Id, kito.actorId, 'pose.walkingIn');

  // Props: her mug on the table, his phone left face-down on the couch arm.
  project = placeProp(project, scene1Id, 'prop.mug', 660, 838, 3);
  project = placeProp(project, scene1Id, 'prop.phone', 1210, 742, 6);
  project = placeProp(project, scene1Id, 'prop.cushion', 560, 690, 1);

  /* --- dialogue ---------------------------------------------------- */
  const script = [
    {
      speaker: 'Nia',
      text: 'Bro, where have you been?',
      actorId: nia.actorId,
      emotion: 'annoyed',
      start: 0.4,
      duration: 1.8,
      voiceAudioId: 'audio.ep001.nia.line1',
    },
    {
      speaker: 'Kito',
      text: 'Building my empire.',
      actorId: kito.actorId,
      emotion: 'smug',
      start: 2.2,
      duration: 1.6,
      voiceAudioId: 'audio.ep001.kito.line1',
    },
    {
      speaker: 'Nia',
      text: 'You owe me rent.',
      actorId: nia.actorId,
      emotion: 'angry',
      start: 3.9,
      duration: 1.5,
      voiceAudioId: 'audio.ep001.nia.line2',
    },
    {
      speaker: 'Kito',
      text: '...the empire is still in development.',
      actorId: kito.actorId,
      emotion: 'deadpan',
      start: 5.5,
      duration: 2.4,
      voiceAudioId: 'audio.ep001.kito.line2',
    },
  ];

  for (const line of script) {
    project = addDialogueLineWithCue(project, scene1Id, line).project;
  }

  /* --- animation ---------------------------------------------------- */
  // Kito walks in from the door, settles, and reacts across the conversation.
  project = animate(project, scene1Id, kito.actorId, 'Kito', 10, [
    { time: 0, props: { x: 1330, alpha: 0, poseId: 'pose.walkingIn' } },
    { time: 0.2, props: { alpha: 1 } },
    { time: 1.6, props: { x: 1120, poseId: 'pose.standing', expressionId: 'expr.smug' } },
    { time: 3.9, props: { expressionId: 'expr.neutral', poseId: 'pose.armsCrossed' }, ease: 'step' },
    { time: 5.5, props: { expressionId: 'expr.deadpan', poseId: 'pose.talking' }, ease: 'step' },
  ]);

  // Nia's beats are expression-only, so her anchor placement is never disturbed.
  project = animate(project, scene1Id, nia.actorId, 'Nia', 10, [
    { time: 0, props: { expressionId: 'expr.annoyed' }, ease: 'step' },
    { time: 2.2, props: { expressionId: 'expr.neutral' }, ease: 'step' },
    { time: 3.9, props: { expressionId: 'expr.angry' }, ease: 'step' },
    { time: 5.5, props: { expressionId: 'expr.deadpan' }, ease: 'step' },
  ]);

  // A slow push-in across the whole scene.
  project = moveCamera(project, scene1Id, 10, [
    { time: 0, props: { scaleX: 1, x: 960, y: 540 } },
    { time: 10, props: { scaleX: 1.18, x: 900, y: 560 } },
  ]);

  // Room tone.
  project = addSimpleClip(
    project,
    scene1Id,
    'audio',
    'audio.ambience.apartment',
    'Apartment ambience',
    0,
    10,
    { audioId: 'audio.ambience.apartment', gain: 0.35 },
  ).project;

  project = addSceneToEpisode(project, episodeId, scene1Id);

  /* ---------------------------------------------------------------- */
  /* SC02 — the landlord turns up                                      */
  /* ---------------------------------------------------------------- */
  const s2 = createSceneInProject(project, library, {
    name: 'SC02 — Terms and Conditions',
    environmentId: NIA_APARTMENT.id,
    description: 'The Landlord arrives. Nia stops pretending this is a conversation.',
    duration: 8,
  });
  project = s2.project;
  const scene2Id = s2.sceneId;

  const nia2 = placeCharacter(project, scene2Id, NIA);
  project = nia2.project;
  project = bindActorToAnchor(project, library, scene2Id, nia2.actorId, A.niaCouchRight);
  project = setActorPose(project, scene2Id, nia2.actorId, 'pose.armsCrossed');

  const landlord = placeCharacter(project, scene2Id, THE_LANDLORD);
  project = landlord.project;
  project = bindActorToAnchor(project, library, scene2Id, landlord.actorId, A.kitoDoor);
  project = setActorPose(project, scene2Id, landlord.actorId, 'pose.handsOnHips');

  project = addDialogueLineWithCue(project, scene2Id, {
    speaker: 'The Landlord',
    text: 'Rent. It is due. It was due. It is now overdue, which is a term I just invented.',
    actorId: landlord.actorId,
    emotion: 'deadpan',
    start: 0.5,
    duration: 3.4,
  }).project;

  project = addDialogueLineWithCue(project, scene2Id, {
    speaker: 'Nia',
    text: 'It was not due. You moved the date on the screen.',
    actorId: nia2.actorId,
    emotion: 'angry',
    start: 4.1,
    duration: 2.6,
  }).project;

  project = animate(project, scene2Id, nia2.actorId, 'Nia', 8, [
    { time: 0, props: { expressionId: 'expr.annoyed' }, ease: 'step' },
    { time: 4.1, props: { expressionId: 'expr.angry' }, ease: 'step' },
  ]);

  project = addSceneToEpisode(project, episodeId, scene2Id);

  /* ---------------------------------------------------------------- */
  /* SC03 — outside                                                    */
  /* ---------------------------------------------------------------- */
  const s3 = createSceneInProject(project, library, {
    name: 'SC03 — Outside',
    environmentId: ZANZA_STREET.id,
    description: 'They get outside. A matatu goes past. The problem did not go with them.',
    duration: 7,
  });
  project = s3.project;
  const scene3Id = s3.sceneId;

  const nia3 = placeCharacter(project, scene3Id, NIA);
  project = nia3.project;
  project = bindActorToAnchor(project, library, scene3Id, nia3.actorId, A.niaStreet);
  project = setActorPose(project, scene3Id, nia3.actorId, 'pose.armsCrossed');

  const kito3 = placeCharacter(project, scene3Id, KITO);
  project = kito3.project;
  project = bindActorToAnchor(project, library, scene3Id, kito3.actorId, A.kitoStreet);
  project = setActorPose(project, scene3Id, kito3.actorId, 'pose.talking');

  project = addDialogueLineWithCue(project, scene3Id, {
    speaker: 'Kito',
    text: 'Relax. The empire has a business plan. With projections.',
    actorId: kito3.actorId,
    emotion: 'smug',
    start: 0.6,
    duration: 2.8,
  }).project;

  project = addDialogueLineWithCue(project, scene3Id, {
    speaker: 'Nia',
    text: 'Kito. The empire has a name and a dream. It does not have money.',
    actorId: nia3.actorId,
    emotion: 'deadpan',
    start: 3.6,
    duration: 3.0,
  }).project;

  project = addSimpleClip(
    project,
    scene3Id,
    'audio',
    'audio.sfx.matatu_pass',
    'Matatu passes',
    1.2,
    3.2,
    { audioId: 'audio.sfx.matatu_pass', gain: 0.5 },
  ).project;

  project = addSceneToEpisode(project, episodeId, scene3Id);

  /* ---------------------------------------------------------------- */
  /* SC04 — the lounge                                                 */
  /* ---------------------------------------------------------------- */
  const s4 = createSceneInProject(project, library, {
    name: 'SC04 — The Lounge',
    environmentId: ZANZA_LOUNGE.id,
    description: 'They get a table. Nia asks the real question.',
    duration: 7,
  });
  project = s4.project;
  const scene4Id = s4.sceneId;

  const nia4 = placeCharacter(project, scene4Id, NIA);
  project = nia4.project;
  project = bindActorToAnchor(project, library, scene4Id, nia4.actorId, A.niaBar);
  project = setActorPose(project, scene4Id, nia4.actorId, 'pose.sitting');

  const kito4 = placeCharacter(project, scene4Id, KITO);
  project = kito4.project;
  project = bindActorToAnchor(project, library, scene4Id, kito4.actorId, A.kitoBar);
  project = setActorPose(project, scene4Id, kito4.actorId, 'pose.talking');

  project = placeProp(project, scene4Id, 'prop.tablet', 1010, 760, 4);
  project = placeProp(project, scene4Id, 'prop.food_bowl', 900, 800, 5);

  project = addDialogueLineWithCue(project, scene4Id, {
    speaker: 'Nia',
    text: 'Fine. Tell me about the empire. And do not say "synergy".',
    actorId: nia4.actorId,
    emotion: 'annoyed',
    start: 0.5,
    duration: 3.0,
  }).project;

  project = addDialogueLineWithCue(project, scene4Id, {
    speaker: 'Kito',
    text: 'No synergy. Only vision. And a very reasonable rent request.',
    actorId: kito4.actorId,
    emotion: 'smug',
    start: 3.7,
    duration: 2.8,
  }).project;

  project = addSceneToEpisode(project, episodeId, scene4Id);

  /* ---------------------------------------------------------------- */
  /* SC05 — Mama Nia calls                                             */
  /* ---------------------------------------------------------------- */
  // Included so the whole cast is proven placeable without touching generic code.
  const s5 = createSceneInProject(project, library, {
    name: 'SC05 — Mama Nia Calls',
    environmentId: NIA_APARTMENT.id,
    description: 'A face-time call becomes a family tribunal.',
    duration: 6,
  });
  project = s5.project;
  const scene5Id = s5.sceneId;

  const nia5 = placeCharacter(project, scene5Id, NIA);
  project = nia5.project;
  project = bindActorToAnchor(project, library, scene5Id, nia5.actorId, A.niaCouch);
  project = setActorPose(project, scene5Id, nia5.actorId, 'pose.holdingPhone');
  project = placeProp(project, scene5Id, 'prop.phone', 700, 660, 7);

  const mama = placeCharacter(project, scene5Id, MAMA_NIA);
  project = mama.project;
  // Not on an anchor: she is on a screen, so she is placed and scaled by hand.
  project = setActorTransform(project, scene5Id, mama.actorId, {
    x: 1580,
    y: 300,
    scaleX: 0.85,
    scaleY: 0.85,
  });
  project = setActorPose(project, scene5Id, mama.actorId, 'pose.pointing');

  project = addDialogueLineWithCue(project, scene5Id, {
    speaker: 'Mama Nia',
    text: 'I heard you are making music again. Again.',
    actorId: mama.actorId,
    emotion: 'worried',
    start: 0.4,
    duration: 2.6,
  }).project;

  project = addDialogueLineWithCue(project, scene5Id, {
    speaker: 'Nia',
    text: 'Mama. I am making music again again.',
    actorId: nia5.actorId,
    emotion: 'embarrassed',
    start: 3.1,
    duration: 2.4,
  }).project;

  project = animate(project, scene5Id, mama.actorId, 'Mama Nia', 6, [
    { time: 0, props: { alpha: 0.2 } },
    { time: 0.4, props: { alpha: 1 } },
  ]);

  project = addSceneToEpisode(project, episodeId, scene5Id);

  return project;
}

/** The project the editor opens when no saved project is found. */
export const SEED_PROJECT: Project = createSeedProject();

/** ZANZA's reusable library. */
export const SEED_SERIES: SeriesDef = createSeedSeries();

/**
 * What the renderer, the sampler and the audio planner are handed.
 *
 * This is the fixture the render tests pass instead of a project — see §29.2. It is derived
 * through `resolveAssets` rather than written as `{ assets: SEED_SERIES.assets }` so that a
 * test asserting "the seed renders identically" is genuinely testing the same path the app
 * uses. A fixture that hand-assembled the context would keep passing if the merge were
 * broken, which is the failure mode that matters most here.
 */
export function seedContext(): SceneContext {
  return resolveAssets(SEED_PROJECT, SEED_SERIES);
}
