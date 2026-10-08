/**
 * Project invariants.
 *
 * These are the rules `commit` refuses to let a document break, which makes them the
 * rules the whole editor is built on being true. They were only ever exercised
 * indirectly, through operations that happened to produce valid documents - so a rule
 * could be wrong and nothing would notice, which is how a project could be created that
 * was guaranteed to be unopenable.
 *
 * Scope note: this file covers the rules that decide *whether a document can exist*, not
 * the per-collection referential checks. Those are covered by the operations that would
 * trip them.
 */

import { describe, expect, it } from 'vitest';
import { createProject, createScene, emptyAssetLibrary } from './factories';
import { validateProject } from './invariants';
import type { CharacterDef, EnvironmentDef, Project } from '../types';

const paths = (project: Project): string[] => validateProject(project).map((i) => i.path);

/**
 * The smallest thing that counts as art.
 *
 * Built inline rather than taken from the seed for two reasons: `core` does not import
 * `data` (the dependency only points downwards), and a fixture that borrows the pilot's
 * cast would make a test about document shape quietly depend on ZANZA's canon.
 */
const CHARACTER: CharacterDef = {
  id: 'char.blank',
  name: 'Blank',
  description: 'A throwaway character used only by this test.',
  tags: ['test'],
  height: 620,
  palette: { skin: '#c98a5b' },
  rig: [],
  defaultPoseId: 'pose.standing',
  mouthSlot: 'mouth',
  defaultExpressionId: 'expr.neutral',
};

const ENVIRONMENT: EnvironmentDef = {
  id: 'env.blank',
  name: 'Blank',
  description: 'A throwaway environment used only by this test.',
  tags: ['test'],
  width: 1920,
  height: 1080,
  layers: [],
  anchors: [],
  lighting: { ambient: '#ffffff', overlayColor: null, vignette: 0 },
};

/** A project with one scene that has art to draw. */
const projectWithArt = (): Project => ({
  ...createProject('With art'),
  assets: {
    ...emptyAssetLibrary(),
    characters: [CHARACTER],
    environments: [ENVIRONMENT],
  },
  scenes: [createScene('SC01', ENVIRONMENT.id)],
});

describe('validateProject — library population', () => {
  it('accepts an empty library when the project has no scenes', () => {
    // This is what `createProject` returns, and the project browser saves it as-is. The
    // rule it used to break was "a project needs at least one character", which meant a
    // new project saved fine and was then quarantined as unreadable on first open: a
    // record in the list that could never be opened again, with no way to recover it.
    expect(paths(createProject('Fresh'))).toEqual([]);
  });

  it('still requires a character once the project has a scene', () => {
    const project = projectWithArt();
    const withoutCharacter: Project = {
      ...project,
      assets: { ...project.assets, characters: [] },
    };
    expect(paths(withoutCharacter)).toContain('assets.characters');
  });

  it('still requires an environment once the project has a scene', () => {
    const project = projectWithArt();
    const withoutEnvironment: Project = {
      ...project,
      assets: { ...project.assets, environments: [] },
    };
    expect(paths(withoutEnvironment)).toContain('assets.environments');
  });

  it('accepts a project whose scenes all resolve against real art', () => {
    expect(paths(projectWithArt())).toEqual([]);
  });

  it('rejects a scene pointing at an environment that does not exist', () => {
    // The reason the library rule exists at all: this is the failure the renderer cannot
    // survive, and it must not be reachable by adding a scene to an empty project.
    const project = projectWithArt();
    const dangling: Project = {
      ...project,
      scenes: [createScene('SC01', 'env.nowhere')],
    };
    expect(paths(dangling)).toContain('scenes[0].environmentId');
  });
});
