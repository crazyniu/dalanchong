import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:['src/invitation-ui/store.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const store=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const input=id=>({sessionId:'session-'+id,platform:'douyin',accountId:id,observation:{account:{shopId:id,shopName:'name-'+id,status:'online'},readiness:true}});
test('workspace only binds observed account and clears drafts on identity transition',()=>{
 store.updateInvitationWorkspace(input('a'));store.useCommerce.getState().saveConfig('a',{...store.defaults,message:'a draft'});assert.equal(store.useCommerce.getState().configs.a.message,'a draft');
 store.updateInvitationWorkspace(input('b'));assert.deepEqual(store.useCommerce.getState().configs,{});assert.equal(store.useCommerce.getState().accounts[0].id,'b');
 store.updateInvitationWorkspace({...input('b'),observation:input('a').observation});assert.deepEqual(store.useCommerce.getState().accounts,[]);
});
test('late config response cannot restore previous account data',async()=>{
 store.updateInvitationWorkspace(input('a'));let done;globalThis.chrome={runtime:{sendMessage:()=>new Promise(resolve=>done=resolve)}};
 const pending=store.loadInvitationConfig();store.updateInvitationWorkspace(input('b'));done({ok:true,config:{...store.defaults,message:'a'}});await assert.rejects(pending,/账号已改变/);assert.deepEqual(store.useCommerce.getState().configs,{});
});
test('late persistent config never overwrites a draft edited while loading',async()=>{
 store.clearInvitationWorkspace();store.updateInvitationWorkspace(input('a'));let done;globalThis.chrome={runtime:{sendMessage:()=>new Promise(resolve=>done=resolve)}};
 const pending=store.loadInvitationConfig();store.useCommerce.getState().saveConfig('a',{...store.defaults,message:'new draft'});done({ok:true,config:{...store.defaults,message:'old'}});await pending;assert.equal(store.useCommerce.getState().configs.a.message,'new draft');
 store.updateInvitationWorkspace({...input('a'),sessionId:'new-session'});assert.equal(store.useCommerce.getState().configs.a.message,'new draft');
});
test('unchanged polling does not invalidate large lists and completed task renders done',async()=>{
 store.clearInvitationWorkspace();store.updateInvitationWorkspace(input('a'));
 const task={id:'t',platform:'douyin',platformAccountId:'a',kind:'collect',status:'completed',processed:10000,success:10000};
 globalThis.chrome={runtime:{sendMessage:async m=>m.type==='INVITE_LOGS'?{ok:true,rows:[]}:{ok:true,license:{valid:true},tasks:[task]}}};
 await store.refreshInvitationWorkspace();const revision=store.useCommerce.getState().dataRevision;
 await store.refreshInvitationWorkspace();assert.equal(store.useCommerce.getState().dataRevision,revision);assert.equal(store.useCommerce.getState().tasks['a:collect'].status,'done');
});
