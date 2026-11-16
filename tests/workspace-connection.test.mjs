import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createWorkspaceConnections} from '../browser-extension/invitation/background/workspace-connection.js';
function harness(initialize=async()=>{}) {
 let connect; const expired=[];
 const runtime={id:'test',getURL:path=>'chrome-extension://test/'+path,onConnect:{addListener:fn=>connect=fn}};
 const manager=createWorkspaceConnections({runtime,initialize,verify(){},onExpire:owner=>expired.push(owner)});
 function port(documentId='doc') {
  let close;const p={name:'invitation-workspace',sender:{id:'test',documentId,frameId:2,url:'chrome-extension://test/invitation-workspace.html?embedded=1',tab:{id:9,url:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square'}},messages:[],onDisconnect:{addListener:fn=>close=fn},postMessage(value){this.messages.push(value)},disconnect(){close?.()}};
  connect(p);return p;
 }
 return {manager,port,expired,surface:{kind:'embedded',owner:'9:doc',tabId:9,source:{platform:'douyin'}}};
}
test('port handshake cannot become ready after disconnect during license initialization',async()=>{
 let release;const h=harness(()=>new Promise(r=>release=r)),p=h.port();p.disconnect();release();await new Promise(setImmediate);
 assert.deepEqual(p.messages,[]);assert.throws(()=>h.manager.capture(h.surface),/失效/);
});
test('reconnect does not revive old document token; revocation expires live ports',async()=>{
 const h=harness(),first=h.port();await new Promise(setImmediate);const token=h.manager.capture(h.surface);token();
 first.disconnect();assert.throws(token,/关闭/);
 h.port();await new Promise(setImmediate);h.manager.capture(h.surface)();assert.throws(token,/关闭/);
 h.manager.closeAll();assert.throws(()=>h.manager.capture(h.surface),/失效/);assert.equal(h.expired.length,2);
});
const source=await readFile(new URL('../browser-extension/invitation/background/invite-background.js',import.meta.url),'utf8');
test('delayed collection cannot outlive its iframe connection',async()=>{
  const h=harness(),p=h.port();await new Promise(setImmediate);let release,operations=0;
  const context=vm.createContext({workspaceConnections:h.manager,toolbarGenerations:new Map(),initialize:()=>new Promise(r=>release=r),licenseEpoch:()=>0,requireLicense(){},sessions:new Map(),preparationFailures:new Map(),preparations:new Map(),handle(){operations++;}});
  vm.runInContext(source.slice(source.indexOf('async function toolbar('),source.indexOf('function discardTab(')),context);
  const result=context.toolbar({type:'INVITE_TOOLBAR_COLLECT'},h.surface);p.disconnect();release();
  await assert.rejects(result,/关闭/);assert.equal(operations,0);
});
test('route generation captured before initialize rejects queued collection after route change',async()=>{
 const h=harness();h.port();await new Promise(setImmediate);let release;
 const generations=new Map();const context=vm.createContext({workspaceConnections:h.manager,toolbarGenerations:generations,initialize:()=>new Promise(r=>release=r)});
 vm.runInContext(source.slice(source.indexOf('async function toolbar('),source.indexOf('function discardTab(')),context);
 const result=context.toolbar({type:'INVITE_TOOLBAR_COLLECT'},h.surface);generations.set(9,1);release();await assert.rejects(result,/已改变/);
});
test('non-workspace or top-frame connections never acquire authority',async()=>{
 let connect;const manager=createWorkspaceConnections({runtime:{id:'test',getURL:p=>'chrome-extension://test/'+p,onConnect:{addListener:f=>connect=f}},initialize:async()=>{},verify(){}});
 for(const sender of [
 {id:'test',documentId:'a',frameId:0,url:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square',tab:{id:9,url:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square'}},
 {id:'test',documentId:'b',frameId:2,url:'chrome-extension://test/invite.html?embedded=1',tab:{id:9,url:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square'}},
 ]) { let disconnected=false;connect({name:'invitation-workspace',sender,disconnect(){disconnected=true}});assert.ok(disconnected);assert.throws(()=>manager.capture({kind:'embedded',owner:`9:${sender.documentId}`}),/失效/); }
});
