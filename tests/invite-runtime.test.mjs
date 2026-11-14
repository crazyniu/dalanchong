import test from 'node:test';
import assert from 'node:assert/strict';
import {createInviteRuntime} from '../browser-extension/invite-runtime.js';

const scope = {userId: 'profile', platform: 'kuaishou', platformAccountId: 'shop'};
const config = {products: '123', message: '合作邀请', phone: '', wechat: 'contact', interval: 0};
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; };
async function eventually(check) {
  for (let n = 0; n < 100; n++) { if (check()) return; await new Promise(r => setImmediate(r)); }
  assert.ok(check(), 'operation did not settle');
}
function fixture() {
  let valid = true, sent = 0;
  const tasks = new Map(), records = new Map();
  const store = {
    async recover() { for (const row of records.values()) if (row.status === 'sending') row.status = 'review'; },
    async getTalent(_scope, id) { return {id, name: id}; },
    async createTask(_scope, fields) { const row = {...fields, id: String(tasks.size + 1), status: 'running'}; tasks.set(row.id, row); return {...row}; },
    async updateTask(_scope, id, patch) { const row = {...tasks.get(id), ...patch}; tasks.set(id, row); return {...row}; },
    async reserveInvitation(_scope, row) {
      if (records.has(row.talentId)) return {created: false};
      records.set(row.talentId, {...row, status: 'sending'}); return {created: true};
    },
    async finishInvitation(_scope, id, patch) { records.set(id, {...records.get(id), ...patch}); },
  };
  const license = {
    requireValid() { if (!valid) throw Object.assign(new Error('inactive'), {license: true, beforeSend: true}); },
    async rules(action) {
      if (action === 'invite.validate') return {productIds: ['123'], interval: 0, retryDelayMs: 0, frequencyRetryDelayMs: 0};
      return {allowed: true, sendPath: '/distribute/pc/seller/invite/seller/create', defaults: {canRealUpdatePrice: 2, selected: 1}};
    },
  };
  const connection = {
    async assertIdentity() {},
    async api(path, body, method, onResponse, beforeDispatch) {
      beforeDispatch?.();
      if (path.includes('/contact?')) return {data: {inviteContactName: 'test', wechatId: 'test'}};
      if (path.endsWith('/tag/query')) return {data: []};
      sent++; return {data: {}};
    },
  };
  const runtime = createInviteRuntime({store, license});
  return {store, license, connection, runtime, tasks, records, revoke: () => { valid = false; }, sent: () => sent};
}

test('stopAll during rule validation prevents later task creation', async () => {
  const f = fixture(), pending = defer(), rules = f.license.rules;
  f.license.rules = async (...args) => { await pending.promise; return rules(...args); };
  const start = f.runtime.startInvitation(scope, f.connection, config, ['1']);
  f.runtime.stopAll(); pending.resolve();
  await assert.rejects(start, /停止/);
  assert.equal(f.tasks.size, 0); assert.equal(f.sent(), 0);
});

test('scope stop during selection validation prevents late start', async () => {
  const f = fixture(), pending = defer(), entered = defer();
  f.store.getTalent = async (_scope, id) => { entered.resolve(); await pending.promise; return {id}; };
  const start = f.runtime.startInvitation(scope, f.connection, config, ['1']);
  await entered.promise; f.runtime.stop(scope, 'invite'); pending.resolve();
  await assert.rejects(start, /停止/); assert.equal(f.tasks.size, 0);
});

test('revocation immediately after creating task persists stopped state', async () => {
  const f = fixture(), create = f.store.createTask;
  f.store.createTask = async (...args) => { const row = await create(...args); f.revoke(); return row; };
  await assert.rejects(f.runtime.startInvitation(scope, f.connection, config, ['1']), /inactive/);
  assert.equal(f.tasks.get('1').status, 'stopped'); assert.equal(f.sent(), 0);
});

test('stop during platform readiness check prevents dispatch', async () => {
  const f = fixture(), api = f.connection.api, entered = defer(), pending = defer();
  f.connection.api = async (...args) => {
    if (args[0].endsWith('/seller/create')) { entered.resolve(); await pending.promise; }
    return api(...args);
  };
  await f.runtime.startInvitation(scope, f.connection, config, ['1']);
  await entered.promise; f.runtime.stopAll(); pending.resolve();
  await eventually(() => f.tasks.get('1').status === 'stopped');
  assert.equal(f.sent(), 0); assert.equal(f.records.get('1').status, 'failed');
});

test('uncertain dispatched request is marked review and never retried', async () => {
  const f = fixture(), api = f.connection.api; let attempts = 0;
  f.connection.api = async (...args) => {
    if (args[0].endsWith('/seller/create')) { args[4](); attempts++; throw new Error('response lost'); }
    return api(...args);
  };
  await f.runtime.startInvitation(scope, f.connection, config, ['1', '2']);
  await eventually(() => f.tasks.get('1').status === 'stopped');
  assert.equal(attempts, 1); assert.equal(f.records.get('1').status, 'review');
  assert.equal(f.records.has('2'), false);
});

test('history deduplication skips without another send', async () => {
  const f = fixture(); f.records.set('1', {status: 'success'});
  await f.runtime.startInvitation(scope, f.connection, config, ['1']);
  await eventually(() => f.tasks.get('1').status === 'completed');
  assert.equal(f.sent(), 0); assert.equal(f.tasks.get('1').skipped, 1);
});

test('storage failure after successful send never retries platform request', async () => {
  const f = fixture(); f.store.finishInvitation = async () => { throw new Error('storage unavailable'); };
  await f.runtime.startInvitation(scope, f.connection, config, ['1', '2']);
  await eventually(() => f.tasks.get('1').status === 'stopped');
  assert.equal(f.sent(), 1); assert.equal(f.records.get('1').status, 'sending');
  assert.equal(f.records.has('2'), false);
});

test('page preparation and job start share one scope recovery', async () => {
  const f = fixture(); let calls = 0;
  f.store.recover = async () => { calls++; };
  await Promise.all([f.runtime.recoverScope(scope), f.runtime.recoverScope(scope)]);
  await f.runtime.startInvitation(scope, f.connection, config, ['1']);
  await f.runtime.recoverScope(scope);
  await eventually(() => f.tasks.get('1').status === 'completed');
  assert.equal(calls, 1);
});
