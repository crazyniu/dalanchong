/** Validate source syntax, declared runtime files and stable release metadata offline. */
import {readFile, readdir, stat} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import path from 'node:path';
import assert from 'node:assert/strict';
import {featureScripts} from '../browser-extension/feature-scripts.js';
const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, 'browser-extension');
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json')));
const pkg = JSON.parse(await readFile(path.join(root, 'package.json')));
assert.equal(manifest.version, pkg.version, 'Source manifest and package versions must match');
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.minimum_chrome_version, '116');
assert.ok(manifest.permissions.includes('alarms'));
async function requireFile(relative) {
  assert.equal(typeof relative, 'string');
  assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
  assert.ok((await stat(path.join(extension, relative))).isFile(), `Missing runtime resource: ${relative}`);
}
for (const script of manifest.content_scripts || []) {
  assert.deepEqual(script.js, ['feature-bootstrap.js'], 'Only inert bootstrap may load before authorization');
  for (const file of [...script.js, ...(script.css || [])]) await requireFile(file);
}
for (const script of featureScripts) for (const file of [...script.js, ...(script.css || [])]) await requireFile(file);
for (const file of [manifest.background.service_worker, manifest.action.default_popup, ...Object.values(manifest.icons || {}), ...Object.values(manifest.action.default_icon || {})]) await requireFile(file);
if (manifest.options_ui?.page) await requireFile(manifest.options_ui.page);
let files = 0;
async function visit(dir) {
  for (const item of await readdir(dir, {withFileTypes: true})) {
    const file = path.join(dir, item.name);
    assert.ok(!item.isSymbolicLink(), `Source symlinks are not allowed: ${file}`);
    if (item.isDirectory()) { await visit(file); continue; }
    if (/\.(?:js|mjs)$/.test(item.name)) {
      execFileSync(process.execPath, ['--check', file], {stdio: 'pipe'}); files++;
      if (file.includes('/vendor/')) continue;
      for (const match of (await readFile(file, 'utf8')).matchAll(/(?:from\s*|import\s*)["'](\.[^"']+)["']/g))
        assert.ok((await stat(path.resolve(path.dirname(file), match[1]))).isFile(), `Missing import ${match[1]}`);
    }
    if (/\.html$/.test(item.name)) {
      for (const match of (await readFile(file, 'utf8')).matchAll(/(?:src|href)="([^"#:]+\.(?:js|mjs|css))"/g))
        await requireFile(match[1]);
    }
  }
}
await visit(extension);
console.log(`Validated ${files} scripts, runtime resources, activation bootstrap and version metadata.`);
