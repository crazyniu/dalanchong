import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
test('commerce bridge rejects foreign frames, origins and storage debug commands', async () => {
  let handler; const sent = [];
  const window = {}, origin = 'https://compass.jinritemai.com';
  const scope = {listen: (target, name, callback) => { handler = callback; }, chromeListen() {}};
  const context = {window, location: {origin}, URL, chrome: {runtime: {sendMessage: message => sent.push(message), onMessage: {}}},
    __dlcPageScopes: {begin: () => scope}};
  vm.runInNewContext(await readFile(new URL('../browser-extension/content/content.js', import.meta.url), 'utf8'), context);
  for (const event of [
    {source: {}, origin, data: {type: 'OPEN_TAB', url: 'https://www.douyin.com/'}},
    {source: window, origin: 'https://other.test', data: {type: 'OPEN_TAB', url: 'https://www.douyin.com/'}},
    {source: window, origin, data: {type: 'OPEN_TAB', url: 'javascript:alert(1)'}},
    {source: window, origin, data: {type: 'PRINT_VIDEO_LIST'}},
    {source: window, origin, data: {type: 'CLEAR_STORAGE'}},
  ]) handler(event);
  assert.equal(sent.length, 0);
  handler({source: window, origin, data: {type: 'OPEN_TAB', url: 'https://www.douyin.com/'}});
  assert.equal(sent[0].url, 'https://www.douyin.com/');
});
