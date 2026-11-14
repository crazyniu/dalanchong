import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile} from 'node:fs/promises';
const built=await build({entryPoints:['src/invitation-ui/browser-session.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const bridge=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('online invitation configuration does not depend on recapturing a collection list',()=>{
 bridge.updateGuestSession('a',{account:{shopId:'a',status:'online'},readiness:false});assert.equal(bridge.useGuestState.getState().sessions.a.status,'ready');
 bridge.updateGuestSession('a',{account:{shopId:'b',status:'online'},readiness:true});assert.equal(bridge.useGuestState.getState().sessions.a.status,'error');
 bridge.updateGuestSession('a',{account:{shopId:'a',status:'offline'},readiness:true});assert.equal(bridge.useGuestState.getState().sessions.a.status,'error');
});
test('collection control still requires captured list readiness',async()=>{
 const entry=await readFile('src/invitation-ui/entry.tsx','utf8');assert.match(entry,/disabled:!status.collecting&&\(busy\|\|!status.readiness\)/);
});
