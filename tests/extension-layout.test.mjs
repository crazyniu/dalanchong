import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
const extension = new URL('../browser-extension/', import.meta.url);
const manifest = JSON.parse(await readFile(new URL('manifest.json', extension), 'utf8'));
test('extension entries retain the worker and video page paths', async () => {
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.action.default_popup, 'popup.html');
  assert.equal(manifest.options_ui, undefined);
  for (const page of ['popup.html', 'manager.html', 'preview.html'])
    assert.ok((await stat(new URL(page, extension))).isFile());
  assert.equal(await readFile(new URL('background.js', extension), 'utf8'), "/** Stable service-worker entry. */\nimport './background/background.js';\n");
});
test('video adapters and their page scope are declared directly in the manifest', async () => {
  assert.ok(manifest.content_scripts.length > 0);
  for (const entry of manifest.content_scripts) {
    assert.equal(entry.js[0], 'content/page-scope.js');
    for (const file of [...entry.js, ...(entry.css || [])])
      assert.ok((await stat(new URL(file, extension))).isFile(), file);
  }
  for (const entry of manifest.web_accessible_resources)
    for (const file of entry.resources)
      assert.ok((await stat(new URL(file, extension))).isFile(), file);
});
