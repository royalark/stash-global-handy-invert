import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hostedFunscriptMessage,
  installClientProvider,
  legacySitMessage,
  wrapClient,
} from '../src/client';
import { stashOutputPositions } from '../src/invert';
import { createStatusBus } from '../src/status';

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Minimal stand-in for Stash v0.32.0's `Interactive` class. */
class FakeStashClient {
  _handy = { setHsspStop: vi.fn(async () => undefined) };
  handyKey = 'KEY';
  useStashHostedFunscript = false;
  playing = false;
  sent: number[][] = [];
  constructor(private files: Record<string, any>) {}
  async uploadScript(path: string) {
    // Stash fetches the path and converts it (honouring inverted/range)
    this.sent.push(stashOutputPositions(this.files[path]));
  }
  async play() {
    this.playing = true;
  }
  async ensurePlaying() {
    if (!this.playing) await this.play();
  }
  async pause() {
    this.playing = false;
  }
}

const SCRIPT = { actions: [0, 25, 100].map((pos, i) => ({ at: i * 100, pos })) };

function setup(opts: { enabled?: boolean; sit?: any } = {}) {
  const files: Record<string, any> = { '/scene/1/funscript': SCRIPT };
  let blobs = 0;
  const base = new FakeStashClient(files);
  const status = createStatusBus();
  const state = { enabled: opts.enabled ?? true };
  const deps = {
    resolveEnabled: vi.fn(async () => state.enabled),
    sitApi: () => opts.sit,
    status,
    fetchJson: vi.fn(async (url: string) => {
      if (!(url in files)) throw new Error('404');
      return structuredClone(files[url]);
    }),
    createObjectUrl: (json: string) => {
      const url = `blob:${++blobs}`;
      files[url] = JSON.parse(json);
      return url;
    },
    revokeObjectUrl: vi.fn(),
  };
  const client = wrapClient(base, deps) as any;
  return { base, client, deps, files, status, state };
}

describe('built-in Stash path', () => {
  it('OFF: unchanged, path passed through', async () => {
    const t = setup({ enabled: false });
    await t.client.uploadScript('/scene/1/funscript');
    expect(t.base.sent).toEqual([[0, 25, 100]]);
    expect(t.deps.fetchJson).not.toHaveBeenCalled();
  });

  it('ON: device receives the mirrored script, exactly once per upload', async () => {
    const t = setup();
    await t.client.uploadScript('/scene/1/funscript');
    await t.client.uploadScript('/scene/1/funscript');
    expect(t.base.sent).toEqual([
      [100, 75, 0],
      [100, 75, 0],
    ]);
    expect(t.deps.revokeObjectUrl).toHaveBeenCalledTimes(2);
    expect(t.status.get().status).toEqual({ kind: 'ready', via: 'stash', inverted: true });
  });

  it('ON + inverted:true script: still exactly one physical flip vs. OFF', async () => {
    const t = setup();
    t.files['/inv'] = { ...SCRIPT, inverted: true };
    await t.client.uploadScript('/inv');
    t.state.enabled = false;
    await t.client.uploadScript('/inv');
    const [on, off] = t.base.sent;
    expect(on.map((p, i) => p + off[i])).toEqual([100, 100, 100]);
  });

  it('invalid script while ON: nothing sent, device stopped, playback refused', async () => {
    const t = setup();
    t.files['/bad'] = { actions: [{ at: 0, pos: 150 }] };
    t.base.playing = true;
    await expect(t.client.uploadScript('/bad')).rejects.toThrow();
    expect(t.base.sent).toEqual([]);
    expect(t.base.playing).toBe(false);
    expect(t.base._handy.setHsspStop).toHaveBeenCalled();
    await t.client.play(1);
    await t.client.ensurePlaying(1);
    expect(t.base.playing).toBe(false);
    expect(t.status.get().status.kind).toBe('blocked');
  });

  it('a later good upload clears the block', async () => {
    const t = setup();
    t.files['/bad'] = { actions: [] };
    await expect(t.client.uploadScript('/bad')).rejects.toThrow();
    await t.client.uploadScript('/scene/1/funscript');
    await t.client.play(1);
    expect(t.base.playing).toBe(true);
  });

  it('Stash-hosted funscript mode cannot be inverted: refuses instead of sending raw', async () => {
    const t = setup();
    t.base.useStashHostedFunscript = true;
    await expect(t.client.uploadScript('/scene/1/funscript')).rejects.toThrow(
      hostedFunscriptMessage(),
    );
    expect(t.base.sent).toEqual([]);
  });

  it('settings unreadable: refuses (never guesses OFF)', async () => {
    const t = setup();
    t.deps.resolveEnabled.mockRejectedValue(new Error('no settings'));
    await expect(t.client.uploadScript('/scene/1/funscript')).rejects.toThrow('no settings');
    expect(t.base.sent).toEqual([]);
  });

  it('rapid switching: an older upload never lands after a newer one', async () => {
    const t = setup();
    t.files['/b'] = { actions: [{ at: 0, pos: 10 }] };
    let release!: () => void;
    t.deps.resolveEnabled.mockImplementationOnce(
      () => new Promise((r) => (release = () => r(true))),
    );
    const first = t.client.uploadScript('/scene/1/funscript');
    // the first upload is now in flight (waiting on the slow settings read)
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const second = t.client.uploadScript('/b');
    release();
    await Promise.all([first, second]);
    expect(t.base.sent).toEqual([[90]]);
  });

  it('refuses playback while an upload is in flight', async () => {
    const t = setup();
    let release!: () => void;
    t.deps.resolveEnabled.mockImplementationOnce(
      () => new Promise((r) => (release = () => r(true))),
    );
    const pending = t.client.uploadScript('/scene/1/funscript');
    await t.client.play(1);
    expect(t.base.playing).toBe(false);
    release();
    await pending;
    await t.client.play(1);
    expect(t.base.playing).toBe(true);
  });

  it('keeps getters/setters of the real client working through the proxy', () => {
    const t = setup();
    t.client.handyKey = 'OTHER';
    expect(t.base.handyKey).toBe('OTHER');
  });
});

