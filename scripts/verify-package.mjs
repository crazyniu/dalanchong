/** Offline ZIP validation. Reads archive members without extracting or executing them. */
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
export function validateVersion(version) {
  // This project's tag convention uses three or four Chrome version components.
  assert.equal(typeof version, 'string', 'Version must be a string');
  assert.match(version, /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/, 'Invalid Chrome extension version');
  const parts = version.split('.').map(Number);
  assert.ok(parts.every(n => n <= 65535) && parts.some(n => n > 0), 'Chrome version components must be 0..65535 and not all zero');
  return version;
}
export function validateVersions(version, manifestVersion, tag) {
  validateVersion(version);
  assert.equal(manifestVersion, version, 'Source manifest and package versions must match');
  if (tag !== undefined) assert.equal(tag, `extension-v${version}`, 'Extension tag must match package.json version');
}
export function verifyPackage(archive, expectedVersion) {
  validateVersion(expectedVersion);
  archive = path.resolve(archive);
  const run = args => execFileSync('unzip', args, {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024});
  run(['-tqq', archive]); // Validate the compressed members and their CRCs first.
  const members = run(['-Z1', archive]).trimEnd().split('\n');
  const names = new Set();
  for (const name of members) {
    assert.ok(name && !/[\x00-\x1f\\*?\[\]]/.test(name) && !name.startsWith('/') &&
      !name.split('/').some(part => part === '..' || part === '.') && !name.includes('//') && !/^[a-z]:/i.test(name), `Unsafe archive member: ${name}`);
    assert.ok(!names.has(name), `Duplicate archive member: ${name}`);
    assert.ok(!name.split('/').some(part => part.startsWith('.')), `Hidden file in package: ${name}`);
    assert.ok(!/\.(?:map|pem|key|p12|pfx)$/i.test(name) && !/(?:^|\/)(?:id_rsa|id_ed25519|credentials|hosts\.yml)$/i.test(name), `Secret/source map in package: ${name}`);
    names.add(name);
  }
  assert.ok(!/^l[rwx-]{9}\s/m.test(run(['-Z', '-l', archive])), 'Symlinks are not allowed in the runtime archive');
  const files = new Set(members.filter(name => !name.endsWith('/')));
  const read = name => {
    assert.ok(files.has(name), `Missing packaged resource: ${name}`);
    return run(['-p', archive, name]);
  };
  function requireFile(reference, owner = 'manifest.json') {
    assert.equal(typeof reference, 'string');
    if (!reference || reference.startsWith('#') || /^(?:[a-z][\w+.-]*:|\/\/)/i.test(reference)) return;
    const clean = decodeURIComponent(reference.split(/[?#]/)[0]);
    const relative = clean.startsWith('/') ? clean.slice(1) : path.posix.join(path.posix.dirname(owner), clean);
    assert.ok(relative && !relative.startsWith('../') && files.has(relative), `Missing packaged resource: ${reference} (from ${owner})`);
  }
  const manifest = JSON.parse(read('manifest.json'));
  if (manifest.options_ui?.page) requireFile(manifest.options_ui.page);
  assert.equal(manifest.version, expectedVersion, 'Packaged manifest version mismatch');
  assert.equal(manifest.manifest_version, 3);
  for (const file of [manifest.background?.service_worker, manifest.action?.default_popup,
    ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})]) requireFile(file);
  for (const script of manifest.content_scripts || [])
    for (const file of [...(script.js || []), ...(script.css || [])]) requireFile(file);
  for (const resource of manifest.web_accessible_resources || []) for (const file of resource.resources) {
    if (file.includes('*')) {
      const pattern = new RegExp('^' + file.split('*').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
      assert.ok([...files].some(name => pattern.test(name)), `Unmatched web-accessible resource: ${file}`);
    } else requireFile(file);
  }
  read('THIRD_PARTY_NOTICES.md');
  read('vendor/ui/components.js.LEGAL.txt');
  for (const name of files) {
    if (!/\.(?:js|mjs|html|css)$/.test(name)) continue;
    const text = read(name);
    assert.ok(!/-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/.test(text), `Private key material in ${name}`);
    if (/\.(?:js|mjs)$/.test(name)) {
      // Relative static imports/re-exports and literal dynamic imports are preserved by esbuild.
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["'](\.[^"']+)["']/g)) requireFile(match[1], name);
      for (const match of text.matchAll(/\bgetURL\(\s*["']([^"']+)["']/g)) if (match[1] !== '/') requireFile(match[1]);
      if (name === 'shared/feature-scripts.js') for (const match of text.matchAll(/["']([^"']+\.(?:js|mjs|css))["']/g)) requireFile(match[1]);
    }
    if (name.endsWith('.html')) for (const match of text.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) requireFile(match[1], name);
    if (name.endsWith('.css')) for (const match of text.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) requireFile(match[1], name);
  }
  return {version: manifest.version, files: files.size};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const {version} = JSON.parse(await readFile(path.join(root, 'package.json')));
  const archive = process.argv[2] || path.join(root, 'dist-release/browser-extension', `dalanchong-extension-${version}.zip`);
  const result = verifyPackage(archive, version);
  console.log(`Verified packaged ZIP: ${result.files} files, version ${result.version}; no extraction or runtime execution.`);
}
