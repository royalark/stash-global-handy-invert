// End-to-end: real Stash v0.32.0 + real plugin builds in Chromium.
// The Handy API and CSV upload are faked (lib/mocks.mjs); assertions are made
// on the CSV the device would download and on the hssp/setup that loads it.
import { expect, test } from '@playwright/test';
import { SCRIPTS } from '../lib/fixtures.mjs';
import { installHandyMock, installSitInitMock } from '../lib/mocks.mjs';
import {
  configYml,
  HOME,
  ORIGIN,
  PLUGIN_BUILDS,
  scan,
  setInvert,
  setLanguage,
  setStashHostedFunscript,
  startStash,
  stopStash,
  usePlugins,
} from '../lib/stash.mjs';
import { join } from 'node:path';

test.describe.configure({ mode: 'serial' });

const raw = (file) => SCRIPTS[file].actions.map((a) => a.pos);
const ats = (file) => SCRIPTS[file].actions.map((a) => a.at);
const mirrored = (file) => raw(file).map((p) => 100 - p);

let scenes; // id -> basename
const sceneId = (base) => Object.keys(scenes).find((id) => scenes[id] === base);

const open = [];
test.afterEach(async () => {
  while (open.length) await open.pop().close();
});

/** a browser profile with the fakes installed and Stash's Handy time sync done */
async function world(browser) {
  const context = await browser.newContext();
  open.push(context);
  const log = await installHandyMock(context);
  await installSitInitMock(context, { origin: ORIGIN, libraryDir: join(HOME, 'library'), scenes });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Stash only connects to the Handy on the load *after* the first time sync
  await page.goto(ORIGIN + '/');
  await expect.poll(() => log.calls.filter((c) => c.endsWith('/servertime')).length).toBeGreaterThan(0);
  await page.waitForTimeout(1500);
  return { context, page, log, errors };
}

/** wait until a new hssp/setup happened and things settled; return the CSV that was loaded */
async function loadedScript(log, setupsBefore) {
  await expect.poll(() => log.setups.length, { timeout: 15000 }).toBeGreaterThan(setupsBefore);
  let n = -1;
  while (n !== log.setups.length) {
    n = log.setups.length;
    await new Promise((r) => setTimeout(r, 1200));
  }
  const url = log.setups.at(-1);
  const index = Number(url.match(/\/(\d+)\.csv$/)[1]) - 1;
  return log.uploads[index];
}

async function openScene(w, base) {
  const before = w.log.setups.length;
  await w.page.goto(`${ORIGIN}/scenes/${sceneId(base)}`);
  return loadedScript(w.log, before);
}

const toggle = (page) => page.locator('.sgi-toggle');
const interactiveTab = (page) => page.locator('a.nav-link', { hasText: /^Interactive$/ });
const SELECT = '#stash-interactive-tools-select-funscripts';
/** pick a script in SIT's Scripts dropdown (Interactive tab), like a user */
async function chooseScript(page, label) {
  if (!(await page.locator(SELECT).isVisible()))
    await interactiveTab(page).click();
  await page.selectOption(SELECT, { label });
}

test.beforeAll(async () => {
  await startStash({ fresh: true });
  scenes = await scan();
  await usePlugins({
    StashInteractiveTools: PLUGIN_BUILDS.sitFork,
    StashGlobalInvert: PLUGIN_BUILDS.invert,
  });
  await setInvert(false);
});
test.afterAll(stopStash);

