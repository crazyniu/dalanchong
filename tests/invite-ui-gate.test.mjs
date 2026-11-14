import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
const read = path => readFile(new URL('../'+path,import.meta.url),'utf8');
test('retired invitation entry has no business UI or public iframe access',async()=>{
 const html=await read('browser-extension/invite.html');
 assert.match(html,/url=manager.html/);assert.doesNotMatch(html,/<script|<form|invite\.css/);
 const manifest=JSON.parse(await read('browser-extension/manifest.json'));
 assert.ok(!manifest.web_accessible_resources.some(row=>row.resources.includes('invite.html')));
 for(const file of ['invite.js','invite.css','invite-toolbar.js'])await assert.rejects(access(new URL('../browser-extension/'+file,import.meta.url)));
});
test('React workspace requires trusted embedded context and clears identity on authorization errors',async()=>{
 const entry=await read('src/invitation-ui/entry.tsx');
 assert.match(entry,/window===window\.top/);assert.match(entry,/searchParams\.get\('embedded'\)!=='1'/);
 assert.match(entry,/await request\('INVITE_HOST_CONTEXT'\)/);
 assert.match(entry,/!auth\.license\?\.valid\|\|!auth\.license\?\.principalId/);
 assert.match(entry,/clearInvitationWorkspace\(\);setAccountId\(''\);setPrincipalId\(''\)/);
 assert.doesNotMatch(entry,/INVITE_ACTIVATE|INVITE_VERIFY/);
});
test('React filter changes preserve selection and opening compose resets only its limit',async()=>{
 const list=await read('src/invitation-ui/collection-list.tsx');
 for(const action of ['setQuery(v)','setFilters(next)']) {
  const start=list.indexOf(action),block=list.slice(start,list.indexOf('}}',start));
  assert.match(block,/setPage\(1\)/);assert.doesNotMatch(block,/onSelect|setSelected/);
 }
 const entry=await read('src/invitation-ui/entry.tsx');
 const open=entry.slice(entry.indexOf('const openInvite='),entry.indexOf('return <>',entry.indexOf('const openInvite=')));
 assert.match(open,/maxInvites:null/);assert.doesNotMatch(open,/INVITE_SEND|\.start\(/);
});
