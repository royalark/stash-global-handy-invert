/* eslint-disable @typescript-eslint/no-explicit-any */
import { stateLabel, t } from './i18n';
import { SettingsStore } from './settings';
import { SitExtensionApi } from './sit';
import { StatusBus, StatusSnapshot } from './status';

/** holder for the play guard the client wrapper consults before playing */
export type GuardSlot = { set(guard: (() => boolean) | null): void };

export type UiDeps = {
  pluginApi: any;
  settings: SettingsStore;
  status: StatusBus;
  sitApi: () => SitExtensionApi | undefined;
  guard: GuardSlot;
};

type DeviceCtx = { interactive: any; currentScript?: string; apiKey?: string };

/** pause the video and stop the device; returns whether the video was playing */
export async function stopPlayback(deps: UiDeps, ctx: DeviceCtx) {
  const player = deps.pluginApi.utils.InteractiveUtils.getPlayer?.();
  const wasPlaying = !!player && !player.paused();
  player?.pause();
  try {
    await ctx.interactive.pause();
  } catch {
    /* device may be disconnected */
  }
  return wasPlaying;
}

/** upload the current scene's script again, built with the current setting */
export async function prepareAgain(deps: UiDeps, ctx: DeviceCtx) {
  const sit = deps.sitApi();
  if (sit?.getState().activeSceneId) {
    await sit.reupload('global-invert');
  } else if (ctx.currentScript && ctx.interactive.handyKey) {
    await ctx.interactive.uploadScript(ctx.currentScript, ctx.apiKey);
  }
}

/**
 * Toggle sequence (P1 safety): stop the device and pause the video first,
 * persist the new value, then prepare the device again with a freshly built
 * script. The user restarts playback; the direction never flips mid-stroke.
 */
export async function applyToggle(deps: UiDeps, next: boolean, ctx: DeviceCtx) {
  const wasPlaying = await stopPlayback(deps, ctx);
  await deps.settings.setEnabled(next);
  await prepareAgain(deps, ctx);
  return { wasPlaying };
}

/** the script on the device was prepared with a different setting */
export function isStale(deps: Pick<UiDeps, 'settings' | 'status'>) {
  const status = deps.status.get().status;
  const enabled = deps.settings.enabled;
  return status.kind === 'ready' && enabled !== undefined && status.inverted !== enabled;
}

export function createInvertToggle(deps: UiDeps) {
  const { React } = deps.pluginApi;
  const { Button, Nav } = deps.pluginApi.libraries.Bootstrap;

  return function GlobalInvertToggle() {
    const Toast = deps.pluginApi.hooks.useToast();
    const { interactive, currentScript } = deps.pluginApi.hooks.useInteractive();
    const [enabled, setEnabled] = React.useState(deps.settings.enabled);
    const [snap, setSnap] = React.useState(deps.status.get() as StatusSnapshot);
    const [busy, setBusy] = React.useState(false);
    const lastToasted = React.useRef(null as string | null);
    const device = React.useRef({ interactive, currentScript } as DeviceCtx);
    device.current = { interactive, currentScript };
    const repreparing = React.useRef(false);

    /** stop, pause and prepare again because the setting changed elsewhere */
    const reprepare = React.useCallback(
      async (message: (state: string) => string) => {
        if (repreparing.current) return;
        repreparing.current = true;
        setBusy(true);
        try {
          await stopPlayback(deps, device.current);
          await prepareAgain(deps, device.current);
          Toast.success(message(stateLabel(deps.settings.enabled === true)));
        } catch (e) {
          Toast.error(e instanceof Error ? e : new Error(String(e)));
        } finally {
          repreparing.current = false;
          setBusy(false);
        }
      },
      [Toast],
    );

    // follow changes made in other tabs and browsers
    React.useEffect(() => deps.settings.track(), []);
    React.useEffect(
      () =>
        deps.settings.subscribe((value, origin) => {
          setEnabled(value);
          if (origin !== 'external' || value === undefined || !isStale(deps)) return;
          const player = deps.pluginApi.utils.InteractiveUtils.getPlayer?.();
          if (player && !player.paused()) {
            reprepare((state: string) => t('toastExternalApplied', { state }));
          } else {
            // the device is left alone (another tab may be playing);
            // the play guard prepares it again on the next play
            Toast.success(t('toastExternalPending', { state: stateLabel(value) }));
          }
        }),
      [Toast, reprepare],
    );

    // before the device starts: if the script on it is stale, prepare it again
    React.useEffect(() => {
      deps.guard.set(() => {
        if (repreparing.current) return true;
        if (!isStale(deps)) return false;
        reprepare((state: string) => t('toastReprepared', { state }));
        return true;
      });
      return () => deps.guard.set(null);
    }, [reprepare]);

    React.useEffect(
      () =>
        deps.status.subscribe((s: StatusSnapshot) => {
          setSnap(s);
          if (s.status.kind === 'blocked' && lastToasted.current !== s.status.message) {
            lastToasted.current = s.status.message;
            Toast.error(new Error(s.status.message));
          } else if (s.status.kind !== 'blocked') {
            lastToasted.current = null;
          }
        }),
      [Toast],
    );

    const onClick = async () => {
      if (busy || enabled === undefined) return;
      const next = !enabled;
      setBusy(true);
      try {
        const { wasPlaying } = await applyToggle(deps, next, device.current);
        Toast.success(
          t('toastApplied', { state: stateLabel(next) }) +
            (wasPlaying ? t('toastResume') : ''),
        );
      } catch (e) {
        Toast.error(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setBusy(false);
      }
    };

    const status = snap.status;
    const stale =
      status.kind === 'ready' && enabled !== undefined && status.inverted !== enabled;
    const title = [
      t('tooltipGlobal'),
      t('tooltipStored'),
      status.kind === 'ready'
        ? t('tooltipPrepared', {
            state: t(status.inverted ? 'preparedInverted' : 'preparedOriginal'),
          })
        : '',
    ]
      .filter(Boolean)
      .join('\n');

    return (
      <Nav.Item className="stash-global-invert ml-auto">
        <Button
          size="sm"
          variant={enabled ? 'primary' : 'secondary'}
          className={`sgi-toggle ${enabled ? 'sgi-on' : 'sgi-off'}`}
          aria-pressed={!!enabled}
          disabled={busy || enabled === undefined}
          title={title}
          onClick={onClick}
          data-sgi-state={status.kind}
        >
          {t('toggleLabel')}:{' '}
          {enabled === undefined ? t('unknown') : stateLabel(enabled)}
          {busy || status.kind === 'applying' ? ' ⏳' : ''}
        </Button>
        {status.kind === 'blocked' && (
          <span className="sgi-note sgi-blocked" role="alert">
            {t('badgeBlocked')}
          </span>
        )}
        {stale && !busy && (
          <span className="sgi-note sgi-warning sgi-stale">{t('badgeNextUpload')}</span>
        )}
        {snap.warning && (
          <span className="sgi-note sgi-warning" title={snap.warning}>
            {t('badgeDoubleInvert')}
          </span>
        )}
      </Nav.Item>
    );
  };
}
