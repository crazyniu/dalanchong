import test from 'node:test';import assert from 'node:assert/strict';import {queryInvitationData} from '../browser-extension/invitation/background/invite-query.js';
const scope={userId:'p',platform:'douyin',platformAccountId:'a'};
const talents=Array.from({length:10000},(_,i)=>({id:String(i),name:'Talent '+i,source:i%2?'广场':'推荐',fans:i,...(i===9999?{sales30d:'100'}:{})}));
const records=talents.map(row=>({id:row.id,talentId:row.id,status:'success'}));
const store={exportRows:async(s,filters,isRecords)=>{assert.equal(s,scope);const rows=isRecords?records:talents;return filters.query?rows.filter(row=>row.id===filters.query):rows}};
test('10000-row account returns one bounded page, account aggregates and page-only records',async t=>{
 const calls=[];const tracked={exportRows:async(...args)=>{calls.push(args);return store.exportRows(...args)}};
 const start=performance.now();const data=await queryInvitationData(tracked,scope,{kind:'talents',page:250,pageSize:20});
 assert.equal(calls.length,2);assert.equal(calls.filter(args=>args[2]===false).length,1);
 const elapsed=performance.now()-start,size=Buffer.byteLength(JSON.stringify(data));t.diagnostic(`10000 rows: ${elapsed.toFixed(2)} ms; response ${size} bytes; page ${data.rows.length} rows`);
 assert.equal(data.total,10000);assert.equal(data.accountTotal,10000);assert.equal(data.rows.length,20);assert.equal(data.rows[0].id,'4980');assert.equal(data.latestRecords.length,20);assert.ok(data.columns.includes('sales30d'));assert.deepEqual(data.sources,['广场','推荐']);assert.ok(size<10000);
});
test('filtered totals and out-of-range final page are exact',async()=>{
 const data=await queryInvitationData(store,scope,{kind:'talents',page:99,pageSize:20,filters:{query:'9999'}});assert.equal(data.total,1);assert.equal(data.accountTotal,10000);assert.equal(data.page,1);assert.deepEqual(data.rows.map(row=>row.id),['9999']);assert.equal(data.latestRecords.length,1);
 const history=await queryInvitationData(store,scope,{kind:'records',page:99999,pageSize:33});assert.equal(history.total,10000);assert.equal(history.page,304);assert.equal(history.rows.length,1);assert.equal(history.accountTotal,undefined);
});
test('single record and malformed queries stay scoped and bounded',async()=>{
 assert.equal((await queryInvitationData(store,scope,{kind:'record',id:'2'})).record.talentId,'2');assert.equal((await queryInvitationData(store,scope,{kind:'record',id:'missing'})).record,null);
 for(const input of [{kind:'talents',pageSize:10001},{kind:'records',page:0},{kind:'unknown'},{kind:'record',id:[]}] )await assert.rejects(queryInvitationData(store,scope,input));
});

test('IndexedDB 10000-row dataset filters, paginates and isolates scope',async t=>{
 const {indexedDB,IDBKeyRange}=await import('fake-indexeddb');globalThis.indexedDB=indexedDB;globalThis.IDBKeyRange=IDBKeyRange;
 const {openInviteStore}=await import('../browser-extension/invitation/background/invite-store.js');
 const db=await openInviteStore();const a={userId:'perf',platform:'douyin',platformAccountId:'a'},b={...a,platformAccountId:'b'};
 try {
  const seedStart=performance.now();
  // Global capacity includes every account: 9999 in A and one in B.
  for(let offset=0;offset<9999;offset+=1000)await db.upsertTalents(a,Array.from({length:Math.min(1000,9999-offset)},(_,i)=>({id:String(offset+i),name:'Talent '+(offset+i),fans:offset+i,gender:(offset+i)%2?'女':'男',source:'广场'})));
  await db.upsertTalents(b,[{id:'0',name:'Other account',fans:99999,source:'其他'}]);
  const seedMs=performance.now()-seedStart,start=performance.now();
  const data=await queryInvitationData(db,a,{kind:'talents',page:3,pageSize:20,filters:{gender:'female',minFans:5000}});
  const queryMs=performance.now()-start,bytes=Buffer.byteLength(JSON.stringify(data));
  assert.equal(data.total,2499);assert.equal(data.accountTotal,9999);assert.equal(data.rows.length,20);assert.equal(data.page,3);
  assert.ok(data.rows.every(row=>row.fans>=5000&&row.gender==='女'));assert.deepEqual(data.sources,['广场']);assert.ok(data.rows.every(row=>row.name!=='Other account'));assert.ok(bytes<15000);
  const other=await queryInvitationData(db,b,{kind:'talents',page:1,pageSize:20});assert.equal(other.total,1);assert.equal(other.accountTotal,1);assert.equal(other.rows[0].name,'Other account');
  t.diagnostic(`fake IndexedDB 10000 total rows: seed ${seedMs.toFixed(2)} ms; filtered query ${queryMs.toFixed(2)} ms; 20-row response ${bytes} bytes`);
 }finally {db.close()}
});

test('metric columns match platform and omit placeholder-only values while retaining zero',async()=>{
 const values=[{id:'1',sales30d:' — ',settlement30d:'¥ NaN',sales7d:'20'},{id:'2',sales30d:' ',settlement30d:'-'}];
 const local={exportRows:async(_scope,_filters,records)=>records?[]:values};
 assert.deepEqual((await queryInvitationData(local,scope,{kind:'talents'})).columns,[]);
 assert.deepEqual((await queryInvitationData(local,{...scope,platform:'kuaishou'},{kind:'talents'})).columns,['sales7d']);
 values.push({id:'3',sales30d:'0',settlement30d:0});
 assert.deepEqual((await queryInvitationData(local,scope,{kind:'talents'})).columns,['sales30d','settlement30d']);
});

test('source selection remains exact for stored long and space-containing labels',async()=>{
 const source=' 来源 '+ '长'.repeat(230)+' ';
 const rows=[{id:'1',name:'One',source},{id:'2',name:'Two',source:source.trim()}];
 const local={exportRows:async(_scope,_filters,records)=>records?[]:rows};
 const data=await queryInvitationData(local,scope,{kind:'talents',filters:{source}});
 assert.deepEqual(data.rows.map(row=>row.id),['1']);
 await assert.rejects(queryInvitationData(local,scope,{kind:'talents',filters:{source:'x'.repeat(501)}}),/采集来源/);
 await assert.rejects(queryInvitationData(local,scope,{kind:'record',id:''}),/记录 ID/);
});