test.describe('SIT fork (extension API) + Global Invert', () => {
  test('1. OFF: the selected script is sent unchanged', async ({ browser }) => {
    const w = await world(browser);
    const csv = await openScene(w, 'clip-a');
    expect(csv.positions).toEqual(raw('clip-a.funscript'));
    await expect(toggle(w.page)).toHaveText(/Handy Invert: OFF/);
    await expect(interactiveTab(w.page)).toBeVisible(); // SIT's tab survives our patch
    expect(w.errors).toEqual([]);
  });

  test('2. one click ON: re-prepares the device with the mirrored script, timestamps untouched', async ({ browser }) => {
    const w = await world(browser);
    await openScene(w, 'clip-a');
    const before = w.log.setups.length;
    await toggle(w.page).click();
    await expect(toggle(w.page)).toHaveText(/Handy Invert: ON/);
    const csv = await loadedScript(w.log, before);
    expect(csv.positions).toEqual(mirrored('clip-a.funscript'));
    expect(csv.ats).toEqual(ats('clip-a.funscript'));
    expect(configYml()).toMatch(/StashGlobalInvert:\s*\n\s*enabled: true/);
  });

  for (const [label, file] of [
    ['LOW', 'clip-a (LOW).funscript'],
    ['NORMAL', 'clip-a (NORMAL).funscript'],
    ['HIGHER', 'clip-a (HIGHER).funscript'],
    ['Default', 'clip-a.funscript'],
  ]) {
    test(`3. ON + Scripts=${label}: mirrored ${label} is sent`, async ({ browser }) => {
      const w = await world(browser);
      await openScene(w, 'clip-a');
      const before = w.log.setups.length;
      await chooseScript(w.page, label);
      const csv = await loadedScript(w.log, before);
      expect(csv.positions).toEqual(mirrored(file));
      expect(csv.ats).toEqual(ats(file));
    });
  }

  test('4. survives reload and a different browser profile (server-side setting)', async ({ browser }) => {
    const a = await world(browser);
    await openScene(a, 'clip-a');
    const before = a.log.setups.length;
    await a.page.reload();
    expect((await loadedScript(a.log, before)).positions).toEqual(mirrored('clip-a.funscript'));
    await expect(toggle(a.page)).toHaveText(/ON/);

    const b = await world(browser); // fresh profile: no local storage shared
    expect((await openScene(b, 'clip-a')).positions).toEqual(mirrored('clip-a.funscript'));
    await expect(toggle(b.page)).toHaveText(/ON/);
  });

  test('5. A -> list -> single-script B -> A: each scene gets its own mirrored script', async ({ browser }) => {
    const w = await world(browser);
    expect((await openScene(w, 'clip-a')).positions).toEqual(mirrored('clip-a.funscript'));
    await w.page.goto(`${ORIGIN}/scenes`);
    await w.page.waitForTimeout(800);
    expect((await openScene(w, 'clip-b')).positions).toEqual(mirrored('clip-b.funscript'));
    await expect(w.page.locator('#stash-interactive-tools-select-funscripts')).toHaveCount(0);
    expect((await openScene(w, 'clip-a')).positions).toEqual(mirrored('clip-a.funscript'));
  });

  test('6. rapid script switching: the last choice wins, no stale upload lands after it', async ({ browser }) => {
    const w = await world(browser);
    await openScene(w, 'clip-a');
    const before = w.log.setups.length;
    await chooseScript(w.page, 'LOW');
    await chooseScript(w.page, 'NORMAL');
    await chooseScript(w.page, 'HIGHER');
    const csv = await loadedScript(w.log, before);
    expect(csv.positions).toEqual(mirrored('clip-a (HIGHER).funscript'));
  });

  test('7. corrupt script while ON: nothing is sent, playback refused, user told', async ({ browser }) => {
    const w = await world(browser);
    const uploadsBefore = w.log.uploads.length;
    await w.page.goto(`${ORIGIN}/scenes/${sceneId('clip-c')}`);
    await expect(w.page.locator('.sgi-blocked')).toBeVisible({ timeout: 15000 });
    await expect(w.page.locator('.toast').first()).toContainText(/outside 0-100/);
    const playsBefore = w.log.plays.length;
    await w.page.evaluate(() => window.PluginApi.utils.InteractiveUtils.getPlayer()?.play());
    await w.page.waitForTimeout(2500);
    expect(w.log.plays.length).toBe(playsBefore);
    // nothing derived from the corrupt script reached the upload endpoint
    const corrupt = raw('clip-c.funscript');
    expect(w.log.uploads.slice(uploadsBefore).some((u) => u.positions.join() === corrupt.join())).toBe(false);
  });

  test('8. toggling during playback: device stopped first, video paused, re-prepared', async ({ browser }) => {
    const w = await world(browser);
    await openScene(w, 'clip-a');
    await w.page.evaluate(() => window.PluginApi.utils.InteractiveUtils.getPlayer().play());
    await expect.poll(() => w.log.plays.length, { timeout: 10000 }).toBeGreaterThan(0);
    const stopsBefore = w.log.stops;
    const before = w.log.setups.length;
    await toggle(w.page).click(); // ON -> OFF
    await expect(toggle(w.page)).toHaveText(/OFF/);
    const csv = await loadedScript(w.log, before);
    expect(w.log.stops).toBeGreaterThan(stopsBefore);
    expect(await w.page.evaluate(() => window.PluginApi.utils.InteractiveUtils.getPlayer().paused())).toBe(true);
    expect(csv.positions).toEqual(raw('clip-a.funscript'));
    await expect(w.page.locator('.toast').first()).toContainText(/press play to resume/);
  });

  test('9. persists across a Stash restart', async ({ browser }) => {
    await setInvert(true);
    await stopStash();
    await startStash();
    const w = await world(browser);
    expect((await openScene(w, 'clip-b')).positions).toEqual(mirrored('clip-b.funscript'));
  });
});

