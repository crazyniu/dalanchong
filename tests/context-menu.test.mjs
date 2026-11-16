/** Local shortcut mocks only; no browser, platform calls or downloads. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createContextMenuController} from '../browser-extension/background/context-menu-background.js';
const root = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
function fixture() {
  let clickHandler;
  const entries = new Map(), opened = [];
  const controller = createContextMenuController({
    runtime: {getURL: path => root + path},
    menus: {removeAll(callback) { entries.clear(); callback(); },
      create(item, callback) { entries.set(item.id, item); callback(); },
      onClicked: {addListener(handler) { clickHandler = handler; }}},
    tabs: {async create(item) { opened.push(item.url); return {id: 8}; }},
  });
  return {controller, entries, opened, handler: () => clickHandler};
}
test('video shortcut opens the video workspace without starting a download', async () => {
  const f = fixture(); await f.controller.initialize();
  assert.deepEqual([...f.entries.keys()], ['dalanchong-video']);
  await f.controller.click({menuItemId: 'dalanchong-video'});
  assert.deepEqual(f.opened, [root + 'manager.html?view=captured']);
});
test('unknown IDs cannot open arbitrary pages and initialization is idempotent', async () => {
  const f = fixture(); await f.controller.initialize(); const handler = f.handler();
  await f.controller.initialize(); assert.equal(f.handler(), handler);
  await f.controller.click({menuItemId: 'https://example.invalid'});
  assert.deepEqual(f.opened, []);
});
