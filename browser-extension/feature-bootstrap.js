/** Inert Chrome 116 frame bootstrap: no DOM UI, network capture or business logic. */
(() => {
  if (globalThis.__dlcFeatureBootstrap) { globalThis.__dlcFeatureBootstrap(); return; }
  let pending = Promise.resolve();
  function request(phase) {
    pending = pending.catch(() => {}).then(() =>
      chrome.runtime.sendMessage({type: 'REQUEST_FRAME_FEATURES', phase})).catch(() => {});
  }
  function refresh() { request(document.readyState === 'loading' ? 'document_start' : 'all'); }
  globalThis.__dlcFeatureBootstrap = refresh;
  chrome.runtime.onMessage.addListener((message, sender) => {
    if (sender.id === chrome.runtime.id && message?.type === 'LICENSE_CHANGED' && message.license?.valid) refresh();
  });
  refresh();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => request('document_idle'), {once: true});
})();
