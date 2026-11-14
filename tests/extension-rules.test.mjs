/**
 * AI module map
 * Purpose: exercise the public license adapter with local mock HTTP/storage only.
 * Entry: node --test tests/extension-rules.test.mjs; optionally set EXTENSION_RULES_MODULE
 * to a local rules.ts file and pass --experimental-transform-types with Node 24
 * to check the real service evaluator contract (without starting a server).
 * Boundary: synthetic codes/profile IDs, no network, credentials, activation or platform sends.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {createInviteLicense} from '../browser-extension/invite-license.js';

const code = 'A'.repeat(24);
const installationId = '11111111-1111-4111-8111-111111111111';
const input = {platform: 'douyin', products: '123,456', messageLength: 10,
  hasPhone: true, hasWechat: false, interval: 5000, maxInvites: null};
const validation = {productIds: ['123', '456'], minInterval: 5000, interval: 5000,
  retryDelayMs: 10000, frequencyRetryDelayMs: 60000};
const eligibility = {is_passed: true, connection_type: 1, need_strong_template: false};
const decide = {platform: 'douyin', productIds: ['123'], eligibility, availableProductIds: ['123']};
const decision = {allowed: true, productIds: ['123'], sendPath: '/connection/pc/im/invite/card/send',
  defaults: {account_type: 1, entry_point: 1, author_sample_status: 0, rights: [], is_open_feed: false, client_form: 'pc'}};
const response = (body, status = 200) => new Response(JSON.stringify(body), {status,
  headers: {'content-type': 'application/json'}});
const active = () => ({valid: true, reason: 'active', app_id: 'dalanchong', server_time: new Date().toISOString(),
  activated_at: new Date().toISOString(), expires_at: null});

function harness(t, {saved = true, rules, activation} = {}) {
  const originalChrome = Object.getOwnPropertyDescriptor(globalThis, 'chrome');
  const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');
  let record = saved ? {installationId, code} : {installationId};
  const calls = [];
  Object.defineProperty(globalThis, 'chrome', {configurable: true, value: {storage: {local: {
    get: async () => ({invitationLicense: structuredClone(record)}),
    set: async value => { record = structuredClone(value.invitationLicense); },
  }}}});
  Object.defineProperty(navigator, 'locks', {configurable: true, value: {request: async (_name, fn) => fn()}});
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({url, body, options});
    if (url.endsWith('/license-api/verify')) return response(active());
    if (url.endsWith('/license-api/activate')) return response(activation ? activation() : active());
    if (url.endsWith('/extension-rules')) {
      if (!rules) throw Error('Unexpected mock rules request');
      return rules(body, options);
    }
    throw Error('Network is prohibited in this test');
  });
  t.after(() => {
    if (originalChrome) Object.defineProperty(globalThis, 'chrome', originalChrome); else delete globalThis.chrome;
    if (originalLocks) Object.defineProperty(navigator, 'locks', originalLocks); else delete navigator.locks;
  });
  return {license: createInviteLicense(), calls, stored: () => record};
}

test('sensitive DTO fields are rejected before any HTTP or secret storage read', async t => {
  const {license, calls} = harness(t);
  for (const key of ['phone', 'wechat', 'cookie', 'token', 'message', 'code', 'url'])
    await assert.rejects(license.rules('invite.validate', {...input, [key]: 'must-not-leave'}), {cloudRules: true});
  await assert.rejects(license.rules('invite.decide', {...decide, eligibility: {...eligibility, cookie: 'blocked'}}), {cloudRules: true});
  await assert.rejects(license.rules('video.rank', {candidates: [{index: 0, quality: '视频', height: 720, updatedAt: 1, url: 'https://private.invalid'}]}), {cloudRules: true});
  assert.equal(calls.length, 0);
});

test('valid rule request sends only the declared summary and uses isolated HTTP options', async t => {
  const {license, calls} = harness(t, {rules: () => response({valid: true, result: validation})});
  assert.deepEqual(await license.rules('invite.validate', input), validation);
  const request = calls.at(-1);
  assert.deepEqual(request.body.input, input);
  assert.deepEqual(Object.keys(request.body).sort(), ['action', 'app_id', 'code', 'device_id', 'input']);
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.options.cache, 'no-store');
  const publicStatus = JSON.stringify(license.status());
  assert.equal(publicStatus.includes(code), false);
});

test('malformed envelopes, invalid policies and arbitrary send endpoints are rejected', async t => {
  let envelope;
  const {license} = harness(t, {rules: () => response(envelope)});
  for (const bad of [{result: validation}, {valid: false, result: validation}, {valid: true},
    {valid: true, result: {...validation, interval: 1}},
    {valid: true, result: {...validation, productIds: ['999']}},
    {valid: true, result: {...validation, frequencyRetryDelayMs: 1}}]) {
    envelope = bad;
    await assert.rejects(license.rules('invite.validate', input), {cloudRules: true});
  }
  envelope = {valid: true, result: {...decision, sendPath: 'https://attacker.invalid/send'}};
  await assert.rejects(license.rules('invite.decide', decide), {cloudRules: true});
  envelope = {valid: true, result: decision};
  assert.deepEqual(await license.rules('invite.decide', decide), decision);
});

test('rank result must be a permutation of submitted indices', async t => {
  let indices = [2, 2];
  const {license} = harness(t, {rules: () => response({valid: true, result: {indices}})});
  const candidates = [{index: 2, quality: '视频', height: 720, updatedAt: 1}, {index: 4, quality: '原片候选', height: 1080, updatedAt: 2}];
  for (const invalid of [[2, 2], [2], [2, 9], ['2', 4]]) {
    indices = invalid; await assert.rejects(license.rules('video.rank', {candidates}), {cloudRules: true});
  }
  indices = [4, 2];
  assert.deepEqual(await license.rules('video.rank', {candidates}), {indices});
});

test('server revocation fails closed and cannot be bypassed by another rules request', async t => {
  const {license, calls} = harness(t, {rules: () => response({valid: false, reason: 'device_disabled'}, 403)});
  await assert.rejects(license.rules('invite.validate', input), {license: true, reason: 'device_disabled'});
  assert.equal(license.status().valid, false);
  const count = calls.length;
  await assert.rejects(license.rules('invite.validate', input), {license: true});
  assert.equal(calls.length, count);
});

test('a delayed successful rule response cannot restore an expired lease', async t => {
  let resolveRule, started;
  const didStart = new Promise(resolve => { started = resolve; });
  const {license} = harness(t, {rules: () => { started(); return new Promise(resolve => { resolveRule = resolve; }); }});
  await license.initialize();
  const current = Date.now();
  let wall = current;
  t.mock.method(Date, 'now', () => wall);
  const pending = license.rules('invite.validate', input);
  await didStart;
  wall += 11 * 60 * 1000;
  assert.equal(license.status().valid, false);
  resolveRule(response({valid: true, result: validation}));
  await assert.rejects(pending, {license: true, reason: 'verification_required'});
  assert.equal(license.status().valid, false);
});

test('failed binding does not save the rejected code or automatically reactivate', async t => {
  const {license, stored, calls} = harness(t, {saved: false, activation: () => ({...active(), valid: false, reason: 'device_mismatch'})});
  await assert.rejects(license.activate(code), {license: true, reason: 'device_mismatch'});
  assert.deepEqual(stored(), {installationId});
  assert.equal(license.status().valid, false);
  assert.equal(calls.filter(call => call.url.endsWith('/activate')).length, 1);
});

test('real local rules evaluator matches the adapter contract without HTTP', {skip: !process.env.EXTENSION_RULES_MODULE}, async t => {
  const {evaluate} = await import(pathToFileURL(process.env.EXTENSION_RULES_MODULE).href);
  const {license} = harness(t, {rules: body => response({valid: true, result: evaluate(body.action, body.input)})});
  assert.deepEqual(await license.rules('invite.validate', input), validation);
  assert.deepEqual(await license.rules('invite.decide', decide), decision);
  const ks = {platform: 'kuaishou', productIds: ['123'], hasContactName: true, hasPhone: true, hasWechat: true};
  assert.equal((await license.rules('invite.decide', ks)).sendPath, '/distribute/pc/seller/invite/seller/create');
  assert.equal((await license.rules('invite.decide', {...ks, hasPhone: false})).skip.length > 0, true);
  assert.equal((await license.rules('invite.decide', {platform: 'douyin', productIds: ['123'], eligibility})).needsProducts, true);
  assert.throws(() => evaluate('invite.validate', {...input, phone: 'not-allowed'}));
});
