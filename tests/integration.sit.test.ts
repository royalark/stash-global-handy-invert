/**
 * Cross-repo integration: the real StashInteractiveTools fork code (patcher,
 * enableHandyTokens CSV pipeline, extension API) + this plugin's provider
 * wrapper and transform. Only `fetch` and the Handy device are faked.
 *
 * Needs the SIT fork source (royalark/StashInteractiveTools, branch
 * feat/extension-api, with node_modules installed) at ../StashInteractiveTools
 * next to this repository, or SIT_SRC=/path/to/StashInteractiveTools/src.
 * Skipped when it is not available.
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { wrapClient } from '../src/client';
import { connectSit, createSitTransform } from '../src/sit';
import { createStatusBus } from '../src/status';

const SIT_SRC = resolve(
  process.env.SIT_SRC ??
    fileURLToPath(new URL('../../StashInteractiveTools/src', import.meta.url)),
);
const hasSit = existsSync(resolve(SIT_SRC, 'utils/interactive/extensions.ts'));

let patchMethod: any;
let DEFAULT_PATCHES: any[];
let enableHandyTokens: any;
let extensionApi: any;
let __resetExtensionsForTests: () => void;
let __resetGateForTests: () => void;

beforeAll(async () => {
  if (!hasSit) return;
  // DOM/video.js helpers are not needed here
  vi.doMock(resolve(SIT_SRC, 'utils/interactive/utils.ts'), () => ({
    getPlayerPosition: () => 0,
  }));
  ({ patchMethod } = await import(resolve(SIT_SRC, 'utils/interactive-api-patcher.ts')));
  ({ DEFAULT_PATCHES } = await import(resolve(SIT_SRC, 'utils/interactive/patches/index.ts')));
  ({ enableHandyTokens } = await import(resolve(SIT_SRC, 'utils/interactive/hooks/index.ts')));
  ({ extensionApi, __resetExtensionsForTests } = await import(
    resolve(SIT_SRC, 'utils/interactive/extensions.ts')
  ));
  ({ __resetGateForTests } = await import(resolve(SIT_SRC, 'utils/interactive/patches/gate.ts')));
});

/* eslint-disable @typescript-eslint/no-explicit-any */

const LOW = { actions: [0, 30, 60].map((pos, i) => ({ at: i * 100, pos })) };
const HIGH = { actions: [10, 90].map((pos, i) => ({ at: i * 50, pos })) };

function world(opts: { withExtensionApi: boolean }) {
  const csvs: number[][] = [];
  const files: Record<string, unknown> = { 'blob:low': LOW, 'blob:high': HIGH };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('handyfeeling.com/api/sync/upload')) {
        const text = await ((init!.body as FormData).get('syncFile') as File).text();
        csvs.push(
          text
            .split(/\r?\n/)
            .filter((l) => /^\d/.test(l))
            .map((l) => Number(l.split(',')[1])),
        );
        return new Response(JSON.stringify({ url: `https://csv.test/${csvs.length}` }));
      }
      return new Response(JSON.stringify(files[url]));
    }),
  );

  const settings = { enabled: false };
  const status = createStatusBus();
  const resolveEnabled = async () => settings.enabled;
  const win = new EventTarget() as any;
  if (opts.withExtensionApi) win.StashInteractiveTools = extensionApi;
  const sit = connectSit(win, createSitTransform({ resolveEnabled, status }), status);

  // Stash creates its client through our provider wrapper
  const stashClient = {
    _handy: { setHsspStop: vi.fn(async () => undefined) },
    handyKey: 'KEY',
    async uploadScript() {
      throw new Error('built-in upload must not be used once SIT patched');
    },
    async play() {},
    async ensurePlaying() {},
    async pause() {},
    async connect() {},
    async sync() {
      return 0;
    },
    set scriptOffset(_: number) {},
  };
  const client = wrapClient(stashClient, { resolveEnabled, sitApi: sit.api, status }) as any;

  // ... and SIT patches that client, as InteractiveToolsProvider does
  const device = {
    id: 'handy',
    isConnected: true,
    isPlaying: false,
    loadScript: vi.fn(async () => ({ success: true })),
    stop: vi.fn(async () => {
      device.isPlaying = false;
      return true;
    }),
    play: vi.fn(async () => {
      device.isPlaying = true;
      return true;
    }),
    syncTime: vi.fn(),
    getConfig: () => ({}),
  };
  const state = {
    current: {
      id: '',
      sceneId: '1',
      ivdb: false,
      script: LOW,
      blobUrl: 'blob:low' as string | null,
      hooks: [enableHandyTokens],
      device,
      modifiers: [],
      config: {} as any,
    },
  };
  const ctx: any = { api: client, state };
  const dispatcher = async (_e: unknown, payload: any) => ({
    ...payload,
    ...(await enableHandyTokens.apply({ ...ctx, logger: console } as any, payload)),
  });
  DEFAULT_PATCHES.forEach((p) => patchMethod(ctx, p as any, dispatcher as any));

  return { client, csvs, device, settings, state, status, stashClient };
}

beforeEach(() => {
  if (!hasSit) return;
  __resetExtensionsForTests();
  __resetGateForTests();
});
afterEach(() => vi.unstubAllGlobals());

describe.skipIf(!hasSit)('SIT fork with extension API + Global Invert', () => {
  it('OFF -> raw, ON -> mirrored, for every selected script (Default/LOW/HIGHER...)', async () => {
    const w = world({ withExtensionApi: true });
    await w.client.uploadScript('blob:low');
    w.settings.enabled = true;
    await w.client.uploadScript('blob:low');
    w.state.current.blobUrl = 'blob:high'; // user picks another script in ScriptChooser
    await w.client.uploadScript('blob:high');
    expect(w.csvs).toEqual([
      [0, 30, 60],
      [100, 70, 40],
      [90, 10],
    ]);
    expect(w.status.get().status).toEqual({ kind: 'ready', via: 'sit', inverted: true });
  });

  it('re-uploading the same script never double-inverts', async () => {
    const w = world({ withExtensionApi: true });
    w.settings.enabled = true;
    for (let i = 0; i < 4; i++) await w.client.uploadScript('blob:low');
    expect(new Set(w.csvs.map((c) => c.join()))).toEqual(new Set(['100,70,40']));
  });

  it('invalid script while ON: nothing uploaded, device stopped, play refused', async () => {
    const w = world({ withExtensionApi: true });
    w.settings.enabled = true;
    w.state.current.blobUrl = 'blob:bad';
    await expect(w.client.uploadScript('blob:bad')).rejects.toThrow();
    await w.client.play(0);
    expect(w.csvs).toEqual([]);
    expect(w.device.loadScript).not.toHaveBeenCalled();
    expect(w.device.play).not.toHaveBeenCalled();
    expect(w.status.get().status.kind).toBe('blocked');
  });
});

describe.skipIf(!hasSit)('unmodified SIT (no extension API) + Global Invert', () => {
  it('ON: refuses instead of sending an un-inverted script', async () => {
    const w = world({ withExtensionApi: false });
    w.settings.enabled = true;
    await expect(w.client.uploadScript('blob:low')).rejects.toThrow(/extension API/);
    await w.client.play(0);
    expect(w.csvs).toEqual([]);
    expect(w.device.play).not.toHaveBeenCalled();
  });

  it('OFF: SIT behaves exactly as without the plugin', async () => {
    const w = world({ withExtensionApi: false });
    await w.client.uploadScript('blob:low');
    await w.client.play(0);
    expect(w.csvs).toEqual([[0, 30, 60]]);
    expect(w.device.play).toHaveBeenCalled();
  });
});
