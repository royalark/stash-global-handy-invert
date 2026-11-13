// Runs a real Stash binary against a throwaway home for the E2E suite.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeLibrary, writeConfig } from './fixtures.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
/** this repository's root */
export const ROOT = resolve(here, '..', '..');
export const HOME = resolve(here, '..', '.stash-home');
export const PORT = Number(process.env.E2E_PORT ?? 9997);
export const ORIGIN = `http://127.0.0.1:${PORT}`;

export const PLUGIN_BUILDS = {
  // SIT with the extension API (royalark/StashInteractiveTools, feat/extension-api)
  sitFork: process.env.E2E_SIT_DIST ?? join(ROOT, '..', 'StashInteractiveTools', 'dist'),
  sitLegacy: process.env.E2E_SIT_LEGACY_DIST, // unmodified SIT build, optional
  invert: join(ROOT, 'dist', 'StashGlobalInvert'),
};

export async function gql(query, variables = {}) {
  const r = await fetch(`${ORIGIN}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  const body = await r.json();
  if (body.errors) throw new Error(JSON.stringify(body.errors));
  return body.data;
}

let child;
export async function startStash({ fresh = false } = {}) {
  if (fresh) rmSync(HOME, { recursive: true, force: true });
  mkdirSync(HOME, { recursive: true });
  makeLibrary(HOME);
  const config = existsSync(join(HOME, 'config.yml')) ? join(HOME, 'config.yml') : writeConfig(HOME, { port: PORT });
  const bin = process.env.STASH_BIN;
  if (!bin) throw new Error('set STASH_BIN to the stash v0.32.0 binary');
  const log = openSync(join(HOME, 'stash.log'), 'a');
  child = spawn(bin, ['--config', config, '--nobrowser'], { cwd: HOME, stdio: ['ignore', log, log] });
  for (let i = 0; i < 120; i++) {
    try {
      const { systemStatus } = await gql('{ systemStatus { status } }');
      if (systemStatus.status === 'OK') return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('stash did not start');
}

export async function stopStash() {
  if (!child) return;
  const exited = new Promise((r) => child.once('exit', r));
  child.kill('SIGTERM');
  await exited;
  child = undefined;
}

export async function scan() {
  await gql('mutation { metadataScan(input: {}) }');
  for (let i = 0; i < 120; i++) {
    const { jobQueue } = await gql('{ jobQueue { id } }');
    if (!jobQueue?.length) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  const { findScenes } = await gql('{ findScenes { scenes { id interactive files { basename } } } }');
  return Object.fromEntries(findScenes.scenes.map((s) => [s.id, s.files[0].basename.replace(/\.\w+$/, '')]));
}

/** install exactly the given plugin builds, e.g. { StashInteractiveTools: PLUGIN_BUILDS.sitFork } */
export async function usePlugins(map) {
  const dir = join(HOME, 'plugins');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [id, src] of Object.entries(map)) cpSync(src, join(dir, id), { recursive: true });
  await gql('mutation { reloadPlugins }');
}

export async function setInvert(enabled) {
  await gql('mutation($i: Map!) { configurePlugin(plugin_id: "StashGlobalInvert", input: $i) }', {
    i: { enabled },
  });
}

export async function setStashHostedFunscript(value) {
  await gql('mutation($v: Boolean) { configureInterface(input: { useStashHostedFunscript: $v }) { handyKey } }', {
    v: value,
  });
}

export const configYml = () => readFileSync(join(HOME, 'config.yml'), 'utf8');

export async function setLanguage(language) {
  await gql('mutation($l: String) { configureInterface(input: { language: $l }) { language } }', { l: language });
}
