import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../browser-extension/invite.js', import.meta.url), 'utf8');
const fieldNames = ['products','message','phone','wechat','interval','limit'];
function harness() {
  const nodes = new Map(fieldNames.map(field => [`invite-${field}`, {value:''}]));
  nodes.set('compose-sheet', {close(){this.open=false;},showModal(){this.open=true;},addEventListener(){}}); nodes.set('compose-summary', {textContent:''});
  const saved = {}, calls = [], handlers = {};
  const context = vm.createContext({Map,Set,Object,Array,JSON,Error,fields:fieldNames,platform:'douyin',
    selected:new Set(), selectedRecords:new Set(),sessionId:'session-a',license:{valid:true}, observation:{account:{shopName:'Shop A'}},
    appliedFilters:{talents:{query:'wanted',invitationStatus:'invited'}},
    $:id=>nodes.get(id) || {addEventListener:(event,fn)=>handlers[id]=fn},
    document:{addEventListener(){}},window:{addEventListener(){}},setTimeout,clearTimeout,
    chrome:{storage:{session:{set:async value=>Object.assign(saved,value),get:async key=>({[key]:saved[key]})}}},
    request:async(type,payload)=>{calls.push({type,payload});return {ids:['a','b']};},
    liveLogs:{reset(){}},run:fn=>fn(),showError:error=>{throw error;},renderRows(){},
  });
  vm.runInContext(source.slice(source.indexOf('const drafts = new Map();'), source.indexOf("let platform = 'douyin';")), context);
  vm.runInContext(`function applyPlatformFields(){const d=draftScope ? drafts.get(draftScope)||emptyDraft() : emptyDraft(); for(const field of fields) $('invite-'+field).value=d[field];}`,context);
  return {context,nodes,saved,calls,handlers,run:code=>vm.runInContext(code,context)};
}
test('configuration drafts are isolated by verified account scope and restored from session memory only',async()=>{
 const h=harness();h.run(`switchDraftScope('owner/douyin/a')`);await new Promise(setImmediate);
 h.nodes.get('invite-phone').value='account-a'; h.run('rememberDraft()');
 h.run(`switchDraftScope('owner/douyin/b')`);await new Promise(setImmediate);
 assert.equal(h.nodes.get('invite-phone').value,'');
 h.nodes.get('invite-phone').value='account-b';h.run('rememberDraft()');
 h.run(`switchDraftScope('owner/douyin/a')`);await new Promise(setImmediate);
 assert.equal(h.nodes.get('invite-phone').value,'account-a');
 await h.run('persistWorkspace()');
 assert.equal(h.saved['invite-workspace:owner/douyin/a'].draft.phone,'account-a');
 assert.doesNotMatch(source,/storage\.local/);
 const fresh=harness();fresh.saved['invite-workspace:owner/douyin/a']=h.saved['invite-workspace:owner/douyin/a'];
 fresh.run(`switchDraftScope('other-owner/douyin/a')`);await new Promise(setImmediate);
 assert.equal(fresh.nodes.get('invite-phone').value,'');
 fresh.run(`switchDraftScope('owner/douyin/a')`);await new Promise(setImmediate);
 assert.equal(fresh.nodes.get('invite-phone').value,'account-a');
});
test('eligibility excludes history for selected IDs without dropping off-filter choices',async()=>{
 const h=harness();h.run(`switchDraftScope('scope-a');selected.add('b');selected.add('already-invited');`);
 assert.deepEqual(Array.from(await h.run('eligibleIds()')),['b']);
 assert.equal(h.calls[0].payload.excludeInvited,true); assert.deepEqual(Object.keys(h.calls[0].payload.filters),[]);
 h.run('selected.clear()');await h.run('eligibleIds()');
 assert.equal(h.calls[1].payload.filters.invitationStatus,'invited');
});
test('opening compose computes eligibility and resets limit without sending',async()=>{
 const h=harness();h.run(`switchDraftScope('scope-a')`);await new Promise(setImmediate);
 h.nodes.get('invite-limit').value='15';
 const start=source.indexOf('async function openCompose(');const end=source.indexOf("$('close-compose').addEventListener",start);
 h.run(source.slice(start,end));await h.handlers['open-compose']();
 assert.equal(h.nodes.get('invite-limit').value,'');
 assert.match(h.nodes.get('compose-summary').textContent,/可邀约 2 人/);
 assert.ok(h.calls.every(call=>call.type==='INVITE_TALENT_IDS'));
});

function composeHarness() {
 const h = harness();
 const start = source.indexOf('async function openCompose(');
 const end = source.indexOf("$('refresh-sources').addEventListener", start);
 h.run(source.slice(start, end));
 return h;
}
test('resume only restores the same account Sheet and recomputes eligibility without sending', async () => {
 const h = composeHarness(); h.run("switchDraftScope('owner/douyin/a')"); await new Promise(setImmediate);
 await h.run('openCompose()'); h.nodes.get('invite-limit').value = '12'; await h.run('persistWorkspace()');
 assert.equal(h.saved['invite-workspace:owner/douyin/a'].composeWasOpen, true);
 const fresh = composeHarness(); Object.assign(fresh.saved, h.saved);
 fresh.run("switchDraftScope('owner/douyin/b')"); await fresh.run('openCompose({resume:true})');
 assert.notEqual(fresh.nodes.get('compose-sheet').open, true); assert.equal(fresh.calls.length, 0);
 fresh.run("switchDraftScope('owner/douyin/a')"); await fresh.run('openCompose({resume:true})');
 assert.equal(fresh.nodes.get('compose-sheet').open, true); assert.equal(fresh.nodes.get('invite-limit').value, '12');
 assert.deepEqual(fresh.calls.map(c=>c.type), ['INVITE_TALENT_IDS']);
 fresh.run('closeCompose()'); await new Promise(setImmediate);
 assert.equal(fresh.saved['invite-workspace:owner/douyin/a'].composeWasOpen, false);
 await fresh.run('openCompose({resume:true})'); assert.equal(fresh.calls.length, 1);
});
test('zero eligible talents never opens a Sheet and clears pending resume', async () => {
 const h = composeHarness(); h.run("switchDraftScope('scope-a')"); await new Promise(setImmediate);
 h.context.request = async()=>({ids:[]});
 await assert.rejects(h.run('openCompose()'), /没有可邀约/);
 assert.notEqual(h.nodes.get('compose-sheet').open, true);
 await h.run('persistWorkspace()'); assert.equal(h.saved['invite-workspace:scope-a'].composeWasOpen, false);
});
