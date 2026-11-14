import test from 'node:test';
import assert from 'node:assert/strict';
import {indexedDB, IDBKeyRange} from 'fake-indexeddb';
import {openInviteStore} from '../browser-extension/invitation/background/invite-store.js';
import {createLiveLogFeed} from '../browser-extension/invitation/shared/invite-live-logs.js';
globalThis.indexedDB = indexedDB; globalThis.IDBKeyRange = IDBKeyRange;
test('real persisted logs show newest 200, paginate older events, and never mix accounts', async () => {
 const store = await openInviteStore();
 const scope={userId:'log-order-tests',platform:'douyin',platformAccountId:'a'}, other={...scope,platformAccountId:'b'};
 const realNow=Date.now;
 try {
  const task=await store.createTask(scope,{kind:'collect'}), otherTask=await store.createTask(other,{kind:'collect'});
  const ids=[];let time=1700000000000;
  Date.now=()=>time++;
  for(let index=0;index<205;index++) ids.push((await store.appendTaskLog(scope,task.id,{message:`event-${index}`})).id);
  await store.appendTaskLog(other,otherTask.id,{message:'other account'});
  const first=await store.listLogs(scope,{offset:0,limit:200});
  assert.deepEqual(first.map(row=>row.id),ids.slice(5).reverse());
  assert.deepEqual((await store.listLogs(scope,{offset:200,limit:200})).map(row=>row.id),ids.slice(0,5).reverse());
  assert.deepEqual(await store.listLogs(scope,{offset:205,limit:200}),[]);
  let visible;
  const feed=createLiveLogFeed({read:()=>store.listLogs(scope,{limit:200}),render:rows=>visible=rows,report:assert.fail});
  await feed.refresh('a');
  assert.deepEqual(visible.map(row=>row.id),ids.slice(5));
  const newest=await store.appendTaskLog(scope,task.id,{message:'fresh event'});
  await feed.refresh('a');
  assert.equal(visible.at(-1).id,newest.id);assert.equal(visible.length,200);
  assert.equal(visible[0].id,ids[6]);
  assert.ok(visible.every(row=>row.message!=='other account'));
 } finally {Date.now=realNow;store.close();}
});
