import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import vm from 'node:vm';
async function dependencySource(prefix, relative) {
 const root = new URL('../node_modules/.pnpm/', import.meta.url);
 const folder = (await readdir(root)).find(name=>name.startsWith(prefix));
 assert.ok(folder, `installed dependency ${prefix}`);
 return readFile(new URL(`${folder}/node_modules/${relative}`, root), 'utf8');
}
function element(parent=null) {
 const attrs=new Map(); const node={parentNode:parent,children:[],getAttribute:k=>attrs.get(k)??null,setAttribute:(k,v)=>attrs.set(k,v),removeAttribute:k=>attrs.delete(k),querySelectorAll:()=>[],contains(other){while(other){if(other===this)return true;other=other.parentNode;}return false;}};
 if(parent?.children)parent.children.push(node);
 return node;
}
test('installed aria-hidden preserves ShadowRoot host and reverses sibling attributes',async()=>{
 const source=await dependencySource('aria-hidden@','aria-hidden/dist/es2015/index.js');
 const context=vm.createContext({console});vm.runInContext(source.replaceAll('export var ','var '),context);
 const body=element(), host=element(body), sibling=element(body), prehidden=element(body);prehidden.setAttribute('aria-hidden','true');
 const shadow={host,parentNode:null,children:[]}, dialog=element(shadow), otherUI=element(shadow);
 const undo=context.hideOthers(dialog,body);
 assert.equal(host.getAttribute('aria-hidden'),null);
 assert.equal(sibling.getAttribute('aria-hidden'),'true');
 // The library preserves the host wholesale: another UI subtree is not isolated.
 assert.equal(otherUI.getAttribute('aria-hidden'),null);
 undo(); assert.equal(sibling.getAttribute('aria-hidden'),null);assert.equal(prehidden.getAttribute('aria-hidden'),'true');
});
