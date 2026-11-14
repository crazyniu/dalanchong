import test from 'node:test';import assert from 'node:assert/strict';
import {indexedDB,IDBKeyRange} from 'fake-indexeddb';import {openInviteStore} from '../browser-extension/invitation/background/invite-store.js';
globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
test('selected log deletion is account-scoped and retains running-task protection',async()=>{
 const store=await openInviteStore();const scope=id=>({userId:'p',platform:'douyin',platformAccountId:id});const a=scope('a'),b=scope('b');
 try{const task=await store.createTask(a,{kind:'collect',total:1}),other=await store.createTask(b,{kind:'collect',total:1});
 await store.appendTaskLog(a,task.id,{message:'error',status:'failed'});await store.appendTaskLog(a,task.id,{message:'progress',status:'running'});await store.appendTaskLog(b,other.id,{message:'other',status:'failed'});
 const aRows=await store.listLogs(a),bRows=await store.listLogs(b);const error=aRows.find(row=>row.status==='failed');
 await assert.rejects(store.clearLogs(a,[error.id]),/停止/);await store.recover(a);
 await store.clearLogs(a,[error.id,bRows[0].id]);assert.equal((await store.listLogs(a)).length,1);assert.equal((await store.listLogs(b)).length,1);
 }finally{store.close()}
});
