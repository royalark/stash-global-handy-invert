// Builds a throwaway Stash home + library for the E2E run.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const wave = (lo, hi, n = 20, step = 500) =>
  Array.from({ length: n }, (_, i) => ({ at: i * step, pos: i % 2 ? hi : lo }));

/** distinct patterns so a captured CSV identifies which script was sent */
export const SCRIPTS = {
  'clip-a.funscript': { actions: wave(0, 100) }, // Default
  'clip-a (LOW).funscript': { actions: wave(30, 45) },
  'clip-a (NORMAL).funscript': { actions: wave(10, 70) },
  'clip-a (HIGHER).funscript': { actions: wave(2, 98, 40, 250) },
  'clip-b.funscript': { actions: wave(5, 95) }, // single-script scene
  'clip-c.funscript': { actions: [{ at: 0, pos: 10 }, { at: 500, pos: 150 }] }, // corrupt
};

export const SCRIPT_LABELS = {
  'clip-a': [
    ['Default', 'clip-a.funscript'],
    ['HIGHER', 'clip-a (HIGHER).funscript'],
    ['LOW', 'clip-a (LOW).funscript'],
    ['NORMAL', 'clip-a (NORMAL).funscript'],
  ],
  'clip-b': [['Default', 'clip-b.funscript']],
  'clip-c': [['Default', 'clip-c.funscript']],
};

export function makeLibrary(root) {
  const lib = join(root, 'library');
  mkdirSync(lib, { recursive: true });
  for (const [i, name] of ['clip-a', 'clip-b', 'clip-c'].entries()) {
    const video = join(lib, `${name}.webm`);
    if (!existsSync(video))
      execFileSync('ffmpeg', [
        '-loglevel', 'error', '-y',
        '-f', 'lavfi', '-i', `testsrc=duration=12:size=320x240:rate=15`,
        '-f', 'lavfi', '-i', `sine=frequency=${440 + i * 100}:duration=12`,
        '-c:v', 'libvpx', '-b:v', '200k', '-c:a', 'libopus', '-shortest',
        video,
      ]);
  }
  for (const [file, json] of Object.entries(SCRIPTS))
    writeFileSync(join(lib, file), JSON.stringify(json));
  return lib;
}

export function writeConfig(root, { port }) {
  const p = (...s) => join(root, ...s);
  for (const d of ['generated', 'cache', 'blobs', 'plugins', 'scrapers', 'metadata'])
    mkdirSync(p(d), { recursive: true });
  const yml = `stash:
  - path: ${p('library')}
    excludevideo: false
    excludeimage: true
database: ${p('stash-go.sqlite')}
generated: ${p('generated')}
cache: ${p('cache')}
blobs_path: ${p('blobs')}
blobs_storage: FILESYSTEM
metadata: ${p('metadata')}
plugins_path: ${p('plugins')}
scrapers_path: ${p('scrapers')}
ffmpeg_path: ${execFileSync('which', ['ffmpeg']).toString().trim()}
ffprobe_path: ${execFileSync('which', ['ffprobe']).toString().trim()}
host: 127.0.0.1
port: ${port}
nobrowser: true
calculate_md5: false
video_file_naming_algorithm: OSHASH
parallel_tasks: 1
handy_key: E2E-FAKE-KEY
funscript_offset: 0
use_stash_hosted_funscript: false
ui:
  lastNoteSeen: 99999999
`;
  writeFileSync(p('config.yml'), yml);
  return p('config.yml');
}
