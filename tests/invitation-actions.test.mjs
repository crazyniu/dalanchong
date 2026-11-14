import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {readFile} from 'node:fs/promises';
const built=await build({entryPoints:['src/invitation-ui/action-guard.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {workspaceActionGuard}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('one operation guard rejects account change and unmount between async phases',async()=>{
 let current={active:true,key:'principal:platform:account-a'};const check=workspaceActionGuard(()=>current);check();await Promise.resolve();current={active:true,key:'principal:platform:account-b'};assert.throws(check,/工作区已改变/);
 const mountedCheck=workspaceActionGuard(()=>current);current={...current,active:false};assert.throws(mountedCheck,/工作区已改变/);
});
test('pending return cannot replace a running collection stop control',async()=>{
 const source=await readFile('src/invitation-ui/entry.tsx','utf8');assert.match(source,/pendingInvite:!status.collecting&&\(pending\|\|memory.composeWasOpen\)/);
});
