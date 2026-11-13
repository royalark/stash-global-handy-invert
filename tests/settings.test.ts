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
    const s = createSettingsStore(fakeBackend({}));
    expect(s.enabled).toBe(false);
    expect(await s.resolveEnabled()).toBe(false);
  });

  it('is unknown (not OFF) before the configuration was loaded', () => {
    expect(createSettingsStore(fakeBackend(undefined)).enabled).toBeUndefined();
  });

  it('persists to the server and keeps other plugin keys', async () => {
    const b = fakeBackend({ enabled: false, other: 'x' });
    const s = createSettingsStore(b);
    await s.setEnabled(true);
    expect(b.server()).toEqual({ enabled: true, other: 'x' });
    expect(s.enabled).toBe(true);
  });

  it('resolveEnabled follows a change made elsewhere (another browser)', async () => {
    const b = fakeBackend({ enabled: false });
    const s = createSettingsStore(b);
    await b.write({ enabled: true });
    expect(await s.resolveEnabled()).toBe(true);
  });

  it('notifies listeners on change from Settings -> Plugins (cache watch)', () => {
    const b = fakeBackend({ enabled: false });
    const s = createSettingsStore(b);
    const l = vi.fn();
    s.subscribe(l);
    b.push({ enabled: true });
    expect(l).toHaveBeenCalledWith(true);
  });

  it('server unreachable: uses the cached value, or refuses if there is none', async () => {
    const b = fakeBackend({ enabled: true });
    (b.fetchFresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    expect(await createSettingsStore(b).resolveEnabled()).toBe(true);

    const none = fakeBackend(undefined);
    (none.fetchFresh as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('down'));
    await expect(createSettingsStore(none).resolveEnabled()).rejects.toThrow();
  });
});
