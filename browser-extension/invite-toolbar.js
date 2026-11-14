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
    *{box-sizing:border-box}button{font:inherit;color:inherit;cursor:pointer;border:1px solid #e4e4e7;border-radius:8px;padding:7px 10px;min-height:36px;background:white;white-space:nowrap}button:hover{background:#f4f4f5}button:disabled{opacity:.45;cursor:default}button:focus-visible{outline:2px solid #71717a;outline-offset:2px}button.primary{background:#18181b;color:white;border-color:#18181b}button.danger{color:#b91c1c;border-color:#fecaca}.bar{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:10px;background:#fff;border:1px solid #e4e4e7;border-radius:12px;box-shadow:0 8px 28px #18181b29;max-width:100%;width:max-content}.handle{touch-action:none;cursor:grab;user-select:none;font-weight:600;border:0;background:#f4f4f5}.info{display:flex;flex-direction:column;min-width:120px;max-width:240px;margin-right:6px}.account{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.status{white-space:normal;overflow-wrap:anywhere}.account{font-weight:600}.status{font-size:12px;color:#71717a}.nav{display:flex;gap:4px;border-right:1px solid #e4e4e7;padding-right:6px}.panel{position:fixed;right:16px;bottom:100px;width:min(960px,calc(100vw - 32px));height:min(720px,calc(100vh - 140px));min-height:180px;display:flex;flex-direction:column;background:#fff;border:1px solid #d4d4d8;border-radius:12px;overflow:hidden;box-shadow:0 12px 44px #18181b40}.panel[hidden]{display:none}.panel-head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #e4e4e7;background:#fafafa}.panel-head strong{flex:1}.panel iframe{border:0;width:100%;flex:1;min-height:0;background:#fff}.progress{flex-basis:100%;display:flex;flex-direction:column;gap:6px;border-top:1px solid #e4e4e7;padding-top:8px;font-size:13px;white-space:normal;overflow:visible;overflow-wrap:anywhere}.progress[hidden]{display:none}.progress-step{flex-basis:100%;overflow-wrap:anywhere}.progress-row{display:flex;flex-wrap:wrap;gap:6px 14px;line-height:1.7}.progress-row strong{font-weight:600}.retry{color:#92400e}.error{color:#b91c1c}@media(max-width:720px){.bar{gap:4px;padding:8px}.info{max-width:150px}.panel{right:8px;bottom:160px;width:calc(100vw - 16px);height:calc(100vh - 180px)}}
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
  const collect = button('采集达人', () => command('INVITE_TOOLBAR_COLLECT'), 'primary'); collect.disabled = true;
  const reconnect = button('重新检查登录', () => refresh()); reconnect.title = '在平台完成登录后重新检查，不会自动采集或发送';
  const invite = button('邀约达人 0', () => showPanel('talents'));
  const returnToInvite = button('返回邀约', () => {
    showPanel('resume-invite');
    hasSeenLoggedOut = false;
    void request('INVITE_RETURN_CLEAR').then(() => updateControls()).catch(() => {});
  }); returnToInvite.hidden = true;
  const logs = button('日志', () => showPanel('logs'));
  const records = button('记录', () => showPanel('records'));
  const stop = button('停止', () => command('INVITE_TOOLBAR_STOP'), 'danger'); stop.disabled = true;
  const progress = document.createElement('div'); progress.className = 'progress'; progress.hidden = true;
  bar.append(handle, nav, info, reconnect, returnToInvite, collect, invite, logs, records, stop, progress);
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
  function closePanel() { panel.hidden = true; }
  function resetPanel() { closePanel(); frame.src = 'about:blank'; }
  function showPanel(view) {
    if (!scope.active || !supported()) return;
    const next = chrome.runtime.getURL('invite.html') + '?embedded=1#' + view;
    if (frame.src !== next) frame.src = next;
    else if (view === 'resume-invite') frame.contentWindow.postMessage({type: 'INVITE_RESUME_COMPOSE'}, extensionOrigin);
    title.textContent = {'resume-invite':'邀约达人', talents:'邀约达人', records:'邀约记录', logs:'任务日志'}[view];
    panel.hidden = false;
  }
  scope.listen(window, 'message', event => {
    if (event.source !== frame.contentWindow || event.origin !== extensionOrigin || event.data?.type !== 'INVITE_EMBED_CLOSE') return;
    closePanel();
  });
  const clean = value => String(value ?? '').slice(0, 180);
  let readyUrl = '', latestState = null, lastLoggedIn = false, hasSeenLoggedOut = false;
  function updateControls() {
    const ready = latestState?.loggedIn === true && latestState?.readiness === true && readyUrl === location.href;
    collect.disabled = busy || !ready || latestState?.collecting === true;
    collect.title = !latestState?.loggedIn ? '请先在平台页面完成登录' : !ready ? '请先搜索或应用筛选，等待列表加载后采集' : '采集当前筛选结果';
    reconnect.hidden = latestState?.loggedIn === true;
    returnToInvite.hidden = !(hasSeenLoggedOut && latestState?.loggedIn === true);
    stop.disabled = !(busy || latestState?.collecting || latestState?.inviting);
  }
  function renderProgress() {
    const tasks = Array.isArray(latestState?.tasks) ? latestState.tasks.slice(0, 2) : [];
    progress.replaceChildren();
    progress.hidden = !tasks.length;
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    for (const task of tasks) {
      const row = document.createElement('div'); row.className = 'progress-row';
      const name = document.createElement('strong'); name.textContent = task.kind === 'collect' ? '采集进度' : '邀约进度'; row.append(name);
      for (const text of [`进度 ${number(task.processed)}/${number(task.total)}`, `成功 ${number(task.success)}`, `失败 ${number(task.failed)}`, `跳过 ${number(task.skipped)}`, `待核实 ${number(task.review)}`]) {
        const metric = document.createElement('span'); metric.textContent = text; row.append(metric);
      }
      if (Number.isFinite(task.retryAt) && task.retryAt > 0) {
        const retry = document.createElement('span'); retry.className = 'retry';
        const seconds = Math.max(0, Math.ceil((task.retryAt - Date.now()) / 1000));
        retry.textContent = seconds ? `重试倒计时 ${seconds} 秒` : '正在重新检查'; row.append(retry);
      }
      progress.append(row);
    }
  }
  function applyState(value) {
    latestState = value; readyUrl = location.href;
    account.textContent = clean(value.accountName) || (value.loggedIn ? '当前账号' : '尚未登录平台');
    const count = Number.isSafeInteger(value.total) && value.total >= 0 ? value.total : 0;
    invite.textContent = `邀约达人 ${count}`;
    status.classList.remove('error');
    status.textContent = !value.loggedIn ? '请先在平台完成登录，工具会自动检查；不会自动开始任务'
      : !value.readiness ? '已登录，请搜索或重新应用筛选后采集'
      : !lastLoggedIn ? '登录已确认，可继续操作；任务不会自动开始' : clean(value.status) || '就绪';
    if (value.loggedIn !== true) hasSeenLoggedOut = true;
    lastLoggedIn = value.loggedIn === true;
    updateControls(); renderProgress();
  }
  scope.setInterval(() => { if (readyUrl === location.href) renderProgress(); }, 1000);
  async function request(type, extra = {}) {
    const result = await chrome.runtime.sendMessage({type, ...extra});
    if (!result?.ok) throw Error(result?.error || '工具暂不可用');
    return result;
  }
  async function refresh() {
    if (polling || !scope.active || !supported()) return;
    const current = generation; polling = true; lastPoll = Date.now();
    try {
      const value = await request('INVITE_TOOLBAR_STATUS');
      const returning = await request('INVITE_RETURN_STATUS');
      if (scope.active && current === generation) {
        if (returning.resume) hasSeenLoggedOut = true;
        applyState(value);
      }
    }
    catch (error) { if (scope.active && current === generation) { latestState = null; readyUrl = ''; updateControls(); renderProgress(); status.textContent = clean(error.message); status.classList.add('error'); } }
    finally { polling = false; }
  }
  async function command(type, extra = {}) {
    if (type === 'INVITE_TOOLBAR_COLLECT' && !(latestState?.loggedIn === true && latestState?.readiness === true && readyUrl === location.href)) { updateControls(); return; }
    const ownsBusy = type !== 'INVITE_TOOLBAR_STOP';
    if (busy && ownsBusy || !scope.active || !supported()) return;
    const current = generation; if (ownsBusy) { busy = true; collect.disabled = true; if (type === 'INVITE_TOOLBAR_COLLECT') stop.disabled = false; }
    try {
      await request(type, extra);
      if (type === 'INVITE_TOOLBAR_COLLECT' && scope.active && current === generation) showPanel('logs');
    }
    catch (error) { if (scope.active && current === generation) { status.textContent = clean(error.message); status.classList.add('error'); } }
    finally { if (scope.active && current === generation) { if (ownsBusy) busy = false; updateControls(); void refresh(); } }
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
      route = location.href; generation++; resetPanel(); busy = false; lastPoll = 0;
      if (supported()) { document.documentElement.append(host, panelHost); status.textContent = '正在连接…'; }
      else { host.remove(); panelHost.remove(); }
    }
    if (supported() && Date.now() - lastPoll >= 2000) void refresh();
  }
  scope.cleanup(() => { generation++; resetPanel(); host.remove(); panelHost.remove(); });
  scope.listen(window, 'popstate', syncRoute); scope.listen(window, 'hashchange', syncRoute);
  scope.setInterval(syncRoute, 500); syncRoute();
})();
