import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,stat} from 'node:fs/promises';
const root=new URL('../',import.meta.url),extension=new URL('browser-extension/',root);
const mapping=JSON.parse(await readFile(new URL('scripts/extension-layout.json',root),'utf8'));
test('every mapped runtime file exists and flat duplicates are absent except stable worker shim',async()=>{
 assert.equal(new Set(Object.values(mapping)).size,Object.keys(mapping).length);
 for(const [oldPath,newPath] of Object.entries(mapping)) {
  assert.ok((await stat(new URL(newPath,extension))).isFile(),newPath);
  if(oldPath!=='background.js')await assert.rejects(stat(new URL(oldPath,extension)),{code:'ENOENT'});
 }
 assert.equal(await readFile(new URL('background.js',extension),'utf8'),"/** Stable service-worker entry. */\nimport './background/background.js';\n");
});
test('installation root, manifest pages and pre-license bootstrap retain compatibility paths',async()=>{
 const manifest=JSON.parse(await readFile(new URL('manifest.json',extension),'utf8'));
 assert.equal(manifest.background.service_worker,'background.js');
 assert.equal(manifest.action.default_popup,'popup.html');
 assert.equal(manifest.options_ui.page,'settings.html');
 for(const entry of manifest.content_scripts)assert.deepEqual(entry.js,['feature-bootstrap.js']);
 for(const page of ['popup.html','manager.html','settings.html','preview.html','invite.html','invitation-workspace.html'])assert.ok((await stat(new URL(page,extension))).isFile());
 const html=await readFile(new URL('invitation-workspace.html',extension),'utf8');
 assert.match(html,/src="invitation\/ui\/invitation-ui\.js"/);
});
