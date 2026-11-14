import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {bindWorkspaceNavigation,verifyWorkspaceLicense} from '../browser-extension/shared/workspace-nav.js';
const read = name => fs.readFileSync(new URL('../browser-extension/'+name,import.meta.url),'utf8');
test('popup contains only More entry; both full pages share four navigation choices',()=>{
 const popup=read('popup.html');assert.match(popup,/id="open-more"[^>]*>更多/);assert.doesNotMatch(popup,/workspace-actions|open-invite-|open-workspace|open-settings/);
 for(const page of ['manager.html','settings.html']){
  const html=read(page);for(const name of ['视频批量下载','抖音邀约','快手邀约','设置'])assert.ok(html.includes(name));
  assert.match(html,/workspace-nav.css/);assert.match(html,/aria-current="page"/);
 }
 assert.match(read('pages/popup/popup.js'),/manager\.html/);assert.match(read('pages/popup/popup.js'),/searchParams.set\('ids'/);
});
test('invalid or malformed authorization blocks platform opening',async()=>{
 await assert.rejects(verifyWorkspaceLicense({sendMessage:async()=>({ok:true,license:{valid:false}})}));
 await assert.rejects(verifyWorkspaceLicense({sendMessage:async()=>({license:{valid:true}})}));
 let opens=0,error='';const button={dataset:{invitationPlatform:'douyin'},disabled:false,addEventListener(t,fn){this.click=fn;}};
 bindWorkspaceNavigation({querySelectorAll:()=>[button]},{runtime:{sendMessage:async()=>({ok:true,license:{valid:false}})},tabs:{query:async()=>{opens++;return[];}},onError:e=>error=e});
 await button.click();assert.equal(opens,0);assert.ok(error);assert.equal(button.disabled,false);
});
test('licensed invitation navigation focuses existing source without starting jobs',async()=>{
 globalThis.chrome={runtime:{getURL:path=>'chrome-extension://test/'+path}};
 const messages=[],calls=[];const button={dataset:{invitationPlatform:'douyin'},disabled:false,addEventListener(t,fn){this.click=fn;}};
 bindWorkspaceNavigation({querySelectorAll:()=>[button]},{fetchImpl:async()=>({ok:true,text:async()=> '// workspace'}),runtime:{sendMessage:async m=>{messages.push(m.type);return{ok:true,license:{valid:true}};}},tabs:{query:async()=>[{id:4,windowId:2,url:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square'}],update:async id=>calls.push(id)},windows:{update:async id=>calls.push(id)}});
 await button.click();assert.deepEqual(calls,[4,2]);assert.ok(messages.every(t=>t==='LICENSE_STATUS'));assert.equal(button.disabled,false);
});
