/**
 * What the export panel *says*.
 *
 * The panel's job is not to export, it is to be believed. An export surface that reports
 * a capability it does not have, or reports a partial result as a clean one, costs more
 * than a missing feature: the operator finds out after waiting, and cannot tell whether
 * their work is lost or the button is broken.
 *
 * So the tests here are about the claims the screen makes. What the exporter produces is
 * covered in `exportDrawLog.test.ts`, `frameSequence.test.ts`, `mixdownPlan.test.ts` and
 * `wav.test.ts`; this file is the last layer, where a correct export can still be
 * misreported.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ExportPanel } from './ExportPanel';
import { describeResult } from './exportResult';
import { detectExportCapabilities, canExportGate } from '../../core/export/capabilities.browser';
import { addEpisode, addSceneToEpisode } from '../../core/document/projectOps';
import { createClip, createScene, createTrack } from '../../core/document/factories';
import { SEED_PROJECT } from '../../data/seed';
import type { Episode, Project } from '../../core/types';

const media = { get: vi.fn(async () => null) };
vi.mock('../../state/mediaLibrary', () => ({
  mediaStore: () => media,
  resetMediaStore: () => undefined,
  MEDIA_DB_NAME: 'zanza-studio',
}));

/**
 * jsdom has no 2D context at all, so capability detection would report every export as
 * unavailable and the panel's buttons would all be disabled — which would make these tests
 * assert nothing. A minimal stub stands in for one, so the panel's real detection path runs
 * and the gate is genuinely satisfied.
 *
 * The stub is only a context, not a renderer: the frames themselves are covered in
 * `exportDrawLog.test.ts`, which drives the real `renderScene` against a recorder.
 */
const stubContext = {
  canvas: null as unknown,
  globalAlpha: 1,
  globalCompositeOperation: 'source-over',
  fillStyle: '#000',
  strokeStyle: '#000',
  lineWidth: 1,
  lineCap: 'butt',
  lineJoin: 'miter',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  imageSmoothingEnabled: true,
  save: () => undefined,
  restore: () => undefined,
  translate: () => undefined,
  rotate: () => undefined,
  scale: () => undefined,
  setTransform: () => undefined,
  beginPath: () => undefined,
  closePath: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  arc: () => undefined,
  ellipse: () => undefined,
  rect: () => undefined,
  arcTo: () => undefined,
  quadraticCurveTo: () => undefined,
  bezierCurveTo: () => undefined,
  fill: () => undefined,
  stroke: () => undefined,
  clip: () => undefined,
  fillRect: () => undefined,
  clearRect: () => undefined,
  strokeRect: () => undefined,
  fillText: () => undefined,
  strokeText: () => undefined,
  measureText: () => ({ width: 10 }),
  drawImage: () => undefined,
  createLinearGradient: () => ({ addColorStop: () => undefined }),
  createRadialGradient: () => ({ addColorStop: () => undefined }),
  setLineDash: () => undefined,
  toBlob: (cb: (b: Blob | null) => void) => cb(new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' })),
};

/**
 * A gate that holds `toBlob` open, so an export can be observed while it is still working.
 *
 * Without it, a 456-frame export against a stub context finishes faster than Testing Library
 * can poll, and any assertion about progress or a cancel button is a race that passes on a
 * fast machine and fails on a slow one. Holding one frame open makes "the export is in
 * progress" a state the test can enter deliberately.
 */
let toBlobGate: Promise<void> | null = null;

const gatedContext = {
  ...stubContext,
  toBlob: (cb: (b: Blob | null) => void): void => {
    if (toBlobGate === null) {
      stubContext.toBlob(cb);
      return;
    }
    const gate = toBlobGate;
    toBlobGate = null;
    void gate.then(() => stubContext.toBlob(cb));
  },
};

/**
 * jsdom has no `OfflineAudioContext` either, so the mixdown capability would report
 * unavailable and the phase's own gate would never be satisfied here. A constructor stub
 * restores it, so `canExportGate` is exercised against a browser that has what it needs.
 *
 * The stub does not render audio: the tests below stop short of a real mixdown, because
 * a fake context that agreed with the code's own assumptions would prove nothing. What is
 * rendered is verified in the real-browser acceptance run.
 */
class StubOfflineAudioContext {
  constructor(
    public channels: number,
    public length: number,
    public sampleRate: number,
  ) {}
  createBufferSource = () => ({ buffer: null, loop: false, connect: () => undefined, start: () => undefined });
  createGain = () => ({ gain: { value: 1 }, connect: () => undefined });
  get destination() {
    return {};
  }
  startRendering = async (): Promise<AudioBuffer> =>
    ({
      numberOfChannels: this.channels,
      length: this.length,
      sampleRate: this.sampleRate,
      duration: this.length / this.sampleRate,
      getChannelData: () => new Float32Array(this.length),
    }) as unknown as AudioBuffer;
}

beforeEach(() => {
  toBlobGate = null;
  HTMLCanvasElement.prototype.getContext = vi.fn(() => gatedContext) as never;
  HTMLCanvasElement.prototype.toBlob = gatedContext.toBlob as never;
  for (const target of [globalThis, window]) {
    Object.defineProperty(target, 'OfflineAudioContext', {
      value: StubOfflineAudioContext,
      writable: true,
      configurable: true,
    });
  }
});

/**
 * Put the globals back.
 *
 * A canvas stub left on the prototype outlives this file. Vitest runs test files in the same
 * worker, so a later suite would inherit a `getContext` that draws nothing and pass its own
 * tests for the wrong reason — or fail them, depending on what it asserted. Restoring is
 * the difference between this file's stubs being visible only here.
 */
afterEach(() => {
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'getContext');
  Reflect.deleteProperty(HTMLCanvasElement.prototype, 'toBlob');
  for (const target of [globalThis, window]) {
    Reflect.deleteProperty(target, 'OfflineAudioContext');
  }
});

