/* eslint-disable @typescript-eslint/no-explicit-any */
import { installClientProvider } from './client';
import { setLanguageSource } from './i18n';
import { apolloBackend, createSettingsStore } from './settings';
import { connectSit, createSitTransform } from './sit';
import { createStatusBus } from './status';
import { createInvertToggle } from './ui';

const pluginApi = (window as any).PluginApi;
const { React } = pluginApi;

// follow Stash's interface language (Settings -> Interface -> Language)
setLanguageSource(() => {
  try {
    return pluginApi.utils.StashService.getClient().readQuery({
      query: pluginApi.GQL.ConfigurationDocument,
    })?.configuration?.interface?.language;
  } catch {
    return undefined;
  }
});

// set by the scene page toggle while it is mounted
let playGuard: (() => boolean) | null = null;
const guard = {
  set(next: (() => boolean) | null) {
    playGuard = next;
  },
};

const settings = createSettingsStore(apolloBackend(pluginApi));
const status = createStatusBus();
const resolveEnabled = () => settings.resolveEnabled();

const sit = connectSit(
  window,
  createSitTransform({ resolveEnabled, status }),
  status,
);

// must run at load time: Stash creates the interactive client once, after
// every plugin script has loaded (PluginsLoader gates InteractiveProvider)
installClientProvider(pluginApi.utils.InteractiveUtils, {
  resolveEnabled,
  sitApi: sit.api,
  status,
  playGuard: () => playGuard?.() ?? false,
});

const GlobalInvertToggle = createInvertToggle({
  pluginApi,
  settings,
  status,
  sitApi: sit.api,
  guard,
});

/**
 * `after` patches are chained: Stash calls each with (...componentArgs, result),
 * where componentArgs are React's (props, legacyContext). Build on the
 * previous output (e.g. StashInteractiveTools' Interactive tab) rather than
 * `props.children`, so neither plugin's tab is dropped.
 */
export function previousOutput(args: any[]) {
  const result = args.length > 2 ? args[args.length - 1] : undefined;
  return React.isValidElement(result) || Array.isArray(result)
    ? result
    : args[0]?.children;
}

pluginApi.patch.after('ScenePage.Tabs', (...args: any[]) => {
  const props = args[0];
  const previous = previousOutput(args);
  const scene = props.scene;
  const interactive =
    scene?.interactive ||
    scene?.urls?.some((u: string) => u.includes('ivdb.io/#/videos/'));
  if (!interactive) return previous;
  return (
    <>
      {previous}
      <GlobalInvertToggle />
    </>
  );
});
