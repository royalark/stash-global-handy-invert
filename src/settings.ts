/**
 * The invert flag lives in Stash's own plugin settings
 * (config.yml -> plugins.StashGlobalInvert.enabled), so it is shared by every
 * browser and survives restarts. It is also editable in
 * Settings -> Plugins -> Stash Global Handy Invert.
 */
export const PLUGIN_ID = 'StashGlobalInvert';

export type PluginConfig = Record<string, unknown>;

export interface ConfigBackend {
  /** plugin config from the Apollo cache; undefined if not cached yet */
  readCached(): PluginConfig | undefined;
  fetchFresh(): Promise<PluginConfig>;
  write(config: PluginConfig): Promise<void>;
  watch(onChange: (config: PluginConfig) => void): () => void;
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;

export function createSettingsStore(backend: ConfigBackend) {
  let config: PluginConfig | undefined = backend.readCached();
  const listeners = new Set<(enabled: boolean | undefined) => void>();
  const enabledOf = (c: PluginConfig | undefined) =>
    c === undefined ? undefined : c.enabled === true;

  function apply(next: PluginConfig) {
    const before = enabledOf(config);
    config = { ...next };
    const after = enabledOf(config);
    if (before !== after) listeners.forEach((l) => l(after));
  }
  backend.watch(apply);

  return {
    /** last known value; undefined until the configuration was loaded */
    get enabled() {
      return enabledOf(config);
    },
    subscribe(listener: (enabled: boolean | undefined) => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /**
     * Value to use for a device upload: re-read from the server so a change
     * made in another browser is honoured. Falls back to the cached value if
     * the server cannot be reached; throws if there is none (never guesses).
     */
    async resolveEnabled(): Promise<boolean> {
      try {
        apply(await backend.fetchFresh());
      } catch (e) {
        if (config === undefined)
          throw new Error('Could not read the Global Invert setting from the Stash server');
      }
      return enabledOf(config) === true;
    },
    async setEnabled(enabled: boolean) {
      const next = { ...(config ?? (await backend.fetchFresh())), enabled };
      await backend.write(next);
      apply(next);
    },
  };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function apolloBackend(pluginApi: any): ConfigBackend {
  const client = pluginApi.utils.StashService.getClient();
  const query = pluginApi.GQL.ConfigurationDocument;
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
      const result = await client.query({ query, fetchPolicy: 'network-only' });
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
