import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';
const built=await build({entryPoints:['src/invitation-ui/format.ts'],bundle:true,write:false,format:'esm',platform:'browser'});
const {exportRecords}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
test('CSV includes optional fields from every row and keeps formula escaping',async()=>{
 let blob;const create=URL.createObjectURL,revoke=URL.revokeObjectURL,timer=globalThis.setTimeout;
 globalThis.document={body:{append(){}},createElement:()=>({click(){},remove(){}})};URL.createObjectURL=value=>{blob=value;return 'blob:test'};URL.revokeObjectURL=()=>{};globalThis.setTimeout=()=>0;
 try {await exportRecords([{id:'old'},{id:'new',products:'123',message:'=formula',sales30d:'456'}],'test.csv');const text=await blob.text();assert.equal(text.split('\r\n')[0],'"id","products","message","sales30d"');assert.match(text,/"new","123","'=formula","456"/)}
 finally{URL.createObjectURL=create;URL.revokeObjectURL=revoke;globalThis.setTimeout=timer;delete globalThis.document}
});
