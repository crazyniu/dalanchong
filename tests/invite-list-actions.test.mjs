import test from 'node:test';
import assert from 'node:assert/strict';
import {talentCopy,talentTableMetrics,deleteTalentSelection} from '../browser-extension/invite-list-actions.js';
test('platform copy has exact single value; missing nickname is not fabricated',()=>{
 assert.deepEqual(talentCopy('douyin',{name:'昵称',id:'123'}),{label:'昵称',value:'昵称'});
 assert.deepEqual(talentCopy('kuaishou',{name:'昵称',id:'123',uid:'456'}),{label:'快手号',value:'123'});
 assert.equal(talentCopy('douyin',{id:'123'}).value,'');
});
test('only core sales/settlement metrics appear in main table',()=>{
 const metrics=['gender','sales7d','sales30d','settlement30d','replyRate'].map(key=>[key,key]);
 assert.deepEqual(talentTableMetrics('douyin',metrics).map(([key])=>key),['sales30d','settlement30d']);
 assert.deepEqual(talentTableMetrics('kuaishou',metrics).map(([key])=>key),['sales30d','sales7d']);
});
test('empty selection deletes confirmed entire account snapshot, not current filter',async()=>{
 let message,deleted;
 assert.equal(await deleteTalentSelection({selected:[],listIds:async()=>['one','outside-filter'],confirm:m=>{message=m;return true;},remove:async ids=>{deleted=ids;}}),true);
 assert.deepEqual(deleted,['one','outside-filter']);assert.match(message,/当前账号全部 2/);assert.match(message,/筛选外/);assert.match(message,/历史及防重复标记会保留/);
});
test('selection bypasses full-account query and cancel never deletes',async()=>{
 let queried=false,removed=false;
 await deleteTalentSelection({selected:['selected'],listIds:async()=>{queried=true;},confirm:()=>false,remove:async()=>{removed=true;}});
 assert.equal(queried,false);assert.equal(removed,false);
 let deleted;
 await deleteTalentSelection({selected:['selected'],listIds:async()=>{throw Error('must not query');},confirm:()=>true,remove:async ids=>{deleted=ids;}});
 assert.deepEqual(deleted,['selected']);
});
