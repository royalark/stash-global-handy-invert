/**
 * Integration with StashInteractiveTools' extension API (apiVersion >= 1,
 * see StashInteractiveTools/docs/extensions.md). Only the shape used here is
 * declared; SIT is never imported.
 */
import { invertForSit, looksLikeCustomInvert } from './invert';
import { StatusBus } from './status';

export const SIT_GLOBAL = 'StashInteractiveTools';
export const SIT_READY_EVENT = 'stash-interactive-tools:ready';
export const TRANSFORM_ID = 'stash-global-invert';

export type SitSource =
  | { kind: 'actions'; script: unknown }
  | { kind: 'opaque'; reason: 'handy-token' | 'ivdb' | string };
export type SitTransformContext = {
  sceneId: string;
  deviceId: string;
  generation: number;
  modifiers: { id: string; values: Record<string, unknown> }[];
};
export type SitEvent =
  | { type: 'upload-start' | 'upload-superseded'; sceneId: string }
  | { type: 'upload-success'; sceneId: string; appliedTransforms: string[] }
  | {
      type: 'upload-failed' | 'play-blocked';
      sceneId: string;
      message: string;
      transformId?: string;
    };
export interface SitExtensionApi {
  apiVersion: number;
  registerOutputTransform(t: {
    id: string;
    transform(source: SitSource, ctx: SitTransformContext): unknown;
  }): () => void;
  reupload(reason?: string): Promise<void>;
  subscribe(listener: (e: SitEvent) => void): () => void;
  getState(): { activeSceneId: string | null };
}

const OPAQUE_MESSAGES: Record<string, string> = {
  'handy-token':
    'Handy token scripts cannot be inverted because their content is not visible. Playback was blocked (turn Invert off to play it).',
  ivdb: 'ivdb scripts cannot be inverted because their content is not visible. Playback was blocked (turn Invert off to play it).',
};

export const CUSTOM_INVERT_WARNING =
  'A SIT Custom modifier already inverts (100 - pos). Combined with Global Invert the direction flips back. Remove that preset.';

export function createSitTransform(deps: {
  resolveEnabled: () => Promise<boolean>;
  status: StatusBus;
}) {
  return {
    id: TRANSFORM_ID,
    async transform(source: SitSource, ctx: SitTransformContext) {
      const enabled = await deps.resolveEnabled();
      if (!enabled) {
        deps.status.warn(undefined);
        return undefined;
      }
      if (source.kind === 'opaque')
        throw new Error(
          OPAQUE_MESSAGES[source.reason] ??
            'This script cannot be inverted. Playback was blocked.',
        );
      const doubled = ctx.modifiers.some(
        (m) => m.id === 'custom' && looksLikeCustomInvert(m.values?.functionText),
      );
      deps.status.warn(doubled ? CUSTOM_INVERT_WARNING : undefined);
      return invertForSit(source.script);
    },
  };
}

/**
 * Attach to SIT whenever it becomes available (either load order works:
 * Stash loads every plugin script before the app renders).
 */
export function connectSit(
  win: Window,
  transform: ReturnType<typeof createSitTransform>,
  status: StatusBus,
) {
  let api: SitExtensionApi | undefined;
  const attach = (candidate: unknown) => {
    const a = candidate as SitExtensionApi | undefined;
    if (api || !a || typeof a.registerOutputTransform !== 'function') return;
    if (!(a.apiVersion >= 1)) return;
    a.registerOutputTransform(transform);
    a.subscribe((e) => {
      switch (e.type) {
        case 'upload-start':
          status.set({ kind: 'applying' });
          break;
        case 'upload-success':
          status.set({
            kind: 'ready',
            via: 'sit',
            inverted: e.appliedTransforms.includes(TRANSFORM_ID),
          });
          break;
        case 'upload-failed':
        case 'play-blocked':
          status.set({ kind: 'blocked', message: e.message });
          break;
      }
    });
    api = a;
  };
  attach((win as unknown as Record<string, unknown>)[SIT_GLOBAL]);
  win.addEventListener(SIT_READY_EVENT, (e) =>
    attach((e as CustomEvent).detail),
  );
  return { api: () => api };
}