function seedEpisode(project: Project): Episode {
  const episode = project.episodes[0];
  if (!episode) throw new Error('seed has no episode');
  return episode;
}

/**
 * A deliberately tiny episode, for the tests that run a whole export to completion.
 *
 * The seed episode is 38 seconds, which is 912 frames at 24fps. Driving all of them
 * through the panel would take longer than a test is allowed to run, and — worse — it
 * would measure this machine's speed rather than the panel's behaviour. A 0.5s, 12-frame
 * cut exercises every code path the real export does, including the mixdown, in a few
 * milliseconds.
 */
/**
 * The same cut, plus one audible slot that has no file behind it.
 *
 * `audible` is what makes the difference between a mixdown that is complete and one that
 * is silent because the operator has not attached a recording yet. Both produce a valid
 * WAV; only one of them is an export the panel should call clean.
 */
function tinyProject(audible = false): { project: Project; episode: Episode } {
  const withEpisode = addEpisode(SEED_PROJECT, 'Short');
  // Appended, not prepended — taking [0] here would hand back the 6-scene seed cut and
  // quietly turn a "tiny" export into 924 frames.
  const episodeId = withEpisode.episodes[withEpisode.episodes.length - 1]?.id;
  if (!episodeId) throw new Error('tiny episode missing');

  const environmentId = SEED_PROJECT.scenes[0]?.environmentId;
  if (!environmentId) throw new Error('seed has no environment to borrow');

  const scene = createScene('One', environmentId, { duration: 0.5 });
  if (audible) {
    // A seed slot: declared, `src: null`, never recorded. Exactly the state a real project
    // is in for every line until somebody sits down with a microphone.
    const track = createTrack('audio', 'global', 'Ambience', '#0ea5e9');
    track.clips.push(createClip(0, 0.5, { audioId: 'audio.ambience.apartment' }));
    scene.tracks.push(track);
  }

  const withScene: Project = { ...withEpisode, scenes: [...withEpisode.scenes, scene] };
  const withCut = addSceneToEpisode(withScene, episodeId, scene.id);

  const episode = withCut.episodes.find((e) => e.id === episodeId);
  if (!episode) throw new Error('tiny episode missing');
  return { project: withCut, episode };
}

/**
 * A button, once it is actually clickable.
 *
 * Capability detection runs in an effect, so a button is rendered before it is enabled. A
 * test that grabs it immediately gets a disabled control, clicks it, and sees nothing
 * happen — which looks exactly like the panel being broken. Waiting for the enabled state
 * is what makes the click mean something.
 */
