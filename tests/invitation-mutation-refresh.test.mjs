import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({stdin:{contents:"export * from './src/invitation-ui/store';export {invitationRuntime} from './src/invitation-ui/runtime';",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'esm',platform:'browser'});
const {invitationRuntime:runtime,useCommerce,updateInvitationWorkspace,clearInvitationWorkspace}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
function bind(id='a'){clearInvitationWorkspace();updateInvitationWorkspace({sessionId:'s-'+id,platform:'douyin',accountId:id,observation:{account:{shopId:id,status:'online'},readiness:true}})}
const revision=()=>useCommerce.getState().dataRevision;
test('direct component deletion invalidates same-page data without task changes',async()=>{
 bind();globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,deleted:1})}};const before=revision();
 await runtime.deleteData({kind:'talents',ids:['1']});assert.equal(revision(),before+1);
 await runtime.deleteData({kind:'records',ids:['1']});assert.equal(revision(),before+2);
});
test('each committed batch and uncertain failure triggers current-account refresh',async()=>{
 bind();let batches=0;globalThis.chrome={runtime:{sendMessage:async()=>++batches===1?{ok:true,deleted:10000}:{ok:false,error:'failed'}}};const before=revision();
 await assert.rejects(runtime.deleteData({kind:'records',ids:Array.from({length:10001},(_,i)=>String(i))}),/10000/);
 assert.equal(revision(),before+2);
});
test('late old-account deletion response cannot invalidate new account',async()=>{
 bind();let resolve;globalThis.chrome={runtime:{sendMessage:()=>new Promise(done=>resolve=done)}};
 const pending=runtime.deleteData({kind:'records',ids:['1']});bind('b');const before=revision();resolve({ok:true,deleted:1});await assert.rejects(pending,/账号已改变/);assert.equal(revision(),before);
});
test('store review and deletion wrappers invalidate once, not twice',async()=>{
 bind();globalThis.chrome={runtime:{sendMessage:async()=>({ok:true,deleted:1,record:{}})}};const before=revision();
 await useCommerce.getState().resolveRecord('1',true);assert.equal(revision(),before+1);
 await useCommerce.getState().clearRecords(['1']);assert.equal(revision(),before+2);
});
