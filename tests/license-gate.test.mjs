/**
 * AI module map
 * Purpose: exercise real worker message licensing using synthetic Chrome/HTTP mocks.
 * Entry: node --test tests/license-gate.test.mjs; nested cases share one worker lifecycle.
 * Boundary: no browser, real credentials/accounts, network, activation or platform calls.
 * Fake replies model activation, revocation and reactivation to check stale business replies.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

const id = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const root = `chrome-extension://${id}/`;
const code = 'A'.repeat(24);
const installationId = '22222222-2222-4222-8222-222222222222';
const owner = {id, url: root + 'popup.html'};
const webpage = {id, url: 'https://example.invalid/', tab: {id: 7, url: 'https://example.invalid/'}};
const json = body => new Response(JSON.stringify(body), {headers: {'content-type': 'application/json'}});

test('central worker license gate and delayed business responses', async t => {
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  const listeners = [], broadcasts = [], requests = [];
  let stored = {installationId}, serverValid = true;
  Object.defineProperty(globalThis, 'chrome', {configurable: true, value: {
    runtime: {id, getURL: path => root + path.replace(/^\//, ''),
      onMessage: {addListener: callback => listeners.push(callback)},
      sendMessage: async message => { broadcasts.push(message); }},
    storage: {local: {get: async () => ({invitationLicense: structuredClone(stored)}),
      set: async values => { stored = structuredClone(values.invitationLicense); }}},
    tabs: {query: async () => [], sendMessage: async () => {}},
    alarms: {create: async () => {}, onAlarm: {addListener: () => {}}},
  }});
  Object.defineProperty(navigator, 'locks', {configurable: true, value: {request: async (_name, action) => action()}});
  t.mock.method(globalThis, 'setInterval', () => 1);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /^https:\/\/dabudian\.top\/functions\/v1\/license-api\/(activate|verify)$/);
    requests.push({url, body: JSON.parse(options.body)});
    return json({valid: serverValid, reason: serverValid ? 'active' : 'device_disabled', app_id: 'dalanchong',
      server_time: new Date().toISOString(), activated_at: new Date().toISOString(), expires_at: null});
  });
  t.after(() => {
    if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome); else delete globalThis.chrome;
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else delete navigator.locks;
  });
  const background = await import('../browser-extension/license-background.js');
  const {listenMessages} = await import('../browser-extension/messages.js');
  function send(message, sender = owner) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Mock message received no response')), 1000);
      const respond = value => { clearTimeout(timeout); resolve(value); };
      for (const listener of listeners) listener(message, sender, respond);
    });
  }
  let businessCalls = 0;
  listenMessages(new Set(['MOCK_BUSINESS']), (_message, _sender, respond) => {
    businessCalls++; respond({ok: true, value: 'business'});
  });

  await t.test('unactivated business never reaches the handler; status remains readable', async () => {
    const result = await send({type: 'MOCK_BUSINESS'});
    assert.equal(result.ok, false); assert.equal(result.license, true); assert.equal(businessCalls, 0);
    const status = await send({type: 'LICENSE_STATUS'}, webpage);
    assert.equal(status.ok, true); assert.equal(status.license.valid, false); assert.equal(status.license.hasCode, false);
    assert.equal(requests.length, 0);
    assert.equal(JSON.stringify(status).includes(code), false);
  });

  await t.test('foreign senders, remote pages and embedded extension frames cannot activate', async () => {
    const responseCalls = [];
    for (const listener of listeners)
      assert.equal(listener({type: 'LICENSE_ACTIVATE', code}, {...owner, id: 'other-extension'}, value => responseCalls.push(value)), undefined);
    assert.equal(responseCalls.length, 0);
    for (const sender of [webpage, {id, url: root + 'preview.html?media=x', tab: {url: 'https://example.invalid/'}},
      {id, url: root + 'unknown.html'}, {id, url: 'https://attacker.invalid/popup.html'}]) {
      const response = await send({type: 'LICENSE_ACTIVATE', code}, sender);
      assert.equal(response.ok, false);
    }
    assert.equal(requests.length, 0);
    assert.equal(background.trustedLicensePage({id, url: root + 'manager.html?view=captured', tab: {url: root + 'manager.html?view=captured'}}), true);
  });

  await t.test('legacy invitation activation aliases are also restricted', async () => {
    let called = false;
    listenMessages(new Set(['INVITE_ACTIVATE']), (_message, _sender, reply) => { called = true; reply({ok: true}); });
    const response = await send({type: 'INVITE_ACTIVATE', code}, webpage);
    assert.equal(response.ok, false); assert.equal(called, false);
  });

  await t.test('explicit owner activation unlocks normal business without exposing code', async () => {
    const result = await send({type: 'LICENSE_ACTIVATE', code});
    assert.equal(result.ok, true); assert.equal(result.license.valid, true);
    assert.equal(JSON.stringify(result).includes(code), false);
    assert.equal(JSON.stringify(broadcasts).includes(code), false);
    assert.equal((await send({type: 'MOCK_BUSINESS'})).value, 'business');
    assert.equal(businessCalls, 1);
  });

  await t.test('revocation epoch rejects old replies even after valid reactivation', async () => {
    let ready, delayedReply;
    const started = new Promise(resolve => { ready = resolve; });
    listenMessages(new Set(['MOCK_DELAYED']), (_message, _sender, reply) => { delayedReply = reply; ready(); });
    const pending = send({type: 'MOCK_DELAYED'});
    await started;
    const previousEpoch = background.licenseEpoch();
    serverValid = false;
    assert.equal((await send({type: 'LICENSE_VERIFY'})).license.valid, false);
    assert.ok(background.licenseEpoch() > previousEpoch);
    const blocked = await send({type: 'MOCK_BUSINESS'});
    assert.equal(blocked.ok, false); assert.equal(businessCalls, 1);
    serverValid = true;
    assert.equal((await send({type: 'LICENSE_ACTIVATE', code})).license.valid, true);
    delayedReply({ok: true, value: 'stale'});
    const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.license, true); assert.equal(result.value, undefined);
    assert.equal((await send({type: 'MOCK_BUSINESS'})).value, 'business');
  });
});
