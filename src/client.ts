/**
 * Wraps Stash's interactive client through the official
 * `PluginApi.utils.InteractiveUtils.interactiveClientProvider` hook.
 *
 * Two upload paths reach the device:
 *  1. Stash's built-in client (no StashInteractiveTools): we invert here, by
 *     handing Stash an already-mirrored script.
 *  2. StashInteractiveTools replaces `uploadScript`/`play`/... on the client
 *     with `Object.defineProperty`. The Proxy's defineProperty trap sees those
 *     patches and wraps them:
 *       - SIT with the extension API: SIT runs our output transform itself;
 *         we pass through.
 *       - SIT without it: inversion is impossible (the script lives in SIT's
 *         private state), so while Invert is ON we refuse the upload and
 *         playback instead of silently sending an un-inverted script.
 */
import { invertForStash } from './invert';
import { SitExtensionApi } from './sit';
import { StatusBus } from './status';

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyFn = (...args: any[]) => any;

export const LEGACY_SIT_MESSAGE =
  'The installed StashInteractiveTools has no extension API, so the invert cannot be applied. Playback was blocked. Install a SIT build with the extension API or turn Invert off.';
export const HOSTED_FUNSCRIPT_MESSAGE =
  "Scripts cannot be inverted while Stash's 'Use Stash hosted funscript' option is on. Turn that option off or turn Invert off.";

export type ClientDeps = {
  resolveEnabled: () => Promise<boolean>;
  sitApi: () => SitExtensionApi | undefined;
  status: StatusBus;
  fetchJson?: (url: string) => Promise<unknown>;
  createObjectUrl?: (json: string) => string;
  revokeObjectUrl?: (url: string) => void;
};

const GATED = ['play', 'ensurePlaying'] as const;

const defaultFetchJson = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load the funscript (HTTP ${r.status})`);
  return r.json();
};

const errorMessage = (e: unknown) =>
  e instanceof Error ? e.message : String(e);

export function wrapClient<T extends object>(base: T, deps: ClientDeps): T {
  const fetchJson = deps.fetchJson ?? defaultFetchJson;
  const createObjectUrl =
    deps.createObjectUrl ??
    ((json: string) =>
      URL.createObjectURL(new Blob([json], { type: 'application/json' })));
  const revokeObjectUrl =
    deps.revokeObjectUrl ?? ((url: string) => URL.revokeObjectURL(url));

  const target = base as any;
  const proto = Object.getPrototypeOf(base);
  const originalUpload: AnyFn = target.uploadScript;
  const gate = { blocked: null as string | null, pending: 0 };
  let generation = 0;
  let queue: Promise<unknown> = Promise.resolve();
  let notifiedBlock: string | null = null;
  // eslint-disable-next-line prefer-const
  let proxy: T;

  async function stopDevice() {
    try {
      await (proxy as any).pause();
    } catch {
      /* ignore */
    }
    try {
      await target._handy?.setHsspStop?.();
    } catch {
      /* not in HSSP mode / no key: nothing is playing */
    }
  }

  async function block(message: string) {
    gate.blocked = message;
    await stopDevice();
    deps.status.set({ kind: 'blocked', message });
  }

  function gatePlayback(original: AnyFn, explicit: boolean): AnyFn {
    return async function gated(this: unknown, ...args: any[]) {
      if (gate.blocked !== null || gate.pending > 0) {
        if (gate.blocked !== null && (explicit || notifiedBlock !== gate.blocked)) {
          notifiedBlock = gate.blocked;
          deps.status.set({ kind: 'blocked', message: gate.blocked });
        }
        await stopDevice();
        return;
      }
      return original.apply(this, args);
    };
  }

  /** path 1: Stash's built-in client */
  async function builtinUpload(this: unknown, path: string, apiKey?: string) {
    const gen = ++generation;
    gate.pending++;
    const run = async () => {
      if (gen !== generation) return; // superseded by a newer upload
      const enabled = await deps.resolveEnabled();
      if (!enabled || !path || !target.handyKey) {
        await originalUpload.call(proxy, path, apiKey);
        gate.blocked = null;
        if (path && target.handyKey)
          deps.status.set({ kind: 'ready', via: 'stash', inverted: false });
        return;
      }
      if (target.useStashHostedFunscript) throw new Error(HOSTED_FUNSCRIPT_MESSAGE);
      deps.status.set({ kind: 'applying' });
      const inverted = invertForStash(await fetchJson(path));
      if (gen !== generation) return;
      const url = createObjectUrl(JSON.stringify(inverted));
      try {
        await originalUpload.call(proxy, url, apiKey);
      } finally {
        revokeObjectUrl(url);
      }
      gate.blocked = null;
      deps.status.set({ kind: 'ready', via: 'stash', inverted: true });
    };
    const result = queue
      .then(run, run)
      .catch(async (e) => {
        await block(errorMessage(e));
        throw e;
      })
      .finally(() => {
        gate.pending--;
      });
    queue = result.catch(() => undefined);
    return result;
  }

  /** path 2: wrap StashInteractiveTools' uploadScript */
  function wrapSitUpload(sitUpload: AnyFn): AnyFn {
    return async function uploadScript(this: unknown, ...args: any[]) {
      if (deps.sitApi()) {
        // SIT applies our transform and gates playback itself
        gate.blocked = null;
        return sitUpload.apply(this, args);
      }
      if (await deps.resolveEnabled()) {
        await block(LEGACY_SIT_MESSAGE);
        throw new Error(LEGACY_SIT_MESSAGE);
      }
      gate.blocked = null;
      return sitUpload.apply(this, args);
    };
  }

  const own = (name: string, value: AnyFn) =>
    Object.defineProperty(target, name, {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
  own('uploadScript', builtinUpload);
  for (const name of GATED) {
    const original: AnyFn = target[name] ?? proto?.[name];
    if (typeof original === 'function')
      own(name, gatePlayback(original, name === 'play'));
  }

  proxy = new Proxy(base, {
    defineProperty(t, prop, desc) {
      const fn = desc.value;
      if (typeof fn === 'function' && (prop === 'uploadScript' || prop === 'play' || prop === 'ensurePlaying')) {
        const wrapped: any =
          prop === 'uploadScript'
            ? wrapSitUpload(fn)
            : gatePlayback(fn, prop === 'play');
        if (fn._patched) wrapped._patched = true; // keep SIT's skip-check working
        return Reflect.defineProperty(t, prop, { ...desc, value: wrapped });
      }
      return Reflect.defineProperty(t, prop, desc);
    },
  });
  return proxy;
}

export function installClientProvider(
  interactiveUtils: { interactiveClientProvider?: AnyFn },
  deps: ClientDeps,
) {
  const previous = interactiveUtils.interactiveClientProvider;
  interactiveUtils.interactiveClientProvider = (options: any) => {
    const base = (previous ?? options.defaultClientProvider)(options);
    return wrapClient(base, deps);
  };
}
