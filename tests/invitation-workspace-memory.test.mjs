import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/invitation-ui/workspace-memory.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {workspaceMemoryKey:key,sanitizedWorkspaceMemory:sanitize,createWorkspaceMemoryController:create}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
test('temporary memory keys separate principal, platform and account',()=>{
 const base={principalId:'one',platform:'douyin',accountId:'shop'};
 assert.notEqual(key(base),key({...base,principalId:'two'}));assert.notEqual(key(base),key({...base,platform:'kuaishou'}));assert.notEqual(key(base),key({...base,accountId:'other'}));
});
test('stored selections are bounded and drafts contain only declared fields',()=>{
 assert.equal(sanitize({selected:['a'],inviteIds:['b'],composeOpen:'yes'}),null);
 assert.equal(sanitize({selected:Array(10001).fill('a'),inviteIds:[],composeOpen:false}),null);
 const value=sanitize({selected:['a','a'],inviteIds:['b'],composeOpen:true,config:{products:'1',message:'hello',phone:'',wechat:'',interval:5000,maxInvites:null,token:'never'}});
 assert.deepEqual(value.selected,['a']);assert.equal(value.config.token,undefined);assert.equal(value.composeOpen,true);
});
const scope=(principalId='p',accountId='a')=>({principalId,platform:'douyin',accountId});
const draft=message=>({selected:['old'],inviteIds:['old'],composeOpen:true,config:{products:'1',message,phone:'',wechat:'',interval:5000,maxInvites:null}});
function fixture(){const reads=[],writes=[],configs=[],changes=[];const control=create({get:k=>new Promise(resolve=>reads.push({k,resolve})),set:async data=>writes.push(data)},()=>changes.push(1),(id,config)=>configs.push({id,config}));return {control,reads,writes,configs,changes}}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('readiness is false during new-key render before its bind effect',async()=>{
 const f=fixture(),a=scope(),b=scope('p','b');f.control.bind(a);f.reads[0].resolve({[key(a)]:draft('A')});await tick();assert.equal(f.control.view(key(a)).ready,true);
 // React renders account B before cleanup/effect. It must not see A readiness.
 assert.equal(f.control.view(key(b)).ready,false);assert.deepEqual(f.control.view(key(b)).value.selected,[]);
 f.control.bind(b);assert.equal(f.control.view(key(b)).ready,false);f.reads[1].resolve({[key(b)]:draft('B')});await tick();assert.equal(f.control.view(key(b)).ready,true);assert.equal(f.control.view(key(b)).value.config.message,'B');
});
test('principal transition discards late hydration and never applies another account draft',async()=>{
 const f=fixture(),a=scope('one'),b=scope('two');f.control.bind(a);f.control.bind(b);f.reads[0].resolve({[key(a)]:draft('private A')});await tick();assert.equal(f.configs.length,0);assert.equal(f.control.view(key(b)).ready,false);
 f.reads[1].resolve({[key(b)]:draft('B')});await tick();assert.equal(f.configs.length,1);assert.equal(f.configs[0].config.message,'B');
});
test('edits during restore win per field while untouched fields hydrate and save',async()=>{
 const f=fixture(),a=scope();f.control.bind(a);const edited={...draft('edited').config};f.control.edit(key(a),'config',edited);f.control.edit(key(a),'selected',['new']);f.reads[0].resolve({[key(a)]:draft('old')});await tick();await f.control.flushed();
 const result=f.control.view(key(a));assert.equal(result.value.config.message,'edited');assert.deepEqual(result.value.selected,['new']);assert.deepEqual(result.value.inviteIds,['old']);assert.equal(f.writes.at(-1)[key(a)].config.message,'edited');
});
test('unmount suppresses callbacks but persists edits to only its original scoped key',async()=>{
 const f=fixture(),a=scope();f.control.bind(a);f.control.edit(key(a),'selected',['new']);f.control.dispose();const changes=f.changes.length;f.reads[0].resolve({[key(a)]:draft('old')});await tick();await f.control.flushed();
 assert.equal(f.changes.length,changes);assert.equal(f.configs.length,0);assert.equal(f.control.view(key(a)).ready,false);assert.deepEqual(f.writes.at(-1)[key(a)].selected,['new']);assert.equal(f.writes.at(-1)[key(a)].config.message,'old');
});
test('same-key remount reuses hydration; superseded reads cannot overwrite newer saved edits',async()=>{
 const f=fixture(),a=scope(),b=scope('p','b');f.control.bind(a);f.control.edit(key(a),'selected',['stale']);f.control.dispose();f.control.bind(a);assert.equal(f.reads.length,1);
 f.control.bind(b);f.control.bind(a);f.reads[2].resolve({[key(a)]:draft('latest')});await tick();f.control.edit(key(a),'selected',['latest']);await f.control.flushed();
 f.reads[0].resolve({[key(a)]:draft('old')});await tick();await f.control.flushed();assert.deepEqual(f.writes.at(-1)[key(a)].selected,['latest']);
});