const isPlaying = (page) =>
  page.evaluate(() => !window.PluginApi.utils.InteractiveUtils.getPlayer().paused());
const play = (page) => page.evaluate(() => window.PluginApi.utils.InteractiveUtils.getPlayer().play());
const toastText = (page) => page.locator('.toast').allTextContents().then((t) => t.join(' | '));

test.describe('changes made elsewhere', () => {
  test.beforeEach(() => setInvert(false));

  test('16. another tab of the same browser: picked up at once and re-prepared while playing', async ({ browser }) => {
    const w = await world(browser);
    const tab2 = await w.context.newPage();
    const before = w.log.setups.length;
    await tab2.goto(`${ORIGIN}/scenes/${sceneId('clip-b')}`);
    await loadedScript(w.log, before);
    await openScene(w, 'clip-a'); // tab 1
    await play(tab2);
    await expect.poll(() => isPlaying(tab2)).toBe(true);

    const t0 = Date.now();
    await toggle(w.page).click(); // tab 1: OFF -> ON
    await expect(toggle(tab2)).toHaveText(/ON/, { timeout: 2000 }); // broadcast, not the 5 s poll
    expect(Date.now() - t0).toBeLessThan(2000);
    await expect.poll(() => isPlaying(tab2)).toBe(false);
    await expect.poll(() => toastText(tab2)).toMatch(/turned ON elsewhere and has been applied/);
    // tab 2 (the playing one) prepared its own scene again, inverted.
    // Both tabs share one device here, so which upload lands last is not asserted.
    const uploadsAfter = () => w.log.uploads.slice(before).map((u) => u.positions.join());
    await expect.poll(uploadsAfter).toContain(mirrored('clip-b.funscript').join());
  });

  test('17. another browser while playing: picked up within the poll interval and re-prepared', async ({ browser }) => {
    const a = await world(browser);
    const b = await world(browser);
    await openScene(a, 'clip-a');
    await openScene(b, 'clip-b');
    await play(b.page);
    await expect.poll(() => b.log.plays.length).toBeGreaterThan(0);
    const before = b.log.setups.length;
    const stops = b.log.stops;

    await toggle(a.page).click(); // browser A: OFF -> ON
    await expect(toggle(b.page)).toHaveText(/ON/, { timeout: 8000 });
    const csv = await loadedScript(b.log, before);
    expect(csv.positions).toEqual(mirrored('clip-b.funscript'));
    expect(b.log.stops).toBeGreaterThan(stops);
    expect(await isPlaying(b.page)).toBe(false);
    await expect.poll(() => toastText(b.page)).toMatch(/elsewhere and has been applied/);
    // polling must not disturb Stash's own cached configuration
    const cached = await b.page.evaluate(() =>
      window.PluginApi.utils.StashService.getClient().readQuery({
        query: window.PluginApi.GQL.ConfigurationDocument,
      })?.configuration?.interface?.language ?? null,
    );
    expect(cached).not.toBeNull();
  });

  test('18. another browser while paused: device untouched until play, then re-prepared first', async ({ browser }) => {
    const a = await world(browser);
    const b = await world(browser);
    await openScene(a, 'clip-a');
    expect((await openScene(b, 'clip-b')).positions).toEqual(raw('clip-b.funscript'));
    const before = b.log.setups.length;

    await toggle(a.page).click(); // browser A: OFF -> ON
    await expect(toggle(b.page)).toHaveText(/ON/, { timeout: 8000 });
    await expect(b.page.locator('.sgi-stale')).toBeVisible();
    await expect.poll(() => toastText(b.page)).toMatch(/applies when you press play/);
    await b.page.waitForTimeout(1500);
    expect(b.log.setups.length).toBe(before); // B did not touch the device

    const playsBefore = b.log.plays.length;
    await play(b.page); // first play: refused, script prepared again
    const csv = await loadedScript(b.log, before);
    expect(csv.positions).toEqual(mirrored('clip-b.funscript'));
    expect(b.log.plays.length).toBe(playsBefore);
    await expect.poll(() => toastText(b.page)).toMatch(/prepared again/);
    await expect(b.page.locator('.sgi-stale')).toHaveCount(0);

    await play(b.page); // second play: runs
    await expect.poll(() => b.log.plays.length).toBeGreaterThan(playsBefore);
  });
});

