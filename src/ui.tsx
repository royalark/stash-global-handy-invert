/* eslint-disable @typescript-eslint/no-explicit-any */
import { SettingsStore } from './settings';
import { SitExtensionApi } from './sit';
import { StatusBus, StatusSnapshot } from './status';

export type UiDeps = {
  pluginApi: any;
  settings: SettingsStore;
  status: StatusBus;
  sitApi: () => SitExtensionApi | undefined;
};

/**
 * Toggle sequence (P1 safety): stop the device and pause the video first,
 * persist the new value, then prepare the device again with a freshly built
 * script. The user restarts playback; the direction never flips mid-stroke.
 */
export async function applyToggle(
  deps: UiDeps,
  next: boolean,
  ctx: { interactive: any; currentScript?: string; apiKey?: string },
) {
  const player = deps.pluginApi.utils.InteractiveUtils.getPlayer?.();
  const wasPlaying = !!player && !player.paused();
  player?.pause();
  try {
    await ctx.interactive.pause();
  } catch {
    /* device may be disconnected */
  }
  await deps.settings.setEnabled(next);

  const sit = deps.sitApi();
  if (sit?.getState().activeSceneId) {
    await sit.reupload('global-invert-toggled');
  } else if (ctx.currentScript && ctx.interactive.handyKey) {
    await ctx.interactive.uploadScript(ctx.currentScript, ctx.apiKey);
  }
  return { wasPlaying };
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

    React.useEffect(() => deps.settings.subscribe(setEnabled), []);
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
        const { wasPlaying } = await applyToggle(deps, next, {
          interactive,
          currentScript,
        });
        Toast.success(
          `Handy Invert ${next ? 'ON' : 'OFF'} applied` +
            (wasPlaying ? ' - press play to resume' : ''),
        );
      } catch (e) {
        Toast.error(e instanceof Error ? e : new Error(String(e)));
      } finally {
        setBusy(false);
      }
    };

    const status = snap.status;
    const mismatch =
      status.kind === 'ready' && enabled !== undefined && status.inverted !== enabled;
    const title = [
      'Global setting: inverts the Handy (L0) stroke direction for every scene.',
      'Stored in the Stash server settings (config.yml), not just this browser.',
      status.kind === 'ready'
        ? `Script prepared on the device: ${status.inverted ? 'inverted' : 'original'}`
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
          Handy Invert: {enabled === undefined ? '…' : enabled ? 'ON' : 'OFF'}
          {busy || status.kind === 'applying' ? ' ⏳' : ''}
        </Button>
        {status.kind === 'blocked' && (
          <span className="sgi-note sgi-blocked" role="alert">
            ⚠ Playback blocked
          </span>
        )}
        {mismatch && !busy && (
          <span className="sgi-note sgi-warning">Applies from the next upload</span>
        )}
        {snap.warning && (
          <span className="sgi-note sgi-warning" title={snap.warning}>
            ⚠ Double invert
          </span>
        )}
      </Nav.Item>
    );
  };
}
