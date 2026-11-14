/**
 * AI module map
 * Purpose: open popup-selected videos in the current webpage's center.
 * Entry: PREVIEW_MEDIA from popup.html supplies a verified session media ID and tab ID.
 * Flow: an isolated top-layer host embeds preview.html; its ready reply acknowledges
 * the rendered player before the popup request succeeds. CDN URLs stay in storage.
 * Ownership: each webpage owns one host, frame, readiness timeout and close listener.
 * Boundary: accept only this extension's popup; validate frame origin, source and nonce.
 * License revocation closes pending and visible owners; epoch checks prevent stale
 * async opens after reactivation. Worker restart cleanup queries existing web tabs.
 * The manual popover and embedded player never request focus or close the popup.
 */
import {listenMessages} from './messages.js';
import {onLicenseChange, licenseEpoch, requireLicense} from './license-background.js';

const workerId = crypto.randomUUID();
async function closePreviews(epoch) {
  const tabs = await chrome.tabs.query({url: ['http://*/*', 'https://*/*']});
  await Promise.all(tabs.map(tab => chrome.scripting.executeScript({
    target: {tabId: tab.id},
    func: (cutoff, owner) => {
      const preview = globalThis.__dalanchongVideoPreview;
      if (preview && (preview.workerId !== owner || preview.epoch < cutoff)) preview.close();
    }, args: [epoch, workerId],
  }).catch(() => {})));
}
let lastEpoch = licenseEpoch();
onLicenseChange(state => {
  const epoch = licenseEpoch();
  const cleanup = !state.valid || epoch !== lastEpoch ? closePreviews(epoch) : undefined;
  lastEpoch = epoch;
  return cleanup;
});

async function previewMedia(mediaId, tabId) {
  requireLicense();
  const epoch = licenseEpoch();
  const stored = await chrome.storage.session.get(`media:${mediaId}`);
  requireLicense(epoch);
  const item = stored[`media:${mediaId}`];
  if (!item?.mediaVerified || item.kind !== 'video') throw new Error('视频记录已清除，请刷新列表。');
  const tab = await chrome.tabs.get(tabId);
  requireLicense(epoch);
  if (!/^https?:\/\//.test(tab.url)) throw new Error('请在普通网页中打开视频预览。');
  const url = new URL(chrome.runtime.getURL('preview.html'));
  const previewId = crypto.randomUUID();
  url.searchParams.set('media', mediaId);
  url.searchParams.set('preview', previewId);
  url.searchParams.set('parent', new URL(tab.url).origin);
  const [injection] = await chrome.scripting.executeScript({
    target: {tabId},
    func: (frameURL, previewId, origin, epoch, workerId) => new Promise(resolve => {
      globalThis.__dalanchongVideoPreview?.close();
      const host = document.createElement('div');
      host.popover = 'manual';
      host.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;max-width:none;max-height:none;margin:0;padding:0;border:0;background:transparent;overflow:hidden';
      const shadow = host.attachShadow({mode: 'closed'});
      const frame = document.createElement('iframe');
      frame.title = '视频预览';
      frame.src = frameURL;
      frame.allow = 'autoplay; fullscreen';
      frame.allowFullscreen = true;
      frame.style.cssText = 'display:block;width:100%;height:100%;border:0;background:transparent';
      let pending = true, closed = false;
      const licenseChanged = (message, sender) => {
        if (sender.id === chrome.runtime.id && message.type === 'LICENSE_CHANGED' && message.license?.valid !== true) close();
      };
      const finish = result => {
        if (!pending) return;
        pending = false;
        clearTimeout(timer);
        resolve(result);
      };
      const close = () => {
        if (closed) return;
        closed = true;
        chrome.runtime.onMessage.removeListener(licenseChanged);
        frame.src = 'about:blank';
        finish({ok: false, error: '预览已关闭。'});
        window.removeEventListener('message', receive);
        window.removeEventListener('pagehide', close);
        host.remove();
        if (globalThis.__dalanchongVideoPreview?.previewId === previewId) delete globalThis.__dalanchongVideoPreview;
      };
      const receive = event => {
        if (event.source !== frame.contentWindow || event.origin !== origin ||
            event.data?.previewId !== previewId) return;
        if (event.data.type === 'DALANCHONG_CLOSE_PREVIEW') close();
        if (event.data.type === 'DALANCHONG_PREVIEW_READY') {
          finish({ok: event.data.ok === true, error: event.data.error});
          if (!event.data.ok) close();
        }
      };
      const timer = setTimeout(() => {
        finish({ok: false, error: '预览未能打开，请刷新当前网页后重试。'});
        close();
      }, 10000);
      window.addEventListener('message', receive);
      window.addEventListener('pagehide', close, {once: true});
      globalThis.__dalanchongVideoPreview = {close, epoch, previewId, workerId};
      chrome.runtime.onMessage.addListener(licenseChanged);
      // Gate the pending injection too: revocation can arrive while this async
      // status response or iframe load is outstanding. A closed owner never reopens.
      chrome.runtime.sendMessage({type: 'LICENSE_STATUS'}).then(status => {
        if (closed) return;
        if (!status?.ok || status.license?.valid !== true) { close(); return; }
        shadow.append(frame);
        document.documentElement.append(host);
        // A manual popover enters the top layer without dialog focusing steps.
        host.showPopover();
      }).catch(() => close());
    }),
    args: [url.href, previewId, chrome.runtime.getURL('').slice(0, -1), epoch, workerId],
  });
  try { requireLicense(epoch); } catch (error) {
    await chrome.scripting.executeScript({target: {tabId}, func: id => {
      const preview = globalThis.__dalanchongVideoPreview;
      if (preview?.previewId === id) preview.close();
    }, args: [previewId]}).catch(() => {});
    throw error;
  }
  if (injection?.result?.ok !== true) throw new Error(injection?.result?.error || '预览未能打开，请刷新当前网页后重试。');
}

listenMessages(new Set(['PREVIEW_MEDIA']), (message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL('popup.html')) {
    respond({error: '此页面无权打开视频预览。'});
    return;
  }
  previewMedia(message.mediaId, message.tabId).then(() => respond({ok: true}),
    error => respond({error: error.message}));
});