test.describe('Korean UI', () => {
  test('19. follows Stash\'s interface language', async ({ browser }) => {
    await setLanguage('ko-KR');
    try {
      await setInvert(false);
      const w = await world(browser);
      await openScene(w, 'clip-a');
      await expect(toggle(w.page)).toHaveText(/Handy 반전: OFF/);
      await expect(toggle(w.page)).toHaveAttribute('title', /전역 설정/);
      await setInvert(true);
      await w.page.goto(`${ORIGIN}/scenes/${sceneId('clip-c')}`);
      await expect(w.page.locator('.sgi-blocked')).toHaveText('⚠ 재생 차단됨', { timeout: 15000 });
      await expect.poll(() => toastText(w.page)).toMatch(/범위를 벗어났습니다/);
    } finally {
      await setLanguage('en-GB');
      await setInvert(false);
    }
  });
});

test.describe('unmodified SIT (no extension API) + Global Invert', () => {
  test.skip(!PLUGIN_BUILDS.sitLegacy, 'set E2E_SIT_LEGACY_DIST to an unmodified SIT build');
  test.beforeAll(async () => {
    await usePlugins({
      StashInteractiveTools: PLUGIN_BUILDS.sitLegacy,
      StashGlobalInvert: PLUGIN_BUILDS.invert,
    });
  });

  test('10. ON: no un-inverted script is ever loaded or played', async ({ browser }) => {
    await setInvert(true);
    const w = await world(browser);
    await w.page.goto(`${ORIGIN}/scenes/${sceneId('clip-a')}`);
    await expect(w.page.locator('.sgi-blocked')).toBeVisible({ timeout: 15000 });
    await expect(interactiveTab(w.page)).toBeVisible(); // coexists with unmodified SIT
    await w.page.evaluate(() => window.PluginApi.utils.InteractiveUtils.getPlayer()?.play());
    await w.page.waitForTimeout(2500);
    expect(w.log.setups).toEqual([]);
    expect(w.log.plays).toEqual([]);
  });

  test('11. OFF: SIT behaves as without this plugin', async ({ browser }) => {
    await setInvert(false);
    const w = await world(browser);
    expect((await openScene(w, 'clip-a')).positions).toEqual(raw('clip-a.funscript'));
  });

  test('12. (diagnostic) unmodified SIT on A -> list -> B', async ({ browser }) => {
    await setInvert(false);
    const w = await world(browser);
    await openScene(w, 'clip-a');
    await w.page.goto(`${ORIGIN}/scenes`);
    await w.page.waitForTimeout(800);
    const csv = await openScene(w, 'clip-b');
    const sentA = csv.positions.join() === raw('clip-a.funscript').join();
    test.info().annotations.push({
      type: 'unmodified-sit-stale-state',
      description: sentA ? 'scene B received scene A script' : 'scene B received its own script',
    });
    console.log(`[diagnostic] unmodified SIT, A->list->B: ${sentA ? 'B got A\'s script (stale state bug)' : 'B got its own script'}`);
  });
});

test.describe('Stash built-in client only (SIT disabled)', () => {
  test.beforeAll(async () => {
    await usePlugins({ StashGlobalInvert: PLUGIN_BUILDS.invert });
  });

  test('13. OFF raw / ON mirrored, inverted:true-free script', async ({ browser }) => {
    await setInvert(false);
    const w = await world(browser);
    expect((await openScene(w, 'clip-b')).positions).toEqual(raw('clip-b.funscript'));
    const before = w.log.setups.length;
    await toggle(w.page).click();
    await expect(toggle(w.page)).toHaveText(/ON/);
    expect((await loadedScript(w.log, before)).positions).toEqual(mirrored('clip-b.funscript'));
  });

  test('14. Stash-hosted funscript mode + ON: refused, not sent raw', async ({ browser }) => {
    await setInvert(true);
    await setStashHostedFunscript(true);
    try {
      const w = await world(browser);
      await w.page.goto(`${ORIGIN}/scenes/${sceneId('clip-b')}`);
      await expect(w.page.locator('.sgi-blocked')).toBeVisible({ timeout: 15000 });
      expect(w.log.setups).toEqual([]);
    } finally {
      await setStashHostedFunscript(false);
    }
  });
});

test.describe('rollback', () => {
  test('15. plugin removed: SIT fork alone sends the script unchanged, no toggle', async ({ browser }) => {
    await usePlugins({ StashInteractiveTools: PLUGIN_BUILDS.sitFork });
    const w = await world(browser);
    expect((await openScene(w, 'clip-a')).positions).toEqual(raw('clip-a.funscript'));
    await expect(toggle(w.page)).toHaveCount(0);
  });
});
