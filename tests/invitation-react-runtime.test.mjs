import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:['src/invitation-ui/runtime.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {invitationRuntime:r,bindInvitationSession:bind}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const session={sessionId:'s',accountId:'a',platform:'douyin'};
test('adapter maps worker pages without transferring entire history',async()=>{
 bind(session);globalThis.chrome={runtime:{sendMessage:async msg=>{assert.equal(msg.sessionId,'s');assert.equal(msg.type,'INVITE_QUERY');return {ok:true,data:{total:1234,page:62,rows:Array.from({length:14},(_,i)=>({id:String(1220+i),talentId:String(1220+i),createdAt:'2026-01-01',status:'success'}))}}}}};
 const page=await r.queryData({kind:'records',page:62,pageSize:20});assert.equal(page.total,1234);assert.equal(page.rows.length,14);assert.equal(page.rows[0].accountId,'a');assert.equal(page.rows[0].time,'2026-01-01');assert.equal(page.rows[0].products,'未保存');assert.equal(page.rows[0].message,'未保存');
});
test('adapter rejects caller scope mismatch and late response after rebind',async()=>{
 bind(session);await assert.rejects(r.queryData({kind:'records',accountId:'other'}));
 let done;globalThis.chrome={runtime:{sendMessage:()=>new Promise(resolve=>done=resolve)}};
 const request=r.queryData({kind:'records'});bind({...session,accountId:'other'});done({ok:true,rows:[]});await assert.rejects(request,/账号已改变/);
});
test('selected invitation ids intersect backend historical exclusion; negative review means not-sent',async()=>{
 bind(session);let last;globalThis.chrome={runtime:{sendMessage:async msg=>{last=msg;return {ok:true,ids:['b','c']}}}};
 assert.deepEqual(await r.queryData({kind:'invite_ids',ids:['a','b']}),['b']);assert.equal(last.excludeInvited,true);
 await r.resolveRecord('b',false);assert.equal(last.result,'not-sent');
});
test('delete all talents enumerates current account without applying current filters',async()=>{
 bind(session);const calls=[];globalThis.chrome={runtime:{sendMessage:async msg=>{calls.push(msg);return {ok:true,rows:[{id:'x'}]}}}};
 await r.deleteData({kind:'talents',query:'filter'});assert.equal(calls[0].filters.query,'');assert.deepEqual(calls[1].ids,['x']);assert.equal(calls[1].type,'INVITE_DELETE_TALENTS');
});
test('error log deletion retains ordinary events and sends only scoped failed ids',async()=>{
 bind(session);const calls=[];globalThis.chrome={runtime:{sendMessage:async msg=>{calls.push(msg);return {ok:true,rows:[{id:'error',status:'failed'},{id:'ordinary',status:'running'}]}}}};
 await r.deleteData({kind:'logs'});assert.equal(calls[1].type,'INVITE_DELETE_LOGS');assert.deepEqual(calls[1].ids,['error']);assert.equal(calls[1].sessionId,'s');
});
test('start saves config then sends, and rebind while saving prevents send',async()=>{
 bind(session);const calls=[];globalThis.chrome={runtime:{sendMessage:async msg=>{calls.push(msg);bind({...session,accountId:'changed'});return {ok:true}}}};
 await assert.rejects(r.start('a',{products:'1',message:'x',phone:'',wechat:'',interval:5000,maxInvites:null},['b']),/账号已改变/);assert.deepEqual(calls.map(c=>c.type),['INVITE_CONFIG_SAVE']);
});

test('unselected invitation uses exact current filters plus historical exclusion',async()=>{
 bind(session);let last;globalThis.chrome={runtime:{sendMessage:async msg=>{last=msg;return {ok:true,ids:[]}}}};
 await r.queryData({kind:'invite_ids',query:'match',filters:{status:'success'}});
 assert.equal(last.excludeInvited,true);assert.equal(last.filters.query,'match');
 assert.equal(last.filters.invitationStatus,'success');
});
