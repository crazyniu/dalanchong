import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const base = new URL('../browser-extension/', import.meta.url);
test('invitation workspace delegates activation solely to the shared license gate', async () => {
  const html = await readFile(new URL('invite.html', base), 'utf8');
  const js = await readFile(new URL('invite.js', base), 'utf8');
  assert.match(html, /<body data-license-locked>/);
  assert.equal([...html.matchAll(/id="license-gate"/g)].length, 1);
  assert.match(js, /await requirePageLicense\(\);/);
  for (const id of ['license-form', 'activation-code', 'activate', 'verify-license', 'refresh-status', 'license-status']) {
    assert.ok(!html.includes(`id="${id}"`), `duplicate activation UI: ${id}`);
    assert.ok(!js.includes(`$('${id}')`), `orphan controller binding: ${id}`);
  }
  assert.doesNotMatch(js, /INVITE_ACTIVATE|INVITE_VERIFY/);
  assert.match(js, /request\('INVITE_STATUS'\)/);
  assert.match(js, /!license\.valid/);
});
test('invitation literal controller IDs still exist after activation UI removal', async () => {
  const html = await readFile(new URL('invite.html', base), 'utf8');
  const js = await readFile(new URL('invite.js', base), 'utf8');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const [, id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.includes(id), `missing ${id}`);
});
