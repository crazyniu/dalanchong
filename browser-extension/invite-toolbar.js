/** Licensed top-frame creator tools. Fixed commands only; page messages may close the owned frame, never execute actions. */
(() => {
  if (window !== window.top) return;
  const scope = globalThis.__dlcFeatureGate?.begin('invite-toolbar');
  if (!scope) return;
  const routes = {
    'https://buyin.jinritemai.com': ['/dashboard/servicehall/daren-square', '/dashboard/servicehall/clue-daren', '/dashboard/servicehall/peer-reference', '/dashboard/ranklist/daren'],
    'https://cps.kwaixiaodian.com': ['/zone/daren-match/daren-square-pro', '/zone/daren-match/peer-reference', '/zone-cps/promoter-rank-list'],
  };
  const supported = () => routes[location.origin]?.includes(location.pathname) === true;
  const host = scope.createElement('div');
  host.id = 'dalanchong-invite-toolbar';
  const root = host.attachShadow({mode: 'closed'});
  const style = document.createElement('style');
  style.textContent = `
    :host{all:initial!important;position:fixed!important;left:var(--left,50%)!important;top:var(--top,auto)!important;bottom:var(--bottom,16px)!important;transform:var(--shift,translateX(-50%))!important;z-index:2147483646!important;max-width:calc(100vw - 24px)!important;font:14px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI','Microsoft YaHei',sans-serif!important;color:#18181b!important}
    *{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:1px solid #e4e4e7;border-radius:8px;padding:7px 10px;min-height:36px;background:white;white-space:nowrap}button:hover{background:#f4f4f5}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #71717a;outline-offset:2px}button.primary{background:#18181b;color:white;border-color:#18181b}button.danger{color:#b91c1c;border-color:#fecaca}.bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;box-shadow:0 8px 28px #18181b29;max-width:100%;width:max-content}.handle{touch-action:none;cursor:grab;user-select:none;font-weight:600;border:0;background:#f4f4f5}.info{display:flex;flex-direction:column;min-width:100px;max-width:190px;margin-right:6px}.account,.status{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.account{font-weight:600}.status{font-size:12px;color:#71717a}.nav{display:flex;gap:4px;border-right:1px solid #e4e4e7;padding-right:6px}.panel{position:fixed;right:16px;bottom:100px;width:min(960px,calc(100vw - 32px));height:min(720px,calc(100vh - 140px));min-height:180px;display:flex;flex-direction:column;background:#fff;border:1px solid #d4d4d8;border-radius:12px;overflow:hidden;box-shadow:0 12px 44px #18181b40}.panel[hidden]{display:none}.panel-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e4e4e7;background:#fafafa}.panel-head strong{flex:1}.panel iframe{border:0;width:100%;flex:1;min-height:0;background:#fff}.error{color:#b91c1c}@media(max-width:720px){.bar{gap:4px;padding:8px}.info{max-width:150px}.panel{right:8px;bottom:160px;width:calc(100vw - 16px);height:calc(100vh - 180px)}}
  `;
  const bar = document.createElement('div'); bar.className = 'bar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '大懒虫达人工具');
  const button = (label, action, className = '') => {
    const node = document.createElement('button'); node.type = 'button'; node.textContent = label; node.className = className;
    if (action) scope.listen(node, 'click', action);
    return node;
  };
  const handle = button('⠿ 大懒虫', null, 'handle'); handle.title = '拖动工具栏';
  const nav = document.createElement('div'); nav.className = 'nav';
  for (const [action, label, title] of [['back', '←', '后退'], ['forward', '→', '前进'], ['home', '主页', '返回来源主页']]) {
    const node = button(label, () => command('INVITE_TOOLBAR_NAV', {action})); node.title = title; node.setAttribute('aria-label', title); nav.append(node);
  }
  const info = document.createElement('div'); info.className = 'info';
  const account = document.createElement('span'); account.className = 'account'; account.textContent = '当前账号';
  const status = document.createElement('span'); status.className = 'status'; status.textContent = '正在连接…'; status.setAttribute('aria-live', 'polite'); info.append(account, status);
  const collect = button('采集达人', () => command('INVITE_TOOLBAR_COLLECT'), 'primary');
  const invite = button('邀约达人 0', () => showPanel('talents'));
  const logs = button('日志', () => showPanel('logs'));
  const records = button('记录', () => showPanel('records'));
  const stop = button('停止', () => command('INVITE_TOOLBAR_STOP'), 'danger'); stop.disabled = true;
  bar.append(handle, nav, info, collect, invite, logs, records, stop);
  const panel = document.createElement('section'); panel.className = 'panel'; panel.hidden = true; panel.setAttribute('aria-label', '达人工作区');
  const heading = document.createElement('div'); heading.className = 'panel-head';
  const title = document.createElement('strong'); title.textContent = '达人工作区';
  const frame = document.createElement('iframe'); frame.title = '大懒虫达人工作区'; frame.referrerPolicy = 'no-referrer';
  const minimize = button('收起', () => { panel.hidden = true; });
  const close = button('关闭', closePanel); heading.append(title, minimize, close); panel.append(heading, frame);
  root.append(style, bar);
  // The panel gets its own fixed host: dragging the bar must not move or transform it.
  const panelHost = scope.createElement('div'); panelHost.id = 'dalanchong-invite-panel';
  panelHost.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;pointer-events:none!important;z-index:2147483647!important';
  const panelRoot = panelHost.attachShadow({mode:'closed'}); const panelStyle = style.cloneNode(true);
  panelStyle.textContent += ':host{left:0!important;top:0!important;bottom:0!important;transform:none!important;max-width:none!important;inset:0!important;width:100vw!important;height:100vh!important;pointer-events:none!important;z-index:2147483647!important}.panel{pointer-events:auto}';
  panelRoot.append(panelStyle, panel);
  let route = '', generation = 0, polling = false, busy = false, lastPoll = 0, position, drag;
  const extensionOrigin = chrome.runtime.getURL('/').replace(/\/$/, '');
  function closePanel() { panel.hidden = true; frame.src = 'about:blank'; }
  function showPanel(view) {
    if (!scope.active || !supported()) return;
    const next = chrome.runtime.getURL('invite.html') + '?embedded=1&view=' + view;
    if (frame.src !== next) frame.src = next;
    title.textContent = {talents:'邀约达人', records:'邀约记录', logs:'任务日志'}[view];
    panel.hidden = false;
  }
  scope.listen(window, 'message', event => {
    if (event.source !== frame.contentWindow || event.origin !== extensionOrigin || event.data?.type !== 'INVITE_EMBED_CLOSE') return;
    closePanel();
  });
  const clean = value => String(value ?? '').slice(0, 180);
  function applyState(value) {
    account.textContent = clean(value.accountName) || '当前账号';
    const count = Number.isSafeInteger(value.total) && value.total >= 0 ? value.total : 0;
    invite.textContent = `邀约达人 ${count}`;
    collect.disabled = busy || value.collecting === true;
    stop.disabled = !(busy || value.collecting || value.inviting);
    status.classList.remove('error');
    status.textContent = clean(value.progress || value.status) || '就绪';
  }
  async function request(type, extra = {}) {
    const result = await chrome.runtime.sendMessage({type, ...extra});
    if (!result?.ok) throw Error(result?.error || '工具暂不可用');
    return result;
  }
  async function refresh() {
    if (polling || !scope.active || !supported()) return;
    const current = generation; polling = true; lastPoll = Date.now();
    try { const value = await request('INVITE_TOOLBAR_STATUS'); if (scope.active && current === generation) applyState(value); }
    catch (error) { if (scope.active && current === generation) { status.textContent = clean(error.message); status.classList.add('error'); } }
    finally { polling = false; }
  }
  async function command(type, extra = {}) {
    const ownsBusy = type !== 'INVITE_TOOLBAR_STOP';
    if (busy && ownsBusy || !scope.active || !supported()) return;
    const current = generation; if (ownsBusy) { busy = true; collect.disabled = true; if (type === 'INVITE_TOOLBAR_COLLECT') stop.disabled = false; }
    try { await request(type, extra); }
    catch (error) { if (scope.active && current === generation) { status.textContent = clean(error.message); status.classList.add('error'); } }
    finally { if (scope.active && current === generation) { if (ownsBusy) { busy = false; collect.disabled = false; } void refresh(); } }
  }
  function clamp(left, top) {
    const rect = host.getBoundingClientRect();
    position = {left: Math.max(8, Math.min(left, innerWidth - rect.width - 8)), top: Math.max(8, Math.min(top, innerHeight - rect.height - 8))};
    host.style.setProperty('--left', `${position.left}px`); host.style.setProperty('--top', `${position.top}px`);
    host.style.setProperty('--bottom', 'auto'); host.style.setProperty('--shift', 'none');
  }
  scope.listen(handle, 'pointerdown', event => {
    if (event.button !== 0) return;
    event.preventDefault(); const rect = host.getBoundingClientRect(); drag = {id:event.pointerId,x:event.clientX-rect.left,y:event.clientY-rect.top}; handle.setPointerCapture(event.pointerId);
  });
  scope.listen(handle, 'pointermove', event => { if (drag?.id === event.pointerId) clamp(event.clientX-drag.x,event.clientY-drag.y); });
  const endDrag = () => { drag = null; };
  scope.listen(handle, 'pointerup', endDrag); scope.listen(handle, 'pointercancel', endDrag); scope.listen(handle, 'lostpointercapture', endDrag);
  scope.listen(window, 'resize', () => { if (position) clamp(position.left, position.top); });
  function syncRoute() {
    if (route !== location.href) {
      route = location.href; generation++; closePanel(); busy = false; lastPoll = 0;
      if (supported()) { document.documentElement.append(host, panelHost); status.textContent = '正在连接…'; }
      else { host.remove(); panelHost.remove(); }
    }
    if (supported() && Date.now() - lastPoll >= 2000) void refresh();
  }
  scope.cleanup(() => { generation++; closePanel(); host.remove(); panelHost.remove(); });
  scope.listen(window, 'popstate', syncRoute); scope.listen(window, 'hashchange', syncRoute);
  scope.setInterval(syncRoute, 500); syncRoute();
})();
