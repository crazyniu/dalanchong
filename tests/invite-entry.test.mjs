import test from 'node:test';
import assert from 'node:assert/strict';
import {openInvitationSource} from '../browser-extension/invite-entry.js';
const dy='https://buyin.jinritemai.com/dashboard/servicehall/daren-square';
const ks='https://cps.kwaixiaodian.com/zone/daren-match/peer-reference';
function fixture(all=[]) { const events=[]; return {events,tabs:{query:async()=>all,update:async(id,options)=>events.push({id,...options}),create:async options=>events.push(options)},verify:async()=>{}}; }
test('existing platform source is focused, never detached invitation form',async()=>{const f=fixture([{id:4,url:ks}]);await openInvitationSource(f,'kuaishou');assert.deepEqual(f.events,[{id:4,active:true}]);});
test('current platform is preserved without replacing its page',async()=>{const f=fixture();await openInvitationSource(f,'kuaishou',{url:'https://cps.kwaixiaodian.com/home'});assert.deepEqual(f.events,[{url:ks}]);});
test('no source opens default platform; inactive authorization opens nothing',async()=>{const f=fixture();await openInvitationSource(f,'douyin');assert.deepEqual(f.events,[{url:dy}]);const locked=fixture();locked.verify=async()=>{throw Error('inactive');};await assert.rejects(openInvitationSource(locked,'douyin'));assert.deepEqual(locked.events,[]);});
test('revocation during tab lookup blocks focus and navigation',async()=>{const f=fixture([{id:4,url:dy}]);let count=0;f.verify=async()=>{if(++count>1)throw Error('inactive');};await assert.rejects(openInvitationSource(f,'douyin'));assert.deepEqual(f.events,[]);});
