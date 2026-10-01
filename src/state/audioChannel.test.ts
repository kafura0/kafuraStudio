/**
 * F6 — THE AUDIO ENGINE MUST NOT OUTLIVE THE PROJECT IT WAS BUILT FOR.
 *
 * The engine resolves clip ids to decoded buffers once, at construction, from the asset
 * list it was handed. Cached at module scope without recording whose assets those were,
 * the first project to ever play owned the engine forever: after switching, playback
 * either fell silent or sounded like the wrong scene, and neither reads as an error.
 *
 * What is observable from outside is narrow but sufficient — an engine is a constructed
 * `AudioContext`, so counting constructions counts rebuilds, and the resolver is handed
 * the asset list of exactly one project.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, createScene, emptyAssetLibrary } from '../core/document/factories';
import { addSimpleClip } from '../core/document/trackOps';
import { resetPlaybackAudio, syncPlaybackAudio } from './audioChannel';
import type { AudioDef, Project } from '../core/types';

/** An audio asset with a `src`, so the resolver's lookup is observable. */
const audioDef = (id: string, src: string): AudioDef => ({
  id,
  name: id,
  kind: 'dialogue',
  src,
  duration: 1,
  tags: [],
  srcKind: 'external',
});

/**
 * A project with one scene carrying one audio cue that points at a named asset.
 *
 * Built from the factory rather than the seed: this test is about which asset map the
 * engine got, and importing the pilot's canon would make that depend on its contents.
 *
 * The cue is what makes the difference. An audio *asset* with nothing referencing it
 * produces no plan and no fetch, so a test with only the asset would pass against a
 * completely broken engine.
 */
const projectWith = (id: string, audioId: string): Project => {
  const base = createProject(id);
  const scene = createScene('SC01', 'env.blank', { duration: 10 });
  const withAsset: Project = {
    ...base,
    assets: { ...emptyAssetLibrary(), audio: [audioDef(audioId, `/${audioId}.wav`)] },
    scenes: [scene],
  };
  const built = addSimpleClip(withAsset, scene.id, 'audio', audioId, 'cue', 0, 2, {
    audioId,
  });
  return built.project;
};

let contexts = 0;
let fetched: string[] = [];

/**
 * Install a fake Web Audio global and a fake `fetch`.
 *
 * `createBrowserAudioEngine` returns null without an `AudioContext`, and the resolver
 * fetches a real URL otherwise — which in Node is an unhandled-looking `Invalid URL` and
 * a DEV warning per missing buffer. Faking both keeps the output about the assertions.
 */
function installFakeAudio(): void {
  contexts = 0;
  fetched = [];

  class FakeSource {
    buffer: unknown = null;
    loop = false;
    onended: (() => void) | null = null;
    start(): void {}
    stop(): void {}
    connect(): void {}
  }

  class FakeContext {
    currentTime = 0;
    readonly destination = {};
    createGain() {
      return { gain: { value: 1 }, connect: () => {}, disconnect: () => {} };
    }
    createBufferSource() {
      return new FakeSource();
    }
    async decodeAudioData(bytes: ArrayBuffer): Promise<unknown> {
      // The fake port never receives real audio, so what matters is which asset was
      // asked for — the payload just has to be decodable enough not to throw.
      return { decoded: new TextDecoder().decode(bytes) };
    }
  }

  (globalThis as unknown as { AudioContext: unknown }).AudioContext = function AudioContextStub() {
    contexts += 1;
    return new FakeContext();
  } as unknown as typeof AudioContext;

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      fetched.push(url);
      return { ok: true, arrayBuffer: async () => new TextEncoder().encode(url).buffer };
    }),
  );
}

/** Let the resolver's promise chain settle. */
async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  resetPlaybackAudio();
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
  vi.restoreAllMocks();
});

