import { build } from 'esbuild';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

const out = 'dist/StashGlobalInvert';
rmSync('dist', { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: ['src/index.tsx'],
  bundle: true,
  format: 'iife',
  target: 'es2019',
  jsx: 'transform',
  jsxFactory: 'React.createElement',
  jsxFragment: 'React.Fragment',
  minify: false,
  legalComments: 'none',
  outfile: `${out}/stash-global-invert.js`,
  banner: { js: `/* Stash Global Handy Invert v${version} */` },
});
copyFileSync('src/style.css', `${out}/stash-global-invert.css`);
copyFileSync('plugin/StashGlobalInvert.yml', `${out}/StashGlobalInvert.yml`);
console.log(`built ${out}`);
