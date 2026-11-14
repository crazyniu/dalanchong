import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
const code=(await readFile(new URL('../browser-extension/settings-background.js',import.meta.url),'utf8')).replace(/^import .*;\n/gm,'');
function setup() {
 let handler; const data={};
 vm.runInNewContext(code,{URL,Set,Error,Boolean,listenMessages:(_types,fn)=>handler=fn,
 trustedLicensePage:sender=>sender.trusted===true,
 chrome:{storage:{local:{get:async()=>data,set:async value=>Object.assign(data,value)}}}});
 return {data,run:async(message,sender={trusted:true,url:'chrome-extension://test/settings.html'})=>{
 let result; await handler(message,sender,value=>result=value);return result;}};
}
test('profile shop label settings save actual visible identity and can disable without losing name',async()=>{
 const api=setup();let result=await api.run({type:'SETTINGS_SAVE',shopName:' 店铺 ',showShopName:true});
 assert.equal(result.shopName,'店铺');assert.equal(api.data.shopIdentity.name,'店铺');
 result=await api.run({type:'SETTINGS_SAVE',shopName:'店铺',showShopName:false});
 assert.equal(api.data.shopIdentity,null);assert.equal(result.shopName,'店铺');assert.equal(result.showShopName,false);
});
test('settings reject invalid and untrusted writes',async()=>{
 const api=setup();
 for(const input of [{shopName:'',showShopName:true},{shopName:'a'.repeat(41),showShopName:true},{shopName:'a',showShopName:'yes'}]) await assert.rejects(()=>api.run({type:'SETTINGS_SAVE',...input}));
 await assert.rejects(()=>api.run({type:'SETTINGS_GET'},{trusted:false,url:'https://example.invalid/'}));
 await assert.rejects(()=>api.run({type:'SETTINGS_GET'},{trusted:true,url:'chrome-extension://test/invite.html'}));
});
