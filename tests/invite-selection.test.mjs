import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {indexedDB, IDBKeyRange} from 'fake-indexeddb';
import {openInviteStore} from '../browser-extension/invite-store.js';
globalThis.indexedDB = indexedDB; globalThis.IDBKeyRange = IDBKeyRange;
test('applying and resetting filters retain selections outside current page/filter', async () => {
  const source = await readFile(new URL('../browser-extension/invite.js', import.meta.url), 'utf8');
  const begin = source.indexOf("$('list-filters').addEventListener('submit'");
  const end = source.indexOf("$('select-filtered').addEventListener", begin);
  const handlers = {}, selected = new Set(['outside-page']), selectedRecords = new Set(['outside-filter']);
  const appliedFilters = {talents: {}, records: {}};
  let refreshes = 0;
  const context = vm.createContext({selected, selectedRecords, appliedFilters, view: 'talents', offset: 100,
    $: id => ({addEventListener: (event, fn) => { handlers[id] = fn; }, reset: () => {}}),
    readFilters: () => ({query: 'different'}), run: fn => fn(), refreshRows: async () => { refreshes++; }});
  vm.runInContext(source.slice(begin, end), context);
  handlers['list-filters']({preventDefault() {}}); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual([...selected], ['outside-page']); assert.deepEqual([...selectedRecords], ['outside-filter']);
  await handlers['reset-filters']();
  assert.deepEqual([...selected], ['outside-page']); assert.deepEqual([...selectedRecords], ['outside-filter']);
  assert.equal(refreshes, 2); assert.equal(context.offset, 0);
  assert.match(source, /filters: selectedIds\.size \? \{\} : appliedFilters\.talents, excludeInvited: true/);
  assert.doesNotMatch(source, /\.\.\.appliedFilters\.talents, invitationStatus: 'uninvited'/);
});
test('invitation eligibility intersects current filters with absence of any account-scoped record', async () => {
  const store = await openInviteStore();
  const scope = {userId: 'selection-tests', platform: 'douyin', platformAccountId: 'a'};
  const other = {...scope, platformAccountId: 'b'};
  try {
    await store.upsertTalents(scope, [{id: '1', name: 'Match sent'}, {id: '2', name: 'Match new'}, {id: '3', name: 'Other'}]);
    await store.upsertTalents(other, [{id: '1', name: 'Match new other account'}]);
    const task = await store.createTask(scope, {kind: 'invite', total: 1});
    await store.reserveInvitation(scope, {talentId: '1', taskId: task.id});
    assert.deepEqual(await store.listTalentIds(scope, {invitationStatus: 'invited'}, true), []);
    assert.deepEqual(await store.listTalentIds(scope, {query: 'Match'}, true), ['2']);
    assert.deepEqual(await store.listTalentIds(scope, {query: 'Match', invitationStatus: 'uninvited'}, true), ['2']);
    assert.deepEqual(await store.listTalentIds(other, {query: 'Match'}, true), ['1']);
    assert.deepEqual(await store.listTalentIds(scope, {invitationStatus: 'invited'}), ['1']);
    assert.equal((await store.listInvitations(scope)).length, 1);
  } finally { store.close(); }
});
