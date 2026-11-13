// Writes index.yml (a Stash plugin source) for package zips attached to a
// GitHub release. Usage:
//   node scripts/make-index.mjs <tag> <id>=<zip>[:<name>|<version>|<description>] ...
// Each zip must contain the plugin files at its root (Stash extracts it into
// plugins/<source local path>/<id>/).
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';

const REPO = 'royalark/stash-global-handy-invert';
const [tag, ...entries] = process.argv.slice(2);
const date = new Date().toISOString().replace('T', ' ').slice(0, 19); // UTC
const q = (s) => JSON.stringify(s);

const out = entries.map((entry) => {
  const [id, rest] = entry.split('=');
  const [zip, meta] = rest.split(':');
  const [name, version, description] = meta.split('|');
  const sha256 = createHash('sha256').update(readFileSync(zip)).digest('hex');
  return [
    `- id: ${id}`,
    `  name: ${q(name)}`,
    `  metadata:`,
    `    description: ${q(description)}`,
    `  version: ${q(version)}`,
    `  date: ${q(date)}`,
    `  path: https://github.com/${REPO}/releases/download/${tag}/${basename(zip)}`,
    `  sha256: ${sha256}`,
  ].join('\n');
});
writeFileSync('index.yml', out.join('\n') + '\n');
console.log(`index.yml: ${entries.length} package(s), date ${date}`);
