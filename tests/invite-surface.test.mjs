import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationSurface, selectedExport} from '../browser-extension/invitation/shared/invite-surface.js';
const id='a'.repeat(32), root=`chrome-extension://${id}/`;
const runtime={id,getURL:p=>root+p};
const source='https://buyin.jinritemai.com/dashboard/servicehall/daren-square';
const sender={id,documentId:'doc',frameId:1,url:root+'invitation-workspace.html?embedded=1',tab:{id:4,url:source}};
test('embedded UI authority derives from Chrome source tab, not query tab IDs',()=>{
 assert.equal(invitationSurface({...sender,url:sender.url+'&tabId=99'},runtime).tabId,4);
 for(const change of [{id:'bad'},{documentId:undefined},{frameId:0},{tab:{id:4,url:'https://evil.invalid/'}},{url:'https://evil.invalid/invite.html?embedded=1'}]) assert.equal(invitationSurface({...sender,...change},runtime),null);
});
test('only top-frame supported source is a toolbar surface',()=>{
 const top={...sender,url:source,frameId:0};
 assert.equal(invitationSurface(top,runtime).kind,'toolbar');
 assert.equal(invitationSurface({...top,frameId:2},runtime),null);
 assert.equal(invitationSurface({...top,url:source+'?other=1'},runtime),null);
});
test('standalone UI cannot be embedded in an unrelated site',()=>{
 assert.equal(invitationSurface({...sender,url:root+'invitation-workspace.html'},runtime),null);
 assert.equal(invitationSurface({...sender,url:root+'invitation-workspace.html',tab:{id:9,url:root+'invitation-workspace.html'}},runtime),null);
});
test('selected export returns selected rows only and does not add foreign IDs',()=>{
 assert.deepEqual(selectedExport([{id:'1'},{id:'2'}],['2','foreign'],false),[{id:'2'}]);
 assert.deepEqual(selectedExport([{id:'r1',talentId:'1'},{id:'r2',talentId:'2'}],['r2'],true),[{id:'r2',talentId:'2'}]);
 assert.throws(()=>selectedExport([],Array(10001).fill('1'),false));
});
test('React workspace is restricted to authenticated extension subframes on supported source tabs',()=>{
 const embedded={...sender,url:root+'invitation-workspace.html?embedded=1'};
 assert.equal(invitationSurface(embedded,runtime).kind,'embedded');
 for(const change of [{frameId:0},{url:root+'invitation-workspace.html'},{tab:{id:4,url:'https://evil.invalid/'}},{id:'other'}]) assert.equal(invitationSurface({...embedded,...change},runtime),null);
});

test('retired invite.html has no embedded authority even on a valid platform',()=>{
 assert.equal(invitationSurface({...sender,url:root+'invite.html?embedded=1'},runtime),null);
});
