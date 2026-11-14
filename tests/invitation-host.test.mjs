import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const code=await readFile(new URL('../browser-extension/invitation-host.js',import.meta.url),'utf8');
function harness({licensed=true,child=false,pathname}={}) {
 const listeners={},cleanups=[],frames=[];let tick,observer;
 const location={origin:'https://buyin.jinritemai.com',pathname:'/dashboard/servicehall/daren-square',href:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square'};
 if(pathname){location.pathname=pathname;location.href=location.origin+pathname;}
 const scope={active:true,listen(_target,name,fn){listeners[name]=fn;},cleanup(fn){cleanups.push(fn);},setInterval(fn){tick=fn;},stop(){this.active=false;cleanups.forEach(fn=>fn());},MutationObserver:class{constructor(fn){observer=fn;}observe(){}}};
 const window={};window.top=child?{}:window;
 const context=vm.createContext({window,location,innerWidth:1000,innerHeight:800,chrome:{runtime:{getURL:path=>'chrome-extension://test/'+path.replace(/^\//,'')}},__dlcFeatureGate:{begin:()=>licensed?scope:null},document:{documentElement:{append(f){f.isConnected=true;frames.push(f);}},createElement(){return {style:{setProperty(key,v){this[key]=v;}},contentWindow:{},isConnected:false,remove(){this.isConnected=false;}};}}});
 vm.runInContext(code,context);
 return {frames,scope,location,tick:()=>tick(),observer:()=>observer(),send(data,overrides={}){listeners.message({source:frames.at(-1)?.contentWindow,origin:'chrome-extension://test',data,...overrides});},resize:()=>listeners.resize()};
}
test('layout accepts only the owned extension frame and clamps bounded regions',()=>{
 const h=harness(),frame=h.frames[0];const data={type:'INVITATION_LAYOUT',modal:false,rects:[{x:-4,y:4,width:24,height:30}]};
 h.send(data,{origin:'https://evil.test'});assert.equal(frame.style['clip-path'],undefined);
 h.send(data,{source:{}});assert.equal(frame.style['clip-path'],undefined);
 h.send(data);assert.equal(frame.style['clip-path'],"path('M0 4H20V34H0Z')");
 h.send({...data,modal:true,rects:[{x:NaN,y:0,width:1,height:1}]});assert.equal(frame.style['clip-path'],"path('M0 4H20V34H0Z')");
 h.send({...data,modal:true,rects:[]});assert.equal(frame.style['clip-path'],'inset(0)');
 h.resize();assert.equal(frame.style['clip-path'],'inset(100%)');
});
test('SPA routes remove/recreate the isolated frame; external removal stops its lifecycle',()=>{
 const h=harness(),first=h.frames[0];h.location.href+='?tab=2';h.tick();assert.equal(first.isConnected,false);assert.equal(h.frames.length,2);
 h.location.pathname='/unsupported';h.location.href='https://buyin.jinritemai.com/unsupported';h.tick();assert.equal(h.frames.at(-1).isConnected,false);
 h.location.pathname='/dashboard/servicehall/daren-square';h.location.href='https://buyin.jinritemai.com/dashboard/servicehall/daren-square';h.tick();
 h.frames.at(-1).remove();h.observer();assert.equal(h.scope.active,false);
});
test('authorization cleanup removes the frame without forwarding business commands',()=>{
 const h=harness();h.send({type:'INVITE_SEND',modal:true,rects:[]});assert.equal(h.frames[0].style['clip-path'],undefined);
 h.scope.stop();assert.equal(h.frames[0].isConnected,false);assert.equal(h.frames[0].src,'about:blank');
});

test('new host never mounts without license, in a child frame, or on a lookalike route',()=>{
 assert.equal(harness({licensed:false}).frames.length,0);
 assert.equal(harness({child:true}).frames.length,0);
 assert.equal(harness({pathname:'/dashboard/servicehall/daren-square/fake'}).frames.length,0);
});
