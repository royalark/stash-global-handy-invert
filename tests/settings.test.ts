import { describe, expect, it, vi } from 'vitest';
import { ConfigBackend, createSettingsStore, PluginConfig } from '../src/settings';

function fakeBackend(initial: PluginConfig | undefined) {
  let server: PluginConfig = initial ?? {};
  let watcher: ((c: PluginConfig) => void) | undefined;
  const backend: ConfigBackend & { server: () => PluginConfig; push: (c: PluginConfig) => void } = {
    readCached: () => initial,
    fetchFresh: vi.fn(async () => ({ ...server })),
    write: vi.fn(async (c) => {
      server = { ...c };
    }),
    watch: (cb) => {
      watcher = cb;
      return () => undefined;
    },
    server: () => server,
    push: (c) => watcher?.(c),
  };
  return backend;
}

describe('settings store', () => {
  it('defaults to OFF when the plugin has no config yet', async () => {
    const s = createSettingsStore(fakeBackend({}), { channel: null });
    expect(s.enabled).toBe(false);
    expect(await s.resolveEnabled()).toBe(false);
  });

  it('is unknown (not OFF) before the configuration was loaded', () => {
    expect(createSettingsStore(fakeBackend(undefined), { channel: null }).enabled).toBeUndefined();
  });

  it('persists to the server and keeps other plugin keys', async () => {
    const b = fakeBackend({ enabled: false, other: 'x' });
    const s = createSettingsStore(b, { channel: null });
    await s.setEnabled(true);
    expect(b.server()).toEqual({ enabled: true, other: 'x' });
    expect(s.enabled).toBe(true);
  });

  it('resolveEnabled follows a change made elsewhere (another browser)', async () => {
    const b = fakeBackend({ enabled: false });
    const s = createSettingsStore(b, { channel: null });
    await b.write({ enabled: true });
    expect(await s.resolveEnabled()).toBe(true);
  });

  it('notifies listeners on change from Settings -> Plugins (cache watch)', () => {
    const b = fakeBackend({ enabled: false });
    const s = createSettingsStore(b, { channel: null });
    const l = vi.fn();
    s.subscribe(l);
    b.push({ enabled: true });
    expect(l).toHaveBeenCalledWith(true, 'external');
  });

  it('server unreachable: uses the cached value, or refuses if there is none', async () => {
    const b = fakeBackend({ enabled: true });
    (b.fetchFresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    expect(await createSettingsStore(b, { channel: null }).resolveEnabled()).toBe(true);

    const none = fakeBackend(undefined);
    (none.fetchFresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    await expect(createSettingsStore(none, { channel: null }).resolveEnabled()).rejects.toThrow();
  });
});

describe('sync with other tabs and browsers', () => {
  function fakeChannel() {
    const sent: unknown[] = [];
    const ch = {
      onmessage: null as ((e: MessageEvent) => void) | null,
      postMessage: (m: unknown) => sent.push(m),
      deliver: (data: unknown) => ch.onmessage?.({ data } as MessageEvent),
      sent,
    };
    return ch;
  }
  function fakeEnv() {
    const env = {
      visible: true,
      intervals: new Map<number, () => void>(),
      wakes: new Set<() => void>(),
      next: 0,
      isVisible: () => env.visible,
      onWake(cb: () => void) {
        env.wakes.add(cb);
        return () => env.wakes.delete(cb);
      },
      setInterval(cb: () => void) {
        env.intervals.set(++env.next, cb);
        return env.next;
      },
      clearInterval(h: unknown) {
        env.intervals.delete(h as number);
      },
      tick: () => env.intervals.forEach((cb) => cb()),
      wake: () => env.wakes.forEach((cb) => cb()),
    };
    return env;
  }

  it('own toggle is "self", is broadcast to other tabs', async () => {
    const ch = fakeChannel();
    const s = createSettingsStore(fakeBackend({ enabled: false }), { channel: ch });
    const l = vi.fn();
    s.subscribe(l);
    await s.setEnabled(true);
    expect(l).toHaveBeenCalledWith(true, 'self');
    expect(ch.sent).toEqual([{ enabled: true }]);
  });

  it('a message from another tab applies immediately as "external"', () => {
    const ch = fakeChannel();
    const s = createSettingsStore(fakeBackend({ enabled: false, other: 1 }), { channel: ch });
    const l = vi.fn();
    s.subscribe(l);
    ch.deliver({ enabled: true });
    expect(s.enabled).toBe(true);
    expect(l).toHaveBeenCalledWith(true, 'external');
    ch.deliver({ junk: 1 });
    expect(l).toHaveBeenCalledTimes(1);
  });

  it('polls the server while tracked and visible; another browser\'s change is "external"', async () => {
    const b = fakeBackend({ enabled: false });
    const env = fakeEnv();
    const s = createSettingsStore(b, { channel: null, env });
    const l = vi.fn();
    s.subscribe(l);
    const release = s.track();
    await b.write({ enabled: true }); // another browser
    env.tick();
    await vi.waitFor(() => expect(l).toHaveBeenCalledWith(true, 'external'));
    release();
    expect(env.intervals.size).toBe(0);
  });

  it('does not poll while hidden, refreshes when the window wakes up', async () => {
    const b = fakeBackend({ enabled: false });
    const env = fakeEnv();
    const s = createSettingsStore(b, { channel: null, env });
    s.track();
    env.visible = false;
    env.tick();
    expect(b.fetchFresh).not.toHaveBeenCalled();
    env.visible = true;
    env.wake();
    expect(b.fetchFresh).toHaveBeenCalledTimes(1);
  });

  it('one poller for many consumers, stopped when the last releases', () => {
    const env = fakeEnv();
    const s = createSettingsStore(fakeBackend({}), { channel: null, env });
    const a = s.track();
    const c = s.track();
    expect(env.intervals.size).toBe(1);
    a();
    a(); // double release is harmless
    expect(env.intervals.size).toBe(1);
    c();
    expect(env.intervals.size).toBe(0);
    expect(env.wakes.size).toBe(0);
  });
});
