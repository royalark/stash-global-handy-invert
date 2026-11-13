// Network fakes for the E2E run. Nothing leaves the machine:
//  - every handyfeeling.com request is answered locally (Handy API v2 + CSV upload)
//  - StashInteractiveTools' Python `init` operation (lists alternative scripts)
//    is answered with the fixture list; its script files are served same-origin.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCRIPT_LABELS } from './fixtures.mjs';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
};
const json = (route, body, status = 200) =>
  route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** parse "at,pos" lines out of the multipart CSV upload */
function parseCsv(buf) {
  const rows = buf
    .toString('utf8')
    .split(/\r?\n/)
    .filter((l) => /^\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(l.trim()))
    .map((l) => l.trim().split(',').map(Number));
  return { ats: rows.map((r) => r[0]), positions: rows.map((r) => r[1]) };
}

export async function installHandyMock(context) {
  const log = { uploads: [], setups: [], plays: [], stops: 0, calls: [] };
  await context.route('https://www.handyfeeling.com/**', async (route) => {
    const req = route.request();
    const { pathname } = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    log.calls.push(`${req.method()} ${pathname}`);

    if (pathname === '/api/sync/upload') {
      const csv = parseCsv(req.postDataBuffer() ?? Buffer.alloc(0));
      log.uploads.push(csv);
      return json(route, { url: `https://csv.mock.test/${log.uploads.length}.csv` });
    }
    const cmd = pathname.replace('/api/handy/v2/', '');
    const body = req.postDataJSON?.() ?? null;
    switch (cmd) {
      case 'connected':
        return json(route, { connected: true });
      case 'info':
        return json(route, { fwVersion: '3.2.3', fwStatus: 0, hwVersion: 3, model: 'H01', branch: 'main', sessionId: 'e2e' });
      case 'servertime':
        // a non-zero offset: Stash skips connecting when the offset is exactly 0
        return json(route, { serverTime: Date.now() + 34 });
      case 'slide':
        return req.method() === 'GET' ? json(route, { min: 0, max: 100 }) : json(route, { result: 0 });
      case 'settings':
        return json(route, { offset: 0, velocity: 0, slideMin: 0, slideMax: 100 });
      case 'mode':
        return req.method() === 'GET' ? json(route, { mode: 1 }) : json(route, { result: 0 });
      case 'status':
        return json(route, { mode: 1, state: 3 });
      case 'hssp/setup':
        log.setups.push(body?.url);
        return json(route, { result: 1 });
      case 'hssp/play':
        log.plays.push(body);
        return json(route, { result: 0 });
      case 'hssp/stop':
        log.stops++;
        return json(route, { result: 0 });
      default:
        return json(route, { result: 0 });
    }
  });
  return log;
}

/**
 * Answers SIT's `RunPluginOperation(init)` (normally a Python task) with the
 * fixture scripts, served from /e2e-scripts/<file> on the Stash origin.
 */
export async function installSitInitMock(context, { origin, libraryDir, scenes }) {
  await context.route(`${origin}/e2e-scripts/**`, (route) => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.replace('/e2e-scripts/', ''));
    route.fulfill({ status: 200, contentType: 'text/plain', body: readFileSync(join(libraryDir, file)) });
  });
  await context.route(`${origin}/graphql`, async (route) => {
    const req = route.request();
    let payload;
    try {
      payload = req.postDataJSON();
    } catch {
      return route.continue();
    }
    if (payload?.operationName !== 'RunPluginOperation' || payload.variables?.plugin_id !== 'StashInteractiveTools')
      return route.continue();
    const base = scenes[payload.variables.args?.scene_id];
    const scripts = (SCRIPT_LABELS[base] ?? []).map(([label, file]) => ({
      label,
      path: `${origin}/e2e-scripts/${encodeURIComponent(file)}`,
    }));
    return json(route, { data: { runPluginOperation: { scripts } } });
  });
}