async function enabledButton(name: string): Promise<HTMLElement> {
  const button = await waitFor(() => {
    const found = screen.getByRole('button', { name });
    expect(found).not.toBeDisabled();
    return found;
  });
  return button;
}

function renderPanel(over: {
  project?: Project | null;
  /** An episode whose id is passed to the panel. Defaults to the first. */
  episode?: Episode | null;
  currentTime?: number;
  subtitles?: boolean;
} = {}) {
  const project = 'project' in over ? over.project : SEED_PROJECT;
  const resolved = project ?? SEED_PROJECT;
  const episodeId =
    'episode' in over ? (over.episode?.id ?? null) : (seedEpisode(resolved).id ?? null);
  return render(
    <ExportPanel
      project={project}
      episodeId={episodeId}
      currentTime={over.currentTime ?? 0}
      subtitles={over.subtitles ?? true}
    />,
  );
}

describe('detectExportCapabilities', () => {
  it('reports every capability the panel offers', () => {
    const capabilities = detectExportCapabilities();
    expect(Object.keys(capabilities).sort()).toEqual([
      'audio-mixdown',
      'png-sequence',
      'png-still',
      'video-webm',
    ]);
  });

  it('gives every unavailable capability a reason', () => {
    // A disabled control with no explanation is indistinguishable from a broken one, so
    // emptiness here is a real defect rather than a cosmetic gap.
    for (const [name, capability] of Object.entries(detectExportCapabilities())) {
      if (capability.available) {
        expect(capability.reason).toBe('');
      } else {
        expect(capability.reason, `${name} must explain itself`).not.toBe('');
      }
    }
  });

  it('treats video as never required for the gate', () => {
    // ADR 001: video is the best-effort extra. A browser with no MediaRecorder must still
    // pass the gate, or the phase's own definition of done would be browser-dependent.
    const capabilities = detectExportCapabilities();
    capabilities['video-webm'] = { available: false, reason: 'no video here' };
    expect(canExportGate(capabilities)).toBe(true);
  });

  it('does not offer video it cannot produce, whatever the browser supports', () => {
    // A `MediaRecorder` in the browser is not a video exporter in this app. Reporting the
    // capability available would list a path that was never built, and ADR 001's own
    // consequences section says the panel must not be able to pretend otherwise.
    for (const target of [globalThis, window]) {
      Object.defineProperty(target, 'MediaRecorder', {
        value: class {
          static isTypeSupported(): boolean {
            return true;
          }
        },
        writable: true,
        configurable: true,
      });
    }
    try {
      expect(detectExportCapabilities()['video-webm'].available).toBe(false);
    } finally {
      for (const target of [globalThis, window]) {
        Reflect.deleteProperty(target, 'MediaRecorder');
      }
    }
  });

  it('blames the missing implementation for video, not the browser', () => {
    // "This browser cannot record WebM" would be a false statement sent to look for a
    // browser problem that does not exist.
    const reason = detectExportCapabilities()['video-webm'].reason;
    expect(reason).toMatch(/not built/i);
    expect(reason).toMatch(/ADR/);
  });

  it('fails the gate when the PNG sequence is unavailable', () => {
    const capabilities = detectExportCapabilities();
    capabilities['png-sequence'] = { available: false, reason: 'no canvas' };
    expect(canExportGate(capabilities)).toBe(false);
  });

  it('fails the gate when the mixdown is unavailable', () => {
    const capabilities = detectExportCapabilities();
    capabilities['audio-mixdown'] = { available: false, reason: 'no OfflineAudioContext' };
    expect(canExportGate(capabilities)).toBe(false);
  });
});

