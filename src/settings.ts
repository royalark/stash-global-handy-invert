/**
 * The invert flag lives in Stash's own plugin settings
 * (config.yml -> plugins.settings.StashGlobalInvert.enabled), so it is shared
 * by every browser and survives restarts. It is also editable in
 * Settings -> Plugins -> Stash Global Handy Invert.
 *
 * Changes made elsewhere are picked up:
 *  - other tabs of the same browser: immediately (BroadcastChannel)
 *  - other browsers / devices: by polling the server while a scene page is
 *    visible, and immediately when the window regains focus
 *  - Settings -> Plugins in this tab: through the Apollo cache
 */
import { t } from './i18n';

export const PLUGIN_ID = 'StashGlobalInvert';
export const CHANNEL_NAME = 'stash-global-invert';
export const POLL_INTERVAL_MS = 5000;

export type PluginConfig = Record<string, unknown>;

export interface ConfigBackend {
  /** plugin config from the Apollo cache; undefined if not cached yet */
  readCached(): PluginConfig | undefined;
  /** plugin config from the server */
  fetchFresh(): Promise<PluginConfig>;
  write(config: PluginConfig): Promise<void>;
  watch(onChange: (config: PluginConfig) => void): () => void;
}

/** `self`: changed by this tab's toggle; `external`: anywhere else */
export type ChangeOrigin = 'self' | 'external';
export type SettingsListener = (
  enabled: boolean | undefined,
  origin: ChangeOrigin,
) => void;

export type Channel = {
  postMessage(message: unknown): void;
  onmessage: ((e: MessageEvent) => void) | null;
};

export type PollEnv = {
  isVisible(): boolean;
  onWake(cb: () => void): () => void;
  setInterval(cb: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

export type SettingsOptions = {
  /** null disables cross-tab messages; undefined uses BroadcastChannel */
  channel?: Channel | null;
  /** environment for polling; defaults to window/document */
  env?: PollEnv;
};

function defaultChannel(): Channel | null {
  try {
    return typeof BroadcastChannel === 'undefined'
      ? null
      : new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

function defaultEnv(): PollEnv {
  return {
    isVisible: () =>
      typeof document === 'undefined' || document.visibilityState === 'visible',
    onWake(cb) {
      const onVisible = () => {
        if (document.visibilityState === 'visible') cb();
      };
      window.addEventListener('focus', cb);
      document.addEventListener('visibilitychange', onVisible);
      return () => {
        window.removeEventListener('focus', cb);
        document.removeEventListener('visibilitychange', onVisible);
      };
    },
    setInterval: (cb, ms) => setInterval(cb, ms),
    clearInterval: (h) => clearInterval(h as ReturnType<typeof setInterval>),
  };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore(
  backend: ConfigBackend,
  options: SettingsOptions = {},
) {
  let config: PluginConfig | undefined = backend.readCached();
  const listeners = new Set<SettingsListener>();
  const channel =
    options.channel === undefined ? defaultChannel() : options.channel;
  const enabledOf = (c: PluginConfig | undefined) =>
    c === undefined ? undefined : c.enabled === true;

  function apply(next: PluginConfig, origin: ChangeOrigin) {
    const before = enabledOf(config);
    config = { ...next };
    const after = enabledOf(config);
    if (before !== after) listeners.forEach((l) => l(after, origin));
  }
  backend.watch((c) => apply(c, 'external'));
  if (channel) {
    channel.onmessage = (e: MessageEvent) => {
      if (typeof e.data?.enabled === 'boolean')
        apply({ ...(config ?? {}), enabled: e.data.enabled }, 'external');
    };
  }

  async function refresh() {
    apply(await backend.fetchFresh(), 'external');
  }

  // polling is reference counted: it runs while at least one consumer
  // (a mounted toggle) needs it, and only while the page is visible
  let consumers = 0;
  let stopPolling: (() => void) | null = null;
  function startPolling() {
    const env = options.env ?? defaultEnv();
    const tick = () => {
      if (env.isVisible()) refresh().catch(() => undefined);
    };
    const handle = env.setInterval(tick, POLL_INTERVAL_MS);
    const offWake = env.onWake(tick);
    stopPolling = () => {
      env.clearInterval(handle);
      offWake();
      stopPolling = null;
    };
  }

  return {
    /** last known value; undefined until the configuration was loaded */
    get enabled() {
      return enabledOf(config);
    },
    subscribe(listener: SettingsListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** keep this store in sync with changes made elsewhere; returns release */
    track() {
      if (consumers++ === 0) startPolling();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (--consumers === 0) stopPolling?.();
      };
    },
    refresh,
    /**
     * Value to use for a device upload: re-read from the server so a change
     * made in another browser is honoured. Falls back to the cached value if
     * the server cannot be reached; throws if there is none (never guesses).
     */
    async resolveEnabled(): Promise<boolean> {
      try {
        await refresh();
      } catch {
        if (config === undefined) throw new Error(t('errSettings'));
      }
      return enabledOf(config) === true;
    },
    async setEnabled(enabled: boolean) {
      const next = { ...(config ?? (await backend.fetchFresh())), enabled };
      await backend.write(next);
      apply(next, 'self');
      channel?.postMessage({ enabled });
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function apolloBackend(pluginApi: any): ConfigBackend {
  const client = pluginApi.utils.StashService.getClient();
  const query = pluginApi.GQL.ConfigurationDocument;
  // small query: only this plugin's settings
  const pluginQuery = pluginApi.libraries.Apollo.gql`
    query StashGlobalInvertConfig($ids: [ID!]) {
      configuration {
        plugins(include: $ids)
      }
    }
  `;
  const pick = (data: any): PluginConfig =>
    (data?.configuration?.plugins?.[PLUGIN_ID] as PluginConfig) ?? {};
  return {
    readCached() {
      try {
        const data = client.readQuery({ query });
        return data ? pick(data) : undefined;
      } catch {
        return undefined;
      }
    },
    async fetchFresh() {
      // 'no-cache': the partial `configuration` result must not be written
      // to the Apollo cache, where it would replace Stash's full
      // configuration object (and make Stash refetch it).
      const result = await client.query({
        query: pluginQuery,
        variables: { ids: [PLUGIN_ID] },
        fetchPolicy: 'no-cache',
      });
      return pick(result.data);
    },
    async write(config) {
      await client.mutate({
        mutation: pluginApi.GQL.ConfigurePluginDocument,
        variables: { plugin_id: PLUGIN_ID, input: config },
      });
      // refresh the cache so Settings -> Plugins shows the new value too
      await client.query({ query, fetchPolicy: 'network-only' });
    },
    watch(onChange) {
      const sub = client
        .watchQuery({ query, fetchPolicy: 'cache-first' })
        .subscribe({
          next: (r: any) => r?.data && onChange(pick(r.data)),
          error: () => undefined,
        });
      return () => sub.unsubscribe();
    },
  };
}
