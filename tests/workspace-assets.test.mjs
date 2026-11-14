import test from 'node:test';
import assert from 'node:assert/strict';
import {assertInvitationAssets} from '../browser-extension/workspace-assets.js';
import {bindWorkspaceNavigation} from '../browser-extension/workspace-nav.js';
const message = /邀约工作区尚未构建.*pnpm install --frozen-lockfile.*pnpm build:ui.*重新加载插件/;
globalThis.chrome = {runtime:{getURL:path=>'chrome-extension://test/'+path}};
test('workspace check reads only the packaged local script', async()=>{
  const urls=[];
  await assertInvitationAssets(async url=>{urls.push(url);return {ok:true,text:async()=> ' // bundled workspace\n'};});
  assert.deepEqual(urls,['chrome-extension://test/invitation-ui.js']);
});
test('missing, failed and empty workspace all give actionable build diagnostic',async()=>{
  for(const fetchImpl of [async()=>{throw Error('missing');},async()=>({ok:false}),async()=>({ok:true,text:async()=>''}),async()=>({ok:true,text:async()=> ' \n'}),async()=>({ok:true,text:async()=>{throw Error('read failed');}})]) {
    await assert.rejects(assertInvitationAssets(fetchImpl),message);
  }
});
test('unbuilt workspace blocks navigation after authorization and restores button',async()=>{
 const calls=[];let error='';const button={dataset:{invitationPlatform:'kuaishou'},disabled:false,addEventListener(t,fn){this.click=fn;}};
 bindWorkspaceNavigation({querySelectorAll:()=>[button]},{runtime:{sendMessage:async()=>{calls.push('license');return {ok:true,license:{valid:true}};}},fetchImpl:async()=>{calls.push('local asset');return {ok:false};},tabs:{query:async()=>{calls.push('navigate');return[];}},onError:e=>error=e});
 await button.click();assert.deepEqual(calls,['license','local asset']);assert.match(error,message);assert.equal(button.disabled,false);
});
test('unlicensed workspace never probes assets or opens a platform',async()=>{
 const button={dataset:{invitationPlatform:'douyin'},addEventListener(t,fn){this.click=fn;}};let fetched=false;
 bindWorkspaceNavigation({querySelectorAll:()=>[button]},{runtime:{sendMessage:async()=>({ok:true,license:{valid:false}})},fetchImpl:async()=>{fetched=true;},tabs:{query:async()=>{throw Error('must not open');}}});
 await button.click();assert.equal(fetched,false);
});
