/**
 * AI module map
 * Purpose: fail-closed shared license gate before any extension-page business initialization.
 * Entry: popup, manager, preview and invite await requirePageLicense at module startup.
 * Flow: status read or explicit activation/verification unlocks; revocation immediately
 * hides business, pauses playback and reloads to dispose old listeners and timers.
 * State: only public license status in memory; entered activation code is cleared on submit.
 * Boundary: the worker remains the authorization authority. No automatic activation,
 * secret logging/storage, platform requests or parent-frame activation form.
 */
export function requirePageLicense() {
  const gate = document.getElementById('license-gate');
  const embedded = window.top !== window;
  let unlocked = false, disposed = false, busy = false, hasCode = false, revision = 0, timer;
  let grant;
  const ready = new Promise(resolve => { grant = resolve; });
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const title = node('h1', '激活大懒虫');
  const status = node('p', '正在读取授权状态…'); status.setAttribute('role', 'status');
  const form = node('form'); form.autocomplete = 'off';
  const label = node('label', '激活码'); label.htmlFor = 'license-gate-code';
  const input = node('input'); input.id = 'license-gate-code'; input.type = 'password';
  input.autocomplete = 'off'; input.required = true;
  const actions = node('div', '', 'license-gate-actions');
  const activate = node('button', '激活', 'btn primary'); activate.type = 'submit';
  const verify = node('button', '重新验证', 'btn outline'); verify.type = 'button';
  const refresh = node('button', '刷新状态', 'btn outline'); refresh.type = 'button';
  actions.append(activate, verify, refresh); form.append(label, input, actions);
  gate.replaceChildren(title, status);
  if (embedded) {
    gate.append(node('p', '请点击浏览器工具栏中的大懒虫图标完成激活。'), refresh);
  } else gate.append(form);
  function controls() {
    activate.disabled = busy; verify.disabled = busy || !hasCode; refresh.disabled = busy;
  }
  function lock(message) {
    revision += 1;
    document.body.dataset.licenseLocked = '';
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    document.querySelectorAll('wa-dialog').forEach(dialog => { dialog.open = false; });
    gate.hidden = false; status.textContent = message || '请先激活插件。';
    for (const media of document.querySelectorAll('video, audio')) {
      media.pause(); media.removeAttribute('src');
      media.querySelectorAll('source').forEach(source => source.removeAttribute('src'));
      media.load();
    }
    if (unlocked && !disposed) { disposed = true; clearTimeout(timer); location.reload(); }
  }
  function apply(license) {
    hasCode = license?.hasCode === true; controls();
    if (license?.valid !== true) { lock(license?.message); return; }
    if (disposed) return;
    if (!unlocked) {
      unlocked = true; input.value = ''; gate.hidden = true;
      delete document.body.dataset.licenseLocked;
      if (!embedded && location.pathname !== '/preview.html') {
        const hint = node('p', '网页工具仅在授权确认后开始识别。若首次打开未识别到视频或达人列表，请回到来源网页刷新或重新操作筛选，再重试；插件不会自动刷新或预先采集。', 'license-ready-hint');
        hint.setAttribute('role', 'note');
        gate.after(hint);
      }
      grant(license);
    }
  }
  async function send(type, payload = {}) {
    const result = await chrome.runtime.sendMessage({type, ...payload});
    if (!result?.ok || !result.license) throw Error(result?.error || '无法读取授权状态，请刷新重试。');
    return result.license;
  }
  async function read() {
    const current = revision;
    try {
      const license = await send('LICENSE_STATUS');
      if (current === revision) apply(license);
    } catch (error) { if (current === revision) lock(error.message); }
  }
  async function action(type, payload = {}) {
    if (busy) return;
    busy = true; const current = ++revision; controls(); status.textContent = '正在验证授权…';
    try {
      const license = await send(type, payload);
      if (current === revision) apply(license);
    } catch (error) { if (current === revision) lock(error.message); }
    finally { busy = false; controls(); }
  }
  form.addEventListener('submit', event => {
    event.preventDefault();
    const code = input.value.trim(); input.value = '';
    if (code) void action('LICENSE_ACTIVATE', {code});
  });
  verify.addEventListener('click', () => { void action('LICENSE_VERIFY'); });
  refresh.addEventListener('click', () => { void action('LICENSE_STATUS'); });
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== chrome.runtime.id || message.type !== 'LICENSE_CHANGED') return;
    // Revocation is fail-closed immediately; a validity notification triggers an
    // authoritative read instead of trusting its supplied validity flag.
    if (message.license?.valid === false) lock(message.license.message);
    else void read();
  });
  const poll = async () => {
    if (!busy) await read();
    if (!disposed) timer = setTimeout(poll, 5000);
  };
  window.addEventListener('pagehide', () => { disposed = true; clearTimeout(timer); input.value = ''; });
  controls(); void poll();
  return ready;
}
