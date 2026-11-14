import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/invitation-ui/workspace-memory.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {workspaceMemoryKey:key,sanitizedWorkspaceMemory:sanitize}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
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
