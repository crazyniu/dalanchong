/** Local lifecycle regression tests, without account data or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {featureScripts} from '../browser-extension/feature-scripts.js';
const source = await readFile(new URL('../browser-extension/feature-gate.js', import.meta.url), 'utf8');
function harness() {
  const timers = new Map(), listeners = new Set(), nodes = [];
  let id = 0, disconnected = 0;
  const context = vm.createContext({
    setTimeout: fn => { timers.set(++id, fn); return id; },
    setInterval: fn => { timers.set(++id, fn); return id; },
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id),
    MutationObserver: class { disconnect() { disconnected++; } },
    document: {createElement: () => { const node = {removed: false, remove() { this.removed = true; }}; nodes.push(node); return node; }},
    chrome: {runtime: {id: 'own', onMessage: {
      addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn)
    }}},
  });
  vm.runInContext(source, context);
  return {context, gate: context.__dlcFeatureGate, timers, listeners, nodes,
    disconnected: () => disconnected, run: () => vm.runInContext(source, context)};
}
test('revocation cancels callbacks, removes UI and observers; stale scope cannot rebuild', () => {
  const h = harness(), scope = h.gate.begin('capture');
  let calls = 0;
  scope.createElement('div');
  scope.setTimeout(() => calls++, 100);
  scope.setInterval(() => calls++, 100);
  new scope.MutationObserver(() => calls++);
  const stale = [...h.timers.values()];
  h.gate.stop();
  stale.forEach(fn => fn());
  assert.equal(calls, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.disconnected(), 1); assert.equal(h.nodes[0].removed, true);
  assert.throws(() => scope.createElement('div'), /授权/);
  scope.setInterval(() => calls++, 100);
  assert.equal(h.timers.size, 0);
  assert.equal(h.gate.begin('late'), null);
  h.run();
  assert.equal(h.context.__dlcFeatureGate.active, true);
  assert.equal(scope.active, false);
});
test('only own runtime revocation stops gate; status messages never reactivate it', () => {
  const h = harness(), notify = [...h.listeners][0];
  notify({type: 'LICENSE_CHANGED', license: {valid: false}}, {id: 'other'});
  assert.equal(h.gate.active, true);
  notify({type: 'LICENSE_CHANGED', license: {valid: false}}, {id: 'own'});
  assert.equal(h.gate.active, false); assert.equal(h.listeners.size, 0);
  notify({type: 'LICENSE_CHANGED', license: {valid: true}}, {id: 'own'});
  assert.equal(h.gate.active, false);
});
test('feature scopes are idempotent and site hooks restore without overwriting newer hooks', () => {
  const h = harness(), scope = h.gate.begin('main');
  assert.equal(h.gate.begin('main'), null);
  const original = () => 1, newer = () => 3, object = {fn: original};
  scope.patch(object, 'fn', () => 2);
  object.fn = newer;
  scope.stop(); assert.equal(object.fn, newer);
});
test('only inert bootstrap is static; all business scripts require per-document license approval', async () => {
  const manifest = JSON.parse(await readFile(new URL('../browser-extension/manifest.json', import.meta.url)));
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].js, ['feature-bootstrap.js']);
  assert.equal(manifest.content_scripts[0].match_about_blank, true);
  assert.equal(manifest.minimum_chrome_version, '116');
  assert.ok(manifest.permissions.includes('alarms'));
  assert.equal(featureScripts.length, 7);
  for (const script of featureScripts) {
    assert.equal(script.js[0], 'feature-gate.js');
    for (const file of script.js.slice(1)) {
      const text = await readFile(new URL('../browser-extension/' + file, import.meta.url), 'utf8');
      assert.match(text, /__dlcFeatureGate\?\.begin/);
      assert.doesNotMatch(text, /(?<!scope)\.addEventListener\(/);
    }
  }
});

const injectionSource = (await readFile(new URL('../browser-extension/injection-gate-background.js', import.meta.url), 'utf8'))
  .replace(/^import .*;\n/gm, '').replace('export function initializeFeatureInjection', 'function initializeFeatureInjection');
function injectionHarness() {
  let state = {valid: false}, epoch = 0, changed, message, registerWait;
  const calls = [];
  const context = vm.createContext({featureScripts, console,
    licenseStatus: () => state, licenseEpoch: () => epoch,
    initializeLicense: async () => state,
    onLicenseChange: fn => { changed = fn; },
    chrome: {runtime: {id: 'own', onMessage: {addListener: fn => { message = fn; }}},
      tabs: {query: async () => [{id: 1}]},
      scripting: {
        registerContentScripts: async scripts => { calls.push(['register', scripts]); if (registerWait) await registerWait; },
        unregisterContentScripts: async () => { calls.push(['unregister']); },
        removeCSS: async () => { calls.push(['removeCSS']); },
        insertCSS: async options => { calls.push(['css', options]); },
        executeScript: async options => {
          calls.push([options.files ? 'business' : 'probeOrStop', options]);
          return options.func ? [{frameId: 0, result: {url: 'https://www.douyin.com/video/1'}}] : [];
        }
      }
    }
  });
  vm.runInContext(injectionSource, context);
  return {calls, blockRegister: promise => { registerWait = promise; },
    change(valid) { state = {valid}; if (!valid) epoch++; return changed(state); },
    request(sender) { return new Promise(resolve => { const reply = message({type: 'REQUEST_FRAME_FEATURES', phase: 'all'}, sender, resolve); if (!reply) resolve(undefined); }); }
  };
}
test('unactivated frames never load business; active worker only seeds inert bootstrap', async () => {
  const h = injectionHarness();
  await h.change(false);
  await h.request({id: 'own', tab: {id: 1}, frameId: 0, documentId: 'doc', url: 'https://www.douyin.com/video/1'});
  assert.equal(h.calls.some(call => call[0] === 'business' || call[0] === 'register'), false);
  await h.change(true);
  assert.equal(h.calls.some(call => call[0] === 'register'), false);
  assert.ok(h.calls.filter(call => call[0] === 'business').every(call => call[1].files[0] === 'feature-bootstrap.js'));
  h.calls.length = 0;
  await h.change(false);
  await h.request({id: 'own', tab: {id: 1}, frameId: 0, documentId: 'doc', url: 'https://www.douyin.com/video/1'});
  assert.equal(h.calls.some(call => call[0] === 'business'), false);
});
test('about:blank bootstrap targets verified document and only original inherited-frame capture', async () => {
  const h = injectionHarness();
  await h.change(true); h.calls.length = 0;
  await h.request({id: 'own', tab: {id: 1}, frameId: 2, documentId: 'frame-document', url: 'about:blank', origin: 'https://www.douyin.com'});
  const injections = h.calls.filter(call => call[0] === 'business');
  assert.equal(injections.length, 1);
  assert.deepEqual(Array.from(injections[0][1].files), ['feature-gate.js', 'capture.js']);
  assert.deepEqual(Array.from(injections[0][1].target.documentIds), ['frame-document']);
  h.calls.length = 0;
  await h.request({id: 'foreign', tab: {id: 1}, frameId: 2, documentId: 'fake', url: 'https://www.douyin.com'});
  assert.equal(h.calls.length, 0);
});
