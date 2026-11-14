import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root = new URL('../', import.meta.url);
test('isolated frame uses Radix default document portals without shadow adapters', async () => {
  for (const name of ['dialog','sheet','select','alert-dialog']) {
    const source = await readFile(new URL(`src/components/ui/${name}.tsx`, root), 'utf8');
    const portals = [...source.matchAll(/<\w+Primitive\.Portal\b[^>]*>/g)];
    assert.ok(portals.length, name);
    for (const [portal] of portals) assert.doesNotMatch(portal, /container=/, name);
    assert.doesNotMatch(source, /portal-context|usePortalContainer/, name);
  }
  const entry = await readFile(new URL('src/invitation-ui/entry.tsx', root), 'utf8');
  assert.match(entry, /window\s*===\s*window\.top/);
  assert.doesNotMatch(entry, /attachShadow|PortalContainerProvider/);
  const host = await readFile(new URL('browser-extension/invitation/content/invitation-host.js', root), 'utf8');
  assert.match(host, /createElement\('iframe'\)/);
  assert.match(host, /invitation-workspace\.html\?embedded=1/);
});
test('platform artwork resolves from extension resources inside the frame', async () => {
  const source = await readFile(new URL('src/invitation-ui/shared.tsx', root), 'utf8');
  for (const name of ['douyin','kuaishou']) assert.ok(source.includes(`chrome.runtime.getURL('platforms/${name}.svg')`));
});