describe('ExportPanel', () => {
  beforeEach(() => {
    media.get.mockReset();
    media.get.mockResolvedValue(null);
  });

  it('renders nothing without a project', () => {
    const { container } = renderPanel({ project: null, episode: null });
    expect(container).toBeEmptyDOMElement();
  });

  it('names the episode and its frame count before anything is clicked', () => {
    renderPanel();
    // The numbers in every later progress message come from these, so they have to be
    // checkable before the user commits to a wait.
    expect(screen.getByText(/EP001/)).toBeDefined();
    expect(screen.getByText(/frame/)).toBeDefined();
    expect(screen.getByText(/fps/)).toBeDefined();
  });

  it('lists every capability with its availability', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByText('png-still')).toBeDefined();
    });
    for (const name of ['png-still', 'png-sequence', 'audio-mixdown', 'video-webm']) {
      expect(screen.getByText(name)).toBeDefined();
    }
  });

  it('offers both export paths', async () => {
    renderPanel();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'PNG still' })).toBeDefined();
    });
    expect(screen.getByRole('button', { name: 'Export episode' })).toBeDefined();
  });

  it('refuses to export an episode with no playable scenes, and says why', async () => {
    // The cut is emptied in the *project*, not in a prop: the panel resolves the episode by
    // id, which is the behaviour that keeps it honest about the document it was given.
    const seed = seedEpisode(SEED_PROJECT);
    const project: Project = {
      ...SEED_PROJECT,
      episodes: [{ ...seed, sceneIds: [] }, ...SEED_PROJECT.episodes.slice(1)],
    };
    renderPanel({ project });

    const button = await enabledButton('Export episode');
    button.click();

    // Reported, not silently a no-op: a click that does nothing looks like a dead button.
    await waitFor(() => {
      expect(screen.getByText(/no playable scenes/i)).toBeDefined();
    });
  });

  it('reports progress while it works, and a value a test can read', async () => {
    // The first frame is held open, so the export is caught mid-flight on purpose rather
    // than by luck. An export that sits blank and then completes is indistinguishable from a
    // hung tab, and `aria-valuenow` is what makes the progress available to a screen reader
    // and to a test that cannot see a coloured bar.
    let release: () => void = () => undefined;
    toBlobGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    renderPanel();
    const button = await enabledButton('Export episode');
    button.click();

    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toMatch(/^\d+$/);
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();

    release();
    await waitFor(() => {
      expect(screen.queryByRole('progressbar')).toBeNull();
    });
  });

  it('completes a sequence export and reports the frames and the mixdown', async () => {
    const { project, episode } = tinyProject();
    renderPanel({ project, episode });
    const button = await enabledButton('Export episode');

    button.click();

    await waitFor(() => {
      expect(screen.getByText(/Exported \d+ frames/)).toBeDefined();
    });

    // The count in the message has to be the count the exporter produced, or the number is
    // decoration.
    expect(screen.getByText(/Exported 12 frames/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Download \d+ PNGs/ })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Download mixdown' })).toBeDefined();
  });

  it('calls a mixdown with no audio in it silent, rather than clean', async () => {
    // Nothing in the document says "this scene is quiet" — it just has no clips. The export
    // is a real WAV of the right length with nothing inside it, and "a 0-segment mixdown"
    // would let an operator mail that off believing a bed was mixed.
    const { project, episode } = tinyProject();
    renderPanel({ project, episode });
    const button = await enabledButton('Export episode');

    button.click();

    await waitFor(() => {
      expect(screen.getByText(/Exported 12 frames/)).toBeDefined();
    });
    expect(screen.getByText(/silent/i)).toBeDefined();
    expect(screen.queryByText(/0-segment/)).toBeNull();
  });

  it('reports the segment count when there was audio to mix', async () => {
    const { project, episode } = tinyProject(true);
    renderPanel({ project, episode });
    const button = await enabledButton('Export episode');

    button.click();

    await waitFor(() => {
      expect(screen.getByText(/Exported 12 frames/)).toBeDefined();
    });
    // The fixture's clip points at a `src: null` slot, so it is reported as a segment that
    // could not be mixed rather than counted as mixed. That is the correct reading, and it is
    // the same reason this file cannot prove the audible branch: see `describeResult` below.
    expect(screen.getByText(/could not be mixed/i)).toBeDefined();
  });

  it('stops on cancel and keeps what it had already produced', async () => {
    let release: () => void = () => undefined;
    toBlobGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    renderPanel();
    const button = await enabledButton('Export episode');
    button.click();

    await screen.findByRole('progressbar');
    screen.getByRole('button', { name: 'Cancel' }).click();
    release();

    // Cancelling reports itself rather than leaving a finished-looking panel, and it does
    // not offer a download of a sequence that stops halfway.
    await waitFor(() => {
      expect(screen.getByText(/Export cancelled/)).toBeDefined();
    });
    expect(screen.queryByRole('button', { name: /Download \d+ PNGs/ })).toBeNull();
  });

  it('names every audio segment it could not mix, rather than reporting a clean export', async () => {
    // The seed's slots are all fileless, so a real export produces a mixdown with nothing
    // in it. The panel must say so: a silent file presented as a finished mixdown is the one
    // outcome an operator cannot detect without listening to the whole episode.
    const { project, episode } = tinyProject(true);
    renderPanel({ project, episode });
    const button = await enabledButton('Export episode');

    button.click();

    await waitFor(() => {
      expect(screen.getByText(/could not be mixed/i)).toBeDefined();
    });
    expect(screen.getByText(/no file attached/)).toBeDefined();
    // The segment is named, not counted: "1 segment" leaves the operator to work out which.
    expect(screen.getByText(/audio\.ambience\.apartment/)).toBeDefined();
  });

  it('exports a still without requiring the whole episode', async () => {
    renderPanel({ currentTime: 1.5 });
    const button = await enabledButton('PNG still');
    button.click();

    await waitFor(() => {
      expect(screen.getByText(/Still exported at 1\.50s/)).toBeDefined();
    });
    expect(screen.getByRole('button', { name: 'Download still' })).toBeDefined();
  });

  it('exports the episode the panel was pointed at, not the first one', async () => {
    // The panel takes an id. If it silently fell back to document order, a project with two
    // cuts would export the wrong one and name it in the filename.
    const { project, episode } = tinyProject();
    renderPanel({ project, episode });
    // Matched by function, not by string: the title is one text node among several in the
    // summary line, so `getByText('Short')` would fail for reasons that have nothing to do
    // with which episode was chosen.
    await waitFor(() => {
      expect(
        screen.getByText((_content, node) => node?.textContent?.startsWith('Short') === true),
      ).toBeDefined();
    });
    // The seed episode is still present and first, so a document-order fallback would show
    // its title here. `queryAll`, not `query`: a matcher that throws on "not found" cannot
    // be used to assert absence.
    expect(
      screen.queryAllByText((_content, node) => node?.textContent?.startsWith('EP001') === true),
    ).toHaveLength(0);
  });

  it('renders nothing when the id names no episode in the project', () => {
    // A stale id after a project switch must not export the first episode instead.
    const { container } = render(
      <ExportPanel project={SEED_PROJECT} episodeId={'episode.does-not-exist'} currentTime={0} subtitles />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('clears a finished export on request', async () => {
    renderPanel({ currentTime: 0 });
    const button = await enabledButton('PNG still');
    button.click();

    const clear = await enabledButton('Clear');
    clear.click();

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Download still' })).toBeNull();
    });
  });
});

/**
 * The result sentence, tested as the plain function it is.
 *
 * The three branches are the three things an export can be, and the mistake worth guarding is
 * the middle one being reported as the best one. An episode with no audio in it produces a
 * perfectly valid WAV containing silence; a message that says "0-segment mixdown" invites the
 * reader to treat it as a successful, if uneventful, export and hand it on.
 */
describe('describeResult', () => {
  it('counts the segments it actually mixed', () => {
    expect(describeResult(288, 6, 0)).toBe('Exported 288 frames and a 6-segment mixdown.');
  });

  it('says the mixdown is silent when nothing was placed in it', () => {
    const message = describeResult(288, 0, 0);
    expect(message).toMatch(/silent/i);
    expect(message).toMatch(/no audio is placed/i);
    expect(message).not.toMatch(/0-segment/);
  });

  it('leads with the failure when something could not be mixed', () => {
    // A missing segment is not a small blemish on a successful export, so it outranks the
    // count in the sentence rather than being appended to it.
    const message = describeResult(288, 4, 2);
    expect(message).toMatch(/2 audio segment\(s\) could not be mixed/);
    expect(message).not.toMatch(/mixdown\.$/);
  });
});
