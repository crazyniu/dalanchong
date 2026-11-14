import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB, IDBKeyRange} from 'fake-indexeddb';
import {openInviteStore} from '../browser-extension/invite-store.js';
globalThis.indexedDB = indexedDB; globalThis.IDBKeyRange = IDBKeyRange;
const scope = name => ({userId: 'profile', platform: 'douyin', platformAccountId: name});

test('IndexedDB scope, filters, reservation, recovery and manual review stay atomic', async () => {
  const store = await openInviteStore();
  try {
    const a = scope('a'), b = scope('b');
    await store.upsertTalents(a, [{id: '1', name: 'Alice', fans: 200, gender: '女'}, {id: '2', name: 'Bob', fans: 30, gender: '男'}]);
    await store.upsertTalents(b, [{id: '1', name: 'Other account'}]);
    const task = await store.createTask(a, {kind: 'invite', total: 2});
    const reservations = await Promise.all([1, 2].map(() => store.reserveInvitation(a, {talentId: '1', taskId: task.id})));
    assert.equal(reservations.filter(item => item.created).length, 1);
    await assert.rejects(store.deleteTalents(a, ['1']), /停止/);
    assert.equal((await store.listTalents(a, {filters: {gender: 'female', minFans: 100}})).length, 1);
    assert.deepEqual(await store.listTalentIds(a, {invitationStatus: 'uninvited'}), ['2']);
    const recovery = await store.recover(a);
    assert.deepEqual(recovery, {tasks: 1, invitations: 1});
    assert.equal((await store.listInvitations(a))[0].status, 'review');
    await store.resolveReview(a, '1', 'success');
    assert.equal((await store.listInvitations(a))[0].manuallyVerified, true);
    await store.deleteTalents(a, ['1']);
    assert.equal((await store.listInvitations(a)).length, 1);
    assert.equal((await store.getTalent(b, '1')).name, 'Other account');
    const config = {products: '123', message: 'Hi', phone: '12345678', wechat: '', interval: 5000, maxInvites: null};
    await store.saveConfig(a, config);
    assert.deepEqual(await store.getConfig(a), config);
    assert.equal(await store.getConfig(b), null);
  } finally { store.close(); }
});

test('global 10000 talent cap aborts the complete extra batch, not partial writes', async () => {
  const store = await openInviteStore();
  try {
    const a = scope('capacity');
    // Two talents remain from the preceding scope-isolation test.
    for (let page = 0; page < 9; page++) await store.upsertTalents(a, Array.from({length: 1000}, (_, index) => ({id: `c${page * 1000 + index}`})));
    await store.upsertTalents(a, Array.from({length: 998}, (_, index) => ({id: `tail${index}`})));
    await assert.rejects(store.upsertTalents(a, [{id: 'extra'}, {id: 'extra2'}]), /10000/);
    assert.equal(await store.getTalent(a, 'extra'), null);
    assert.equal(await store.getTalent(a, 'extra2'), null);
    await store.upsertTalents(a, [{id: 'c0', name: 'updated at capacity'}]);
    assert.equal((await store.getTalent(a, 'c0')).name, 'updated at capacity');
  } finally { store.close(); }
});
