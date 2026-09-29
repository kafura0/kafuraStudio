/**
 * The Web Audio engine — scheduling behaviour against a fake port, no browser.
 *
 * The engine is the only browser-coupled module in the audio path (the `.browser`
 * suffix exists for RULE 5); these tests pin its contract: schedule within the
 * lookahead, honest silence when a buffer is missing, one source per clip, and a
 * rewind clears the schedule so nothing ghosts in the output.
 */
import { describe, expect, it } from 'vitest';
import { AudioEngine, type AudioPort } from './audioEngine.browser';
import { createProject, createScene } from '../document/factories';
import { addSimpleClip } from '../document/trackOps';
import type { Id, Project, Scene } from '../types';

type FakeBuffer = { data: string };

interface StartCall {
  when: number;
  offset: number | undefined;
  duration: number | undefined;
}

class FakeSource {
  buffer: FakeBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  started: StartCall | null = null;
  stopped = false;
  stoppedAt: number | undefined;
  connectedTo: unknown = null;
  start(when: number, offset?: number, duration?: number): void {
    this.started = { when, offset, duration };
  }
  stop(when?: number): void {
    this.stopped = true;
    this.stoppedAt = when;
  }
  connect(node: unknown): void {
    this.connectedTo = node;
  }
}

class FakeGain {
  readonly gain = { value: 0 };
  connectsTo: unknown = null;
  disconnected = false;
  connect(node: unknown): void {
    this.connectsTo = node;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

class FakePort implements AudioPort {
  currentTime = 10;
  readonly sources: FakeSource[] = [];
  readonly gains: FakeGain[] = [];
  readonly destination = { connect: (_node: unknown): void => undefined };
  createGain(): FakeGain {
    const gain = new FakeGain();
    this.gains.push(gain);
    return gain;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
}

function launch(): { engine: AudioEngine; port: FakePort; project: Project; scene: Scene } {
  const port = new FakePort();
  const engine = new AudioEngine(port, resolver({ data: 'voice' }));
  const scene = createScene('S', 'env', { duration: 10 });
  const project: Project = {
    ...createProject('A'),
    assets: {
      ...createProject('A').assets,
      audio: [{ id: 'vo', name: 'vo', kind: 'dialogue', src: null, duration: 8, tags: [] }],
    },
    scenes: [scene],
  };
  const built = addSimpleClip(project, scene.id, 'audio', 'vo', 'cue', 2, 3, { audioId: 'vo' });
  const sceneWithTrack = built.project.scenes.find((s) => s.id === scene.id);
  if (!sceneWithTrack) throw new Error('scene missing');
  return { engine, port, project: built.project, scene: sceneWithTrack };
}

function resolver(buffer: FakeBuffer | null): (id: Id) => Promise<FakeBuffer | null> {
  return async () => buffer;
}

async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe('AudioEngine', () => {
  it('schedules a segment that is inside the lookahead', async () => {
    const { engine, port, project, scene } = launch();
    engine.schedule(project, scene, 2); // clip starts at 2 → on the mark
    await tick();
    const source = port.sources[0];
    if (!source) throw new Error('no source created');
    expect(source.started?.when).toBeCloseTo(10, 6); // port.currentTime + startIn(0)
    expect(source.started?.duration).toBe(3);
    if (!port.gains[0]) throw new Error('no gain node');
    expect(port.gains[0].gain.value).toBe(1);
    expect(port.gains[0].connectsTo).toBe(port.destination);
  });

  it('is silent when the buffer cannot be resolved', async () => {
    const port = new FakePort();
    const engine = new AudioEngine(port, resolver(null));
    const { project, scene } = launch();
    engine.schedule(project, scene, 2);
    await tick();
    expect(port.sources).toHaveLength(0);
  });

  it('ignores segments beyond the lookahead', async () => {
    const { engine, port, project, scene } = launch();
    engine.schedule(project, scene, 0); // clip starts at 2 → 2s ahead, past the lookahead
    await tick();
    expect(port.sources).toHaveLength(0);
  });

  it('starts exactly one source per clip, even when scheduled repeatedly', async () => {
    const { engine, port, project, scene } = launch();
    engine.schedule(project, scene, 2);
    engine.schedule(project, scene, 2.2);
    engine.schedule(project, scene, 2.4);
    await tick();
    expect(port.sources).toHaveLength(1);
  });

  it('clears the schedule when time rewinds', async () => {
    const { engine, port, project, scene } = launch();
    engine.schedule(project, scene, 2);
    await tick();
    expect(port.sources).toHaveLength(1);
    // Rewind to 1: the engine must tear down and forget every clip so a later
    // forward pass can reschedule from scratch.
    engine.schedule(project, scene, 1);
    const port2 = new FakePort();
    const engine2 = new AudioEngine(port2, resolver({ data: 'v' }));
    engine2.schedule(project, scene, 2);
    await tick();
    expect(port.sources[0]?.stopped).toBe(true);
    expect(port2.sources).toHaveLength(1);
  });

  it('plays one-shots once, with no loop', async () => {
    const { engine, port, project, scene } = launch();
    engine.schedule(project, scene, 2);
    await tick();
    const source = port.sources[0];
    if (!source) throw new Error('no source');
    expect(source.loop).toBe(false);
    expect(source.started?.offset).toBe(0);
  });

  it('clamps gain and treats non-finite gain as 1', async () => {
    const { engine, port, project, scene } = launch();
    const hurt = { ...scene, tracks: scene.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, gain: 99 })) })) };
    const weird = { ...scene, tracks: scene.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => ({ ...c, gain: Number.NaN })) })) };
    engine.schedule(project, hurt, 2);
    await tick();
    expect(port.gains[0]?.gain.value).toBe(2);
    const port2 = new FakePort();
    const engine2 = new AudioEngine(port2, resolver({ data: 'v' }));
    engine2.schedule(project, weird, 2);
    await tick();
    expect(port2.gains[0]?.gain.value).toBe(1);
  });

  it('stop() tears down every live source', async () => {
    const { engine, port, project, scene } = launch();
    engine.schedule(project, scene, 2);
    await tick();
    const source = port.sources[0];
    if (!source) throw new Error('no source');
    const gain = port.gains[0];
    if (!gain) throw new Error('no gain');
    engine.stop();
    expect(source.stopped).toBe(true);
    expect(gain.disconnected).toBe(true);
  });
});