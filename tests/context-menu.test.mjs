/** Local shortcut mocks only; no browser, activation, platform calls or downloads. */
import test from 'node:test';
import assert from 'node:assert/strict';
const originalChrome = globalThis.chrome;
globalThis.chrome = {alarms: {onAlarm: {addListener() {}}}, runtime: {onMessage: {addListener() {}}}};
const {createContextMenuController} = await import('../browser-extension/background/context-menu-background.js');
if (originalChrome === undefined) delete globalThis.chrome; else globalThis.chrome = originalChrome;
const root = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
function fixture(initial = false) {
  let active = initial, epoch = 0, subscriber, clickHandler;
  const entries = new Map(), opened = [], updated = [];
  const deps = {
    runtime: {getURL: path => root + path},
    menus: {removeAll(callback) { entries.clear(); callback(); },
      create(item, callback) { entries.set(item.id, item); callback(); },
      onClicked: {addListener(handler) { clickHandler = handler; }}},
    tabs: {async query() { return []; }, async create(item) { opened.push(item.url); return {id: 8}; }, async update(id, item) { updated.push({id, ...item}); }},
    license: {async initialize() {}, epoch: () => epoch,
      require(expected) { if (!active || expected !== undefined && expected !== epoch) throw Error('inactive'); },
      subscribe(handler) { subscriber = handler; }},
  };
  const controller = createContextMenuController(deps);
  return {deps, controller, entries, opened, updated,
    async change(value) { active = value; epoch++; return subscriber?.({valid: value}); },
    handler: () => clickHandler};
}
test('unactivated profile has only activation and rejects stale business shortcut', async () => {
  const f = fixture(); await f.controller.initialize();
  assert.deepEqual([...f.entries.keys()], ['dalanchong-activate']);
  await f.controller.click({menuItemId: 'dalanchong-invite-douyin'});
  assert.deepEqual(f.opened, [root + 'popup.html']);
});
test('activation restores three shortcuts without initiating business actions', async () => {
  const f = fixture(); await f.controller.initialize(); await f.change(true);
  assert.deepEqual([...f.entries.keys()], ['dalanchong-video', 'dalanchong-invite-douyin', 'dalanchong-invite-kuaishou', 'dalanchong-settings']);
  for (const menuItemId of f.entries.keys()) await f.controller.click({menuItemId});
  assert.deepEqual(f.opened, [root + 'manager.html?view=captured', 'https://buyin.jinritemai.com/dashboard/servicehall/daren-square', 'https://cps.kwaixiaodian.com/zone/daren-match/peer-reference', root + 'settings.html']);
  await f.change(false); assert.deepEqual([...f.entries.keys()], ['dalanchong-activate']);
});
test('revocation and reactivation during click verification cannot reuse stale epoch', async () => {
  const f = fixture(true); await f.controller.initialize();
  const pending = deferred(); f.deps.license.initialize = () => pending.promise;
  const click = f.controller.click({menuItemId: 'dalanchong-video'});
  await f.change(false); await f.change(true); pending.resolve(); await click;
  assert.deepEqual(f.opened, [root + 'popup.html']);
});
test('revocation while tab is opening redirects the created tab to activation', async () => {
  const f = fixture(true); await f.controller.initialize();
  f.deps.tabs.create = async item => { f.opened.push(item.url); await f.change(false); return {id: 8}; };
  await f.controller.click({menuItemId: 'dalanchong-settings'});
  assert.deepEqual(f.updated, [{id: 8, url: root + 'popup.html'}]);
});
test('unknown IDs cannot open arbitrary pages and initialization is idempotent', async () => {
  const f = fixture(true); await f.controller.initialize(); const handler = f.handler();
  await f.controller.initialize(); assert.equal(f.handler(), handler);
  await f.controller.click({menuItemId: 'https://example.invalid'});
  assert.deepEqual(f.opened, []);
});
