/** Synthetic ZIPs exercise release checks without signing keys, browsers or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {crc32} from 'node:zlib';
import {validateVersion, validateVersions, verifyPackage} from '../scripts/verify-package.mjs';

const manifest = {manifest_version: 3, version: '0.3.6', background: {service_worker: 'background.js'},
  action: {default_popup: 'popup.html'}, content_scripts: [{js: ['feature-bootstrap.js']}], icons: {},
  web_accessible_resources: [{resources: ['popup.html']}]};
const base = () => Object.entries({
  'manifest.json': JSON.stringify(manifest), 'background.js': 'import "./helper.js";',
  'helper.js': 'export const value = 1;', 'popup.html': '<script src="pages/popup/popup.js"></script><link href="style.css" rel="stylesheet">',
  'pages/popup/popup.js': 'chrome.runtime.getURL("/");', 'style.css': 'body{color:black}',
  'feature-bootstrap.js': '', 'shared/feature-scripts.js': 'export const scripts=[{js:["helper.js"]}];',
  'THIRD_PARTY_NOTICES.md': 'License notices', 'vendor/ui/components.js.LEGAL.txt': 'License',
});
// Store-only fixtures with a valid central directory and CRC; no external ZIP creation tool.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const [name, content, mode = 0o100644] of entries) {
    const filename = Buffer.from(name), data = Buffer.from(content), crc = crc32(data);
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(filename.length, 26);
    const record = Buffer.alloc(46); record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x0314, 4); record.writeUInt16LE(20, 6); record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(data.length, 20); record.writeUInt32LE(data.length, 24); record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE((mode << 16) >>> 0, 38); record.writeUInt32LE(offset, 42);
    local.push(header, filename, data); central.push(record, filename); offset += header.length + filename.length + data.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
async function archive(t, entries) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'extension-package-test-'));
  t.after(() => rm(dir, {recursive: true, force: true}));
  const file = path.join(dir, 'extension.zip'); await writeFile(file, zip(entries)); return file;
}
test('release versions reject invalid Chrome components and mismatched sources/tags', () => {
  for (const value of ['0.3.6', '1.0.0', '65535.65535.65535.65535']) assert.equal(validateVersion(value), value);
  for (const value of ['0.0.0', '0.0.0.0', '01.2.3', '1.02.3', '65536.0.1', '1.0.0-beta', '1.2.3.4.5', 3])
    assert.throws(() => validateVersion(value));
  assert.throws(() => validateVersions('0.3.6', '0.3.5'), /versions must match/);
  assert.throws(() => validateVersions('0.3.6', '0.3.6', 'extension-v0.3.7'), /tag must match/);
  assert.doesNotThrow(() => validateVersions('0.3.6', '0.3.6', 'extension-v0.3.6'));
});
test('valid archive checks packaged references and preserved licenses without execution', async t => {
  const file = await archive(t, base());
  assert.deepEqual(verifyPackage(file, '0.3.6'), {version: '0.3.6', files: 10});
  assert.throws(() => verifyPackage(file, '0.3.7'), /version mismatch/);
});
test('missing module, HTML and licensed dynamic resources each fail validation', async t => {
  for (const name of ['helper.js', 'pages/popup/popup.js', 'THIRD_PARTY_NOTICES.md']) {
    const file = await archive(t, base().filter(([entry]) => entry !== name));
    assert.throws(() => verifyPackage(file, '0.3.6'), /Missing packaged resource/);
  }
  const file = await archive(t, base().map(([name, value]) => [name,
    name === 'shared/feature-scripts.js' ? 'export const scripts=[{js:["missing.js"]}];' : value]));
  assert.throws(() => verifyPackage(file, '0.3.6'), /Missing packaged resource/);
});
test('unsafe paths, duplicate members, signing credentials, source maps and symlinks fail closed', async t => {
  for (const extra of [['../outside.txt', 'bad'], ['pages/popup/popup.js', 'duplicate'], ['signing.pem', 'bad'],
    ['popup.js.map', '{}'], ['.env', 'bad'], ['linked.js', '/outside/key', 0o120777]]) {
    const file = await archive(t, [...base(), extra]);
    assert.throws(() => verifyPackage(file, '0.3.6'), /Unsafe|Duplicate|Secret|Hidden|Symlinks/);
  }
});
test('private key content cannot be hidden in a JS member', async t => {
  const file = await archive(t, [...base(), ['bad.js', 'const hidden="-----BEGIN PRIVATE KEY-----";']]);
  assert.throws(() => verifyPackage(file, '0.3.6'), /Private key material/);
});
