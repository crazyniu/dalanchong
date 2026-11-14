import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB, IDBKeyRange} from 'fake-indexeddb';
import {normalizedFilters, matchesTalent} from '../browser-extension/invitation/shared/invite-filter.js';
import {openInviteStore} from '../browser-extension/invitation/background/invite-store.js';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
const talent={id:'1',name:'Alice',source:'达人广场',fans:0};
test('talent statuses distinguish no record, success, failures, uncertain and legacy presence',()=>{
 for(const status of ['success','failed','review','skipped','sending']) {
  assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:status}),{status}),true);
  assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:status}),undefined),false);
  assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:'pending'}),{status}),false);
  assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:'invited'}),{status}),true);
  assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:'uninvited'}),{status}),false);
 }
 assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:'success'}),{status:'failed'}),false);
 assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:'pending'})),true);
 assert.equal(matchesTalent(talent,normalizedFilters({invitationStatus:'uninvited'})),true);
});
test('source search is inclusive but source selector matches exactly; zero and missing fans differ',()=>{
 assert.equal(matchesTalent(talent,normalizedFilters({query:'广场'})),true);
 assert.equal(matchesTalent(talent,normalizedFilters({source:'广场'})),false);
 assert.equal(matchesTalent(talent,normalizedFilters({source:'达人广场'})),true);
 assert.equal(matchesTalent(talent,normalizedFilters({minFans:0,maxFans:0})),true);
 assert.equal(matchesTalent({...talent,fans:undefined},normalizedFilters({minFans:0})),false);
});
test('source options span account rows independently of current page/filter and remain scope isolated',async()=>{
 const store=await openInviteStore();
 const a={userId:'filter-tests',platform:'douyin',platformAccountId:'a'}, b={...a,platformAccountId:'b'};
 try {
  await store.upsertTalents(a,[{...talent,id:'1'},{...talent,id:'2',source:'同行达人'},{...talent,id:'3',source:'达人广场'},{id:'4',name:'No source'}]);
  await store.upsertTalents(b,[{...talent,id:'1',source:'另一个账号'}]);
  assert.equal((await store.listTalents(a,{limit:1,filters:{source:'同行达人'}})).length,1);
  assert.deepEqual(new Set(await store.listTalentSources(a)),new Set(['达人广场','同行达人']));
  assert.deepEqual(await store.listTalentSources(b),['另一个账号']);
  const task=await store.createTask(a,{kind:'invite',total:1});
  await store.reserveInvitation(a,{talentId:'1',taskId:task.id});
  await store.finishInvitation(a,'1',{taskId:task.id,status:'success'});
  assert.deepEqual(await store.listTalentIds(a,{invitationStatus:'success'}),['1']);
  assert.deepEqual(await store.listTalentIds(a,{invitationStatus:'success'},true),[]);
 } finally {store.close();}
});
