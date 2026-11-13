import { describe, expect, it, vi } from 'vitest';
import {
  connectSit,
  createSitTransform,
  CUSTOM_INVERT_WARNING,
  SIT_GLOBAL,
  SIT_READY_EVENT,
  TRANSFORM_ID,
} from '../src/sit';
import { createStatusBus } from '../src/status';

const ctx = (modifiers: { id: string; values: Record<string, unknown> }[] = []) => ({
  sceneId: '1',
  deviceId: 'handy',
  generation: 1,
  modifiers,
});
const script = { actions: [{ at: 0, pos: 20 }] };

describe('SIT output transform', () => {
  it('OFF: leaves the script alone', async () => {
    const t = createSitTransform({ resolveEnabled: async () => false, status: createStatusBus() });
    expect(await t.transform({ kind: 'actions', script }, ctx())).toBeUndefined();
  });

  it('ON: mirrors', async () => {
    const t = createSitTransform({ resolveEnabled: async () => true, status: createStatusBus() });
    expect(await t.transform({ kind: 'actions', script }, ctx())).toEqual({
      actions: [{ at: 0, pos: 80 }],
    });
  });

  it.each(['handy-token', 'ivdb'])('ON: refuses opaque %s scripts', async (reason) => {
    const t = createSitTransform({ resolveEnabled: async () => true, status: createStatusBus() });
    await expect(t.transform({ kind: 'opaque', reason }, ctx())).rejects.toThrow(/cannot be inverted/);
  });

  it('OFF: opaque scripts play normally', async () => {
    const t = createSitTransform({ resolveEnabled: async () => false, status: createStatusBus() });
    await expect(t.transform({ kind: 'opaque', reason: 'ivdb' }, ctx())).resolves.toBeUndefined();
  });

  it('warns when a SIT Custom modifier already inverts', async () => {
    const status = createStatusBus();
    const t = createSitTransform({ resolveEnabled: async () => true, status });
    await t.transform(
      { kind: 'actions', script },
      ctx([{ id: 'custom', values: { functionText: 'return actions.map(a=>({at:a.at,pos:100-a.pos}))' } }]),
    );
    expect(status.get().warning).toBe(CUSTOM_INVERT_WARNING);
    await t.transform({ kind: 'actions', script }, ctx());
    expect(status.get().warning).toBeUndefined();
  });
});

describe('connectSit', () => {
  const fakeApi = () => ({
    apiVersion: 1,
    registerOutputTransform: vi.fn(),
    subscribe: vi.fn(),
    reupload: vi.fn(),
    getState: () => ({ activeSceneId: null }),
  });
  const transform = createSitTransform({ resolveEnabled: async () => true, status: createStatusBus() });

  it('attaches when SIT loaded first', () => {
    const win = new EventTarget() as any;
    win[SIT_GLOBAL] = fakeApi();
    const sit = connectSit(win, transform, createStatusBus());
    expect(sit.api()).toBe(win[SIT_GLOBAL]);
    expect(win[SIT_GLOBAL].registerOutputTransform).toHaveBeenCalledWith(transform);
  });

  it('attaches when SIT loads later (ready event), only once', () => {
    const win = new EventTarget() as any;
    const sit = connectSit(win, transform, createStatusBus());
    expect(sit.api()).toBeUndefined();
    const api = fakeApi();
    win.dispatchEvent(new CustomEvent(SIT_READY_EVENT, { detail: api }));
    win.dispatchEvent(new CustomEvent(SIT_READY_EVENT, { detail: api }));
    expect(sit.api()).toBe(api);
    expect(api.registerOutputTransform).toHaveBeenCalledTimes(1);
  });

  it('ignores an unsupported api version', () => {
    const win = new EventTarget() as any;
    win[SIT_GLOBAL] = { ...fakeApi(), apiVersion: 0 };
    expect(connectSit(win, transform, createStatusBus()).api()).toBeUndefined();
  });

  it('maps SIT events to status', () => {
    const win = new EventTarget() as any;
    const api = fakeApi();
    win[SIT_GLOBAL] = api;
    const status = createStatusBus();
    connectSit(win, transform, status);
    const listener = api.subscribe.mock.calls[0][0];
    listener({ type: 'upload-success', sceneId: '1', appliedTransforms: [TRANSFORM_ID] });
    expect(status.get().status).toEqual({ kind: 'ready', via: 'sit', inverted: true });
    listener({ type: 'upload-failed', sceneId: '1', message: 'x' });
    expect(status.get().status).toEqual({ kind: 'blocked', message: 'x' });
  });
});