describe('the playback engine follows the open project', () => {
  it('builds one engine per project rather than reusing the first one', () => {
    installFakeAudio();
    const a = projectWith('A', 'voice.a');
    const b = projectWith('B', 'voice.b');

    syncPlaybackAudio(a, a.scenes[0]?.id ?? '', 0, true);
    expect(contexts).toBe(1);

    // The same project again must reuse the engine — rebuilding per frame would be a
    // per-frame `new AudioContext`, which is both a leak and a hard performance defect.
    syncPlaybackAudio(a, a.scenes[0]?.id ?? '', 0.1, true);
    expect(contexts).toBe(1);

    syncPlaybackAudio(b, b.scenes[0]?.id ?? '', 0, true);
    expect(contexts).toBe(2);
  });

  it('resolves clips against the new project, not the one that played first', async () => {
    installFakeAudio();
    const a = projectWith('A', 'voice.a');
    const b = projectWith('B', 'voice.b');

    syncPlaybackAudio(a, a.scenes[0]?.id ?? '', 0, true);
    await tick();
    expect(fetched).toContain('/voice.a.wav');

    fetched = [];
    syncPlaybackAudio(b, b.scenes[0]?.id ?? '', 0, true);
    await tick();

    // Whatever project is playing, only its own asset paths are ever requested. An engine
    // pinned to the first project would be asking for '/voice.a.wav' here.
    expect(fetched).toContain('/voice.b.wav');
    expect(fetched).not.toContain('/voice.a.wav');
  });

  it('drops the engine on reset so the next project starts clean', () => {
    installFakeAudio();
    const a = projectWith('A', 'voice.a');
    const b = projectWith('B', 'voice.b');

    syncPlaybackAudio(a, a.scenes[0]?.id ?? '', 0, true);
    expect(contexts).toBe(1);

    resetPlaybackAudio();
    syncPlaybackAudio(b, b.scenes[0]?.id ?? '', 0, true);

    // A reset must leave nothing behind: the cached engine is gone, so this is a new
    // AudioContext rather than a rebuild triggered by the id changing.
    expect(contexts).toBe(2);
  });

  it('is a no-op without a browser audio implementation', () => {
    // Headless test runs and any browser without Web Audio must not throw. This is the
    // path the seed project takes today, since every slot has `src: null`.
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    const a = projectWith('A', 'voice.a');
    expect(() => {
      syncPlaybackAudio(a, a.scenes[0]?.id ?? '', 0, true);
      resetPlaybackAudio();
    }).not.toThrow();
  });
});

describe('decoding does not open an AudioContext per file', () => {
  it('borrows the engine context instead of minting one per decoded file', async () => {
    installFakeAudio();

    // A single scene carrying many distinct assets, so the engine really does resolve many
    // separate files. The tell is the context count: a resolver that constructs its own
    // context per file adds one per asset, and a browser allows only a handful per page.
    const base = createProject('Many');
    const scene = createScene('SC01', 'env.blank', { duration: 30 });
    const ids = Array.from({ length: 12 }, (_, i) => `voice.${i}`);
    const many: Project = {
      ...base,
      assets: { ...emptyAssetLibrary(), audio: ids.map((id) => audioDef(id, `/${id}.wav`)) },
      scenes: [scene],
    };
    let built: Project = many;
    ids.forEach((id, i) => {
      built = addSimpleClip(built, scene.id, 'audio', id, `cue${i}`, i * 2, 1, { audioId: id }).project;
    });

    // Walk the playhead across the scene so every clip is genuinely scheduled. Seeking to
    // t=0 alone would resolve one file, and a one-file test cannot see a per-file context.
    for (const [i] of ids.entries()) {
      syncPlaybackAudio(built, scene.id, i * 2, true);
      await tick();
    }

    // One context for the engine. A per-file resolver would have reached 13 here.
    expect(contexts).toBe(1);
    // And every file was decoded, so this is not passing by never resolving anything.
    expect(fetched.length).toBe(ids.length);
  });
});
