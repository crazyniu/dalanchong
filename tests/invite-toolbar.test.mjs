/** Pure DOM/Chrome mocks. No live merchant page, account, collection or invitation. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const source = await readFile(new URL('../browser-extension/invite-toolbar.js', import.meta.url), 'utf8');
const base = 'chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/';
function run({pathname = '/dashboard/servicehall/daren-square', child = false, enabled = true} = {}) {
  const nodes = [], cleanups = [], intervals = [], sent = [];
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.style = {setProperty() {}}; this.classList = {add() {}, remove() {}}; this.contentWindow = {}; nodes.push(this); }
    append(...children) { for (const child of children) { child.parent = this; this.children.push(child); } }
    attachShadow() { const root = new Node('shadow'); this.root = root; return root; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(item => item !== this); this.parent = null; }
    setAttribute() {} setPointerCapture() {}
    cloneNode() { const copy = new Node(this.tag); copy.textContent = this.textContent; return copy; }
    getBoundingClientRect() { return {left: 10, top: 10, width: 800, height: 70}; }
  }
  const html = new Node('html'); const window = {handlers: {}}; window.top = child ? {} : window;
  const location = {origin: 'https://buyin.jinritemai.com', pathname, href: 'https://buyin.jinritemai.com' + pathname};
  const scope = {active: true, createElement(tag) { const node = new Node(tag); cleanups.push(() => node.remove()); return node; },
    cleanup(fn) { cleanups.push(fn); }, listen(target, event, fn) { target.handlers[event] = fn; }, setInterval(fn) { intervals.push(fn); }};
  const context = {window, location, innerWidth: 1200, innerHeight: 900, URL, Date,
    document: {createElement: tag => new Node(tag), documentElement: html},
    chrome: {runtime: {getURL: path => base + path.replace(/^\//, ''), async sendMessage(message) { sent.push(message); return {ok:true, accountName:'测试商家',total:7,collecting:false,inviting:false,status:'就绪'}; }}},
    __dlcFeatureGate: {begin: () => enabled ? scope : null}};
  vm.runInNewContext(source, context);
  return {nodes, html, window, location, scope, sent, intervals, cleanups,
    button: label => nodes.find(n => n.tag === 'button' && n.textContent.startsWith(label))};
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('toolbar mounts only in licensed top-frame supported route', async () => {
  assert.equal(run({child:true}).html.children.length, 0);
  assert.equal(run({enabled:false}).html.children.length, 0);
  assert.equal(run({pathname:'/dashboard/servicehall/daren-square/fake'}).html.children.length, 0);
  const f = run(); await tick(); assert.equal(f.html.children.length, 2);
  assert.equal(f.button('邀约达人').textContent, '邀约达人 7');
  assert.deepEqual(f.sent.map(x => x.type), ['INVITE_TOOLBAR_STATUS']);
});
test('SPA departure removes both hosts and return remounts without duplicating them', async () => {
  const f = run(); await tick();
  f.location.pathname='/unsupported'; f.location.href=f.location.origin+f.location.pathname; f.intervals[0]();
  assert.equal(f.html.children.length, 0);
  f.location.pathname='/dashboard/ranklist/daren'; f.location.href=f.location.origin+f.location.pathname; f.intervals[0]();
  assert.equal(f.html.children.length, 2);
  f.scope.active=false; f.cleanups.forEach(fn=>fn()); assert.equal(f.html.children.length,0);
});
test('only the owned extension iframe can request close, never execute actions', async () => {
  const f = run(); await tick(); f.button('邀约达人').handlers.click();
  const frame=f.nodes.find(n=>n.tag==='iframe'), panel=f.nodes.find(n=>n.tag==='section');
  assert.equal(frame.src,base+'invite.html?embedded=1&view=talents'); assert.equal(panel.hidden,false);
  const before=f.sent.length;
  for (const event of [
    {source:{},origin:base.slice(0,-1),data:{type:'INVITE_EMBED_CLOSE'}},
    {source:frame.contentWindow,origin:'https://buyin.jinritemai.com',data:{type:'INVITE_EMBED_CLOSE'}},
    {source:frame.contentWindow,origin:base.slice(0,-1),data:{type:'INVITE_TOOLBAR_COLLECT'}},
  ]) f.window.handlers.message(event);
  assert.equal(panel.hidden,false); assert.equal(f.sent.length,before);
  f.window.handlers.message({source:frame.contentWindow,origin:base.slice(0,-1),data:{type:'INVITE_EMBED_CLOSE'}});
  assert.equal(panel.hidden,true); assert.equal(frame.src,'about:blank');
});
test('explicit toolbar commands use fixed message types and no caller-selected tab', async () => {
  const f=run(); await tick(); await f.button('采集达人').handlers.click(); await tick();
  await f.button('主页').handlers.click(); await tick();
  assert.ok(f.sent.some(m=>m.type==='INVITE_TOOLBAR_COLLECT'));
  const nav=f.sent.find(m=>m.type==='INVITE_TOOLBAR_NAV'); assert.equal(nav.action,'home'); assert.equal('tabId' in nav,false);
});
