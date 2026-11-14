import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, access} from 'node:fs/promises';
import {featureScripts} from '../browser-extension/feature-scripts.js';
const base = new URL('../browser-extension/', import.meta.url);
test('settings retain authorization and version without removed shop identity controls', async () => {
 const html=await readFile(new URL('settings.html',base),'utf8');
 const js=await readFile(new URL('settings.js',base),'utf8');
 assert.match(html,/id="license-gate"/); assert.match(html,/id="verify-license"/); assert.match(html,/id="version"/);
 assert.match(js,/await requirePageLicense\(\)/); assert.match(js,/LICENSE_VERIFY/);
 for(const id of ['shop-name','show-shop-name','settings-form']) assert.ok(!html.includes(`id="${id}"`));
 assert.doesNotMatch(js,/SETTINGS_SAVE|SETTINGS_GET|storage\.local\.(?:clear|remove|set)/);
 const ids=new Set([...html.matchAll(/id="([^"]+)"/g)].map(match=>match[1]));
 for(const [,id] of js.matchAll(/\$\('([^']+)'\)/g)) assert.ok(ids.has(id),id);
});
test('shop identity injection and routes are removed without removing capture and invitation tools',async()=>{
 const files=featureScripts.flatMap(script=>script.js||[]);
 assert.ok(!files.includes('shop-label.js'));
 for(const file of ['capture.js','content.js','xhr.js','detail-buttons.js','invite-toolbar.js']) assert.ok(files.includes(file),file);
 const background=await readFile(new URL('background.js',base),'utf8');
 assert.doesNotMatch(background,/shop-label-background|settings-background/);
 assert.match(background,/initializeFeatureInjection/);
 for(const file of ['shop-label.js','shop-label-background.js','settings-background.js']) await assert.rejects(access(new URL(file,base)));
});
