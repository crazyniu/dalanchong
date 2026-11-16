import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB, IDBKeyRange} from 'fake-indexeddb';
import {normalizedFilters, matchesTalent} from '../browser-extension/invitation/shared/invite-filter.js';
import {openInviteStore} from '../browser-extension/invitation/background/invite-store.js';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
const talent={id:'1',name:'Alice',source:'达人广场',fans:0};
test('talent statuses distinguish pending from confirmed success without treating failed records as pending',()=>{
 for(const status of ['success','failed','review','skipped','sending']) {
  assert.equal(matchesTalent(talent,normalizedFilters({status:'all'}),{status}),true);
  assert.equal(matchesTalent(talent,normalizedFilters({status:'pending'}),{status}),false);
  assert.equal(matchesTalent(talent,normalizedFilters({status:'success'}),{status}),status==='success');
 }
 assert.equal(matchesTalent(talent,normalizedFilters({status:'success'}),undefined),false);
 assert.equal(matchesTalent(talent,normalizedFilters({status:'pending'})),true);
});
test('source search is inclusive; zero and missing fans differ',()=>{
 assert.equal(matchesTalent(talent,normalizedFilters({query:'广场'})),true);
 assert.equal(matchesTalent(talent,normalizedFilters({query:'同行'})),false);
 assert.equal(matchesTalent(talent,normalizedFilters({ranges:{fans:{min:'0',max:'0'}}})),true);
 assert.equal(matchesTalent({...talent,fans:undefined},normalizedFilters({ranges:{fans:{min:'0',max:''}}})),false);
});
test('source options span account rows independently of current page/filter and remain scope isolated',async()=>{
 const store=await openInviteStore();
 const a={userId:'filter-tests',platform:'douyin',platformAccountId:'a'}, b={...a,platformAccountId:'b'};
 try {
  await store.upsertTalents(a,[{...talent,id:'1'},{...talent,id:'2',source:'同行达人'},{...talent,id:'3',source:'达人广场'},{id:'4',name:'No source'}]);
  await store.upsertTalents(b,[{...talent,id:'1',source:'另一个账号'}]);
  assert.equal((await store.listTalents(a,{limit:1,filters:{query:'同行达人'}})).length,1);
  assert.deepEqual(new Set(await store.listTalentSources(a)),new Set(['达人广场','同行达人']));
  assert.deepEqual(await store.listTalentSources(b),['另一个账号']);
  const task=await store.createTask(a,{kind:'invite',total:1});
  await store.reserveInvitation(a,{talentId:'1',taskId:task.id});
  await store.finishInvitation(a,'1',{taskId:task.id,status:'success'});
  assert.deepEqual(await store.listTalentIds(a,{status:'success'}),['1']);
  assert.deepEqual(await store.listTalentIds(a,{status:'success'},true),[]);
 } finally {store.close();}
});
