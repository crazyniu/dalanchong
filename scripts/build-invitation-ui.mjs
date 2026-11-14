/** Compile the self-contained invitation UI. CSS remains inside the IIFE for its extension frame. */
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { readFile, mkdir, copyFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['src/invitation-ui/entry.tsx'],
  outfile: 'browser-extension/invitation/ui/invitation-ui.js',
  bundle: true,
  metafile: true,
  format: 'iife',
  platform: 'browser',
  target: ['chrome116'],
  jsx: 'automatic',
  minify: true,
  sourcemap: false,
  legalComments: 'eof',
  define: { 'process.env.NODE_ENV': '"production"' },
  alias: { '@': path.join(root, 'src'), cn: path.join(root, 'src/lib/utils.ts') },
  plugins: [{
    name: 'shadow-inline-tailwind',
    setup(build) {
      build.onResolve({ filter: /\.css\?inline$/ }, args => ({
        path: path.resolve(args.resolveDir, args.path.slice(0, -'?inline'.length)),
        namespace: 'shadow-inline-css',
      }));
      build.onLoad({ filter: /.*/, namespace: 'shadow-inline-css' }, async args => {
        const source = await readFile(args.path, 'utf8');
        const result = await postcss([tailwindcss({ base: path.join(root, 'src'), optimize: true })])
          .process(source, { from: args.path, map: false });
        // No style injection into the platform document: entry owns its extension document.
        return { contents: result.root.toString(), loader: 'text', watchFiles: [args.path] };
      });
    },
  }],
});
await mkdir(path.join(root, '.work'), { recursive: true });
await writeFile(path.join(root, '.work/invitation-ui-metafile.json'), JSON.stringify(result.metafile));
console.log('Built browser-extension/invitation/ui/invitation-ui.js (React + inline Tailwind CSS)');

await mkdir(path.join(root, 'browser-extension/platforms'), { recursive: true });
for (const file of ['douyin.svg', 'kuaishou.svg']) {
  await copyFile(path.join(root, 'public/platforms', file), path.join(root, 'browser-extension/platforms', file));
}
// Trace actual bundled packages instead of shipping unrelated build-tool licenses.
const packages = new Map();
const bundledInputs = new Set(Object.values(result.metafile.outputs).flatMap(output =>
  Object.entries(output.inputs).filter(([, detail]) => detail.bytesInOutput > 0).map(([input]) => input)));
for (const input of bundledInputs) {
  if (!input.includes('node_modules/')) continue;
  let dir = path.dirname(path.resolve(root, input));
  while (dir.startsWith(root) && dir !== root) {
    try {
      const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
      if (pkg.name) { packages.set(`${pkg.name}@${pkg.version}`, dir); break; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    dir = path.dirname(dir);
  }
}
// Tailwind's generated CSS is included through the inline-CSS plugin.
for (const name of ['tailwindcss', 'tw-animate-css']) {
  const dir = path.join(root, 'node_modules', name);
  const pkg = JSON.parse(await readFile(path.join(dir, 'package.json'), 'utf8'));
  packages.set(`${pkg.name}@${pkg.version}`, dir);
}
const notices = [];
for (const [name, dir] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
  const files = (await readdir(dir)).filter(file => /^(license|licence|copying|notice)(\.|$)/i.test(file));
  // This published tarball omitted LICENSE; retain its official upstream license text.
  if (!files.length && name === 'react-remove-scroll-bar@2.3.8') {
    notices.push(`===== ${name} =====\n` + await readFile(path.join(root, 'src/legal/react-remove-scroll-bar-LICENSE.txt'), 'utf8'));
    continue;
  }
  if (!files.length) throw new Error(`Bundled dependency has no license text: ${name}`);
  notices.push(`===== ${name} =====\n` + (await Promise.all(files.sort().map(file => readFile(path.join(dir, file), 'utf8')))).join('\n'));
}
await mkdir(path.join(root, 'browser-extension/licenses'), { recursive: true });
await writeFile(path.join(root, 'browser-extension/licenses/invitation-ui-LICENSES.txt'), notices.join('\n\n') + '\n');
console.log(`Retained license texts for ${packages.size} UI dependencies`);
