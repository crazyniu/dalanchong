/** Background regressions using actual module functions with local dependencies only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createInviteRuntime} from '../browser-extension/invite-runtime.js';
import {readFile} from 'node:fs/promises';
const source = (await readFile(new URL('../browser-extension/invite-background.js', import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
const defer = () => { let resolve; const promise=new Promise(r=>{resolve=r;}); return {promise,resolve}; };
function setup() {
  let valid=true, epoch=0;
  const tasks=[], stored=[], stops=[];
  const runtime={status:()=>tasks,stop:scope=>stops.push(scope),stopAll(){},recoverScope:async()=>{}};
  const store={listTasks:async scope=>stored.filter(t=>t.platformAccountId===scope.platformAccountId),listTalentIds:async()=>[]};
  const context=vm.createContext({Map,Set,Date,URL,crypto,setTimeout,
    onLicenseChange(){},listenMessages(){},licenseEpoch:()=>epoch,
    requireLicense(expected){if(!valid || expected!==undefined && expected!==epoch) throw Error('inactive');},
    inviteLicense:{status:()=>({valid}),requireValid(){if(!valid)throw Error('inactive');}},
    readObservation:async()=>({account:{status:'online',shopId:'shop'},capture:{list:{}}}),
    chrome:{runtime:{},tabs:{onRemoved:{addListener(){}},onUpdated:{addListener(){}}}},
  });
  vm.runInContext(source+'\nglobalThis.api={state,toolbar,sessions,setRuntime(r,s){runtime=r;store=s;initialized=Promise.resolve();},replaceHandle(fn){handle=fn;}};',context);
  context.api.setRuntime(runtime,store);
  return {api:context.api,context,tasks,stored,stops,runtime,store,setValid(value){valid=value;epoch++;}};
}
const surface={kind:'embedded',owner:'owner',tabId:1,source:{platform:'douyin',origin:'https://buyin.jinritemai.com',path:'/dashboard/servicehall/daren-square'}};
const makeSession=(id,tabId=1,owner='owner')=>({scope:{userId:'profile',platform:'douyin',platformAccountId:id},owners:new Set([owner]),page:{tabId,platform:'douyin'},account:{status:'online',shopId:id}});
test('unactivated status does not return or read persisted business tasks',async()=>{
  const f=setup();f.api.sessions.set('s',makeSession('shop'));f.tasks.push({id:'secret',platform:'douyin',platformAccountId:'shop'});
  f.store.listTasks=async()=>{throw Error('must not read');};f.setValid(false);
  assert.equal((await f.api.state(surface)).tasks.length,0);
});
test('embedded status respects owner, tab and platform-scoped account',async()=>{
  const f=setup();f.api.sessions.set('s',makeSession('shop'));f.api.sessions.set('other',makeSession('other',2));f.api.sessions.set('foreign',makeSession('foreign',1,'foreign-owner'));
  for(const id of ['shop','other','foreign']){f.tasks.push({id,platform:'douyin',platformAccountId:id,updatedAt:'2026-01-01'});f.stored.push({id:'stored-'+id,platformAccountId:id,updatedAt:'2026-01-01'});}
  const result=await f.api.state(surface);assert.deepEqual(Array.from(result.tasks,t=>t.id).sort(),['shop','stored-shop']);
});
test('revocation while status awaits local records discards the result',async()=>{
  const f=setup(),pending=defer();f.api.sessions.set('s',makeSession('shop'));f.store.listTasks=()=>pending.promise;
  const reading=f.api.state(surface);f.setValid(false);pending.resolve([{id:'secret'}]);assert.equal((await reading).tasks.length,0);
});
test('stop while toolbar prepares prevents deferred collection',async()=>{
  const f=setup(),pending=defer(),entered=defer();let collections=0;
  f.api.replaceHandle(async message=>{if(message.type==='INVITE_PREPARE'){entered.resolve();await pending.promise;f.api.sessions.set('s',makeSession('shop'));return{sessionId:'s'};}if(message.type==='INVITE_COLLECT')collections++;});
  const collecting=f.api.toolbar({type:'INVITE_TOOLBAR_COLLECT'},{...surface,kind:'toolbar'});
  await entered.promise;await f.api.toolbar({type:'INVITE_TOOLBAR_STOP'},{...surface,kind:'toolbar'});pending.resolve();
  await assert.rejects(collecting,/停止/);assert.equal(collections,0);
});

test('stop during handler observation reaches the real collection runtime cancellation gate',async()=>{
  const f=setup(),pending=defer(),entered=defer();let reads=0;
  f.api.sessions.set('s',makeSession('shop'));
  f.context.readObservation=async()=>{
    if(++reads===2){entered.resolve();await pending.promise;}
    return{account:{status:'online',shopId:'shop'},capture:{list:{}}};
  };
  f.runtime.startCollection=createInviteRuntime({store:f.store,license:{requireValid(){}}}).startCollection;
  const collecting=f.api.toolbar({type:'INVITE_TOOLBAR_COLLECT'},{...surface,kind:'toolbar'});
  await entered.promise;await f.api.toolbar({type:'INVITE_TOOLBAR_STOP'},{...surface,kind:'toolbar'});pending.resolve();
  await assert.rejects(collecting,/停止/);
});

test('revocation and immediate reactivation still discard old status records',async()=>{
 const f=setup(),pending=defer();f.api.sessions.set('s',makeSession('shop'));
 f.store.listTasks=async()=>{await pending.promise;return [{id:'old'}];};
 const result=f.api.state(surface);f.setValid(false);f.setValid(true);pending.resolve();
 assert.equal((await result).tasks.length,0);
});