/** Simulates StashInteractiveTools' patcher (Object.defineProperty on the client). */
function sitPatch(client: any, name: string, fn: any) {
  fn._patched = true;
  Object.defineProperty(client, name, {
    value: fn,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

describe('StashInteractiveTools path', () => {
  it('SIT patches are intercepted and keep their _patched marker', () => {
    const t = setup();
    sitPatch(t.client, 'uploadScript', vi.fn());
    expect(Object.getOwnPropertyDescriptor(t.client, 'uploadScript')!.value._patched).toBe(true);
  });

  it('SIT with extension API: passes straight through (SIT runs the transform)', async () => {
    const t = setup({ sit: { apiVersion: 1 } });
    const sitUpload = vi.fn(async () => undefined);
    sitPatch(t.client, 'uploadScript', sitUpload);
    await t.client.uploadScript('blob:x');
    expect(sitUpload).toHaveBeenCalledWith('blob:x');
    expect(t.deps.fetchJson).not.toHaveBeenCalled();
  });

  it('SIT without extension API + ON: refuses upload and playback', async () => {
    const t = setup();
    const sitUpload = vi.fn(async () => undefined);
    const sitPlay = vi.fn(async () => undefined);
    sitPatch(t.client, 'uploadScript', sitUpload);
    sitPatch(t.client, 'play', sitPlay);
    sitPatch(t.client, 'ensurePlaying', sitPlay);
    await expect(t.client.uploadScript('blob:x')).rejects.toThrow(legacySitMessage());
    await t.client.play(1);
    await t.client.ensurePlaying(1);
    expect(sitUpload).not.toHaveBeenCalled();
    expect(sitPlay).not.toHaveBeenCalled();
    expect(t.status.get().status).toEqual({ kind: 'blocked', message: legacySitMessage() });
  });

  it('names the SIT build that is actually loaded (duplicate install hint)', async () => {
    const t = setup();
    const client = wrapClient(new FakeStashClient(t.files), {
      ...t.deps,
      describeSit: async () => ({ name: 'Stash Interactive Tools', version: '1.1.0-next' }),
    }) as any;
    sitPatch(client, 'uploadScript', vi.fn());
    await expect(client.uploadScript('blob:x')).rejects.toThrow(
      /Loaded now: "Stash Interactive Tools" 1\.1\.0-next\. Stash loads only one plugin per ID/,
    );
  });

  it('SIT without extension API + OFF: SIT works exactly as before', async () => {
    const t = setup({ enabled: false });
    const sitUpload = vi.fn(async () => undefined);
    const sitPlay = vi.fn(async () => undefined);
    sitPatch(t.client, 'uploadScript', sitUpload);
    sitPatch(t.client, 'play', sitPlay);
    await t.client.uploadScript('blob:x');
    await t.client.play(1);
    expect(sitUpload).toHaveBeenCalled();
    expect(sitPlay).toHaveBeenCalled();
  });
});

describe('play guard', () => {
  it('refuses to start the device while the guard says the script is stale', async () => {
    const t = setup({ enabled: false });
    const guard = vi.fn(() => true);
    (t.deps as any).playGuard = guard;
    const client = wrapClient(new FakeStashClient(t.files), t.deps) as any;
    await client.uploadScript('/scene/1/funscript');
    await client.play(1);
    await client.ensurePlaying(1);
    expect(guard).toHaveBeenCalledTimes(2);
    expect(client.playing).toBe(false);
    guard.mockReturnValue(false);
    await client.play(1);
    expect(client.playing).toBe(true);
  });

  it('also guards StashInteractiveTools\' play', async () => {
    const t = setup({ enabled: false });
    const client = wrapClient(new FakeStashClient(t.files), { ...t.deps, playGuard: () => true }) as any;
    const sitPlay = vi.fn(async () => undefined);
    sitPatch(client, 'play', sitPlay);
    await client.play(1);
    expect(sitPlay).not.toHaveBeenCalled();
  });
});

describe('installClientProvider', () => {
  let utils: any;
  beforeEach(() => {
    utils = {};
  });
  const deps = () => ({
    resolveEnabled: async () => false,
    sitApi: () => undefined,
    status: createStatusBus(),
  });

  it('wraps the default client when no other provider exists', () => {
    installClientProvider(utils, deps());
    const base = new FakeStashClient({});
    const client = utils.interactiveClientProvider({ defaultClientProvider: () => base });
    expect(client).not.toBe(base);
    expect(client.handyKey).toBe('KEY');
  });

  it('chains a provider registered by another plugin instead of replacing it', () => {
    const other = vi.fn(() => new FakeStashClient({}));
    utils.interactiveClientProvider = other;
    installClientProvider(utils, deps());
    utils.interactiveClientProvider({ defaultClientProvider: () => null });
    expect(other).toHaveBeenCalled();
  });
});
