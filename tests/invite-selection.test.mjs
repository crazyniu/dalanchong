import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB, IDBKeyRange} from 'fake-indexeddb';
import {openInviteStore} from '../browser-extension/invitation/background/invite-store.js';
globalThis.indexedDB = indexedDB; globalThis.IDBKeyRange = IDBKeyRange;
test('invitation eligibility intersects current filters with absence of any account-scoped record', async () => {
  const store = await openInviteStore();
  const scope = {userId: 'selection-tests', platform: 'douyin', platformAccountId: 'a'};
  const other = {...scope, platformAccountId: 'b'};
  try {
    await store.upsertTalents(scope, [{id: '1', name: 'Match sent'}, {id: '2', name: 'Match new'}, {id: '3', name: 'Other'}]);
    await store.upsertTalents(other, [{id: '1', name: 'Match new other account'}]);
    const task = await store.createTask(scope, {kind: 'invite', total: 1});
    await store.reserveInvitation(scope, {talentId: '1', taskId: task.id});
    await store.finishInvitation(scope,'1',{taskId:task.id,status:'success'});
    assert.deepEqual(await store.listTalentIds(scope, {status:'success'}, true), []);
    assert.deepEqual(await store.listTalentIds(scope, {query: 'Match'}, true), ['2']);
    assert.deepEqual(await store.listTalentIds(scope, {query: 'Match', status:'pending'}, true), ['2']);
    assert.deepEqual(await store.listTalentIds(other, {query: 'Match'}, true), ['1']);
    assert.deepEqual(await store.listTalentIds(scope, {status:'success'}), ['1']);
    assert.equal((await store.listInvitations(scope)).length, 1);
  } finally { store.close(); }
});
