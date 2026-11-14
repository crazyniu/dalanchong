import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';
import {invitationObserver} from '../browser-extension/invite-observer.js';
const gateSource = fs.readFileSync(new URL('../browser-extension/feature-gate.js', import.meta.url), 'utf8');
function page() {
  class XHR extends EventTarget { open() {} send() {} }
  const target = new EventTarget();
  const originalFetch = async () => new Response('{}');
  const context = vm.createContext({URL, Request, Response, TextDecoder, crypto: webcrypto,
    XMLHttpRequest: XHR, MutationObserver: class {disconnect() {}},
    location: {origin: 'https://buyin.jinritemai.com', href: 'https://buyin.jinritemai.com/dashboard/servicehall/daren-square'},
    history: {pushState() {}, replaceState() {}}, fetch: originalFetch,
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target),
    setTimeout, clearTimeout, setInterval, clearInterval});
  vm.runInContext('window = globalThis; top = window', context);
  vm.runInContext(gateSource, context);
  const install = () => vm.runInContext(`(${invitationObserver.toString()})('douyin')`, context);
  return {context, install, originalFetch, XHR};
}
test('revocation removes owned hooks/cache, permits fresh install, stale access rejected', () => {
  const {context: c, install, originalFetch, XHR} = page();
  const open = XHR.prototype.open, send = XHR.prototype.send, push = c.history.pushState;
  install();
  const old = c.__DALANCHONG_INVITATION_OBSERVER__;
  assert.notEqual(c.fetch, originalFetch);
  c.__dlcFeatureGate.stop();
  assert.equal(c.fetch, originalFetch); assert.equal(XHR.prototype.open, open); assert.equal(XHR.prototype.send, send);
  assert.equal(c.history.pushState, push); assert.equal(c.__DALANCHONG_INVITATION_OBSERVER__, undefined);
  assert.throws(() => old.access('snapshot', {}));
  vm.runInContext(gateSource, c); install();
  assert.notEqual(c.__DALANCHONG_INVITATION_OBSERVER__, old);
});
test('cleanup never overwrites a newer page hook; inactive retained wrapper is inert', async () => {
  const {context: c, install} = page();
  let resolve, clones = 0;
  c.fetch = () => new Promise(r => {resolve = r;});
  install();
  const hooked = c.fetch;
  const late = hooked('https://buyin.jinritemai.com/index/getUser');
  const newer = (...args) => hooked(...args); c.fetch = newer;
  c.__dlcFeatureGate.stop();
  assert.equal(c.fetch, newer);
  resolve({clone(){clones++; return new Response('{}');}});
  await late; await new Promise(r => setTimeout(r, 0));
  assert.equal(clones, 0); assert.equal(c.__DALANCHONG_INVITATION_OBSERVER__, undefined);
});
test('prepare injects MAIN gate first and refuses observer install after epoch change', async () => {
  let epoch = 1; const calls = [];
  const c = vm.createContext({Map, URL, invitationObserver, invitationSource: () => ({platform:'douyin'}),
    requireLicense: expected => {if (expected !== undefined && expected !== epoch) throw Error('stale');}, licenseEpoch: () => epoch,
    chrome: {tabs:{get:async()=>({url:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square'})},
      scripting:{executeScript:async options=>{calls.push(options);epoch++;return [{frameId:0,documentId:'doc'}];}}}});
  const source=fs.readFileSync(new URL('../browser-extension/invite-observation.js', import.meta.url),'utf8')
    .replace(/^import .*;\n/gm,'').replace(/^export /gm,'');
  vm.runInContext(source+'\nglobalThis.prepare=prepareObservation;',c);
  await assert.rejects(c.prepare(1,'douyin'), /stale/);
  assert.equal(calls.length,1);assert.equal(calls[0].world,'MAIN');assert.equal(calls[0].files[0],'feature-gate.js');
});
test('dispose removes scope slot; a different epoch gets a new observer', () => {
  const {context: c} = page();
  const call = (action, payload) => vm.runInContext(`(${invitationObserver.toString()})('douyin', ${JSON.stringify(action)}, ${JSON.stringify(payload)})`, c);
  const initial = call('install', {lifecycleEpoch:1});
  const fresh = call('install', {lifecycleEpoch:2});
  assert.notEqual(initial.documentId, fresh.documentId);
  call('dispose', {});
  assert.equal(c.__DALANCHONG_INVITATION_OBSERVER__, undefined);
  assert.doesNotThrow(() => call('install', {lifecycleEpoch:2}));
});
