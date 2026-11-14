/** License-driven per-document injection. No business scripts are registered persistently. */
import {featureScripts} from './feature-scripts.js';
import {assertInvitationAssets} from './workspace-assets.js';
import {initializeLicense, licenseStatus, licenseEpoch, onLicenseChange} from './license-background.js';

let chain = Promise.resolve();
let desired = false;
let enabled = false;
function matches(url, patterns) {
  return patterns.some(pattern => new RegExp('^' + pattern.split('*').map(part =>
    part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(url));
}
async function stopTabs() {
  const tabs = await chrome.tabs.query({url: ['http://*/*', 'https://*/*']});
  await Promise.all(tabs.map(async tab => {
    for (const world of ['ISOLATED', 'MAIN']) {
      await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true}, world,
        func: () => globalThis.__dlcFeatureGate?.stop()}).catch(() => {});
    }
    for (const script of featureScripts.filter(script => script.css)) {
      await chrome.scripting.removeCSS({target: {tabId: tab.id, allFrames: true}, files: script.css}).catch(() => {});
    }
  }));
}
async function seedTabs() {
  const epoch = licenseEpoch();
  const tabs = await chrome.tabs.query({url: ['http://*/*', 'https://*/*']});
  for (const tab of tabs) {
    if (!desired || !licenseStatus().valid || epoch !== licenseEpoch()) return;
    // Existing tabs predating extension installation do not have the inert bootstrap.
    await chrome.scripting.executeScript({target: {tabId: tab.id, allFrames: true},
      files: ['feature-bootstrap.js'], injectImmediately: true}).catch(() => {});
  }
}
async function reconcile(mustStop = false) {
  // Remove registrations left by earlier builds; all business injection now checks
  // the worker license for each document, including when the worker was asleep.
  await chrome.scripting.unregisterContentScripts({ids: featureScripts.map(script => script.id)}).catch(() => {});
  if (mustStop || !desired || !licenseStatus().valid) {
    enabled = false;
    await stopTabs();
    return;
  }
  if (enabled) return;
  enabled = true;
  await seedTabs();
}
onLicenseChange(state => {
  desired = state.valid === true;
  // Serialize injection and teardown, avoiding a late injection after revocation.
  chain = chain.catch(() => {}).then(() => reconcile(!state.valid));
  return chain;
});
export function initializeFeatureInjection() {
  return initializeLicense().then(() => chain);
}

// Chrome 116 supports document-targeted injection. The inert static bootstrap keeps
// inherited about:blank frames reachable without the Chrome 119 fallback API.
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== 'REQUEST_FRAME_FEATURES' || sender.id !== chrome.runtime.id ||
      !Number.isInteger(sender.tab?.id) || !sender.documentId) return;
  void initializeLicense().then(() => {
    const operation = chain.catch(() => {}).then(async () => {
    const epoch = licenseEpoch();
    if (!desired || !licenseStatus().valid) return {ok: false};
    const url = sender.url || '';
    const blank = /^(about:blank|about:srcdoc)(?:[?#]|$)/.test(url);
    const inherited = /^https?:\/\//.test(sender.origin || '') ? sender.origin + '/' : '';
    const target = {tabId: sender.tab.id, documentIds: [sender.documentId]};
    for (const script of featureScripts) {
      if (!desired || !licenseStatus().valid || epoch !== licenseEpoch()) return {ok: false};
      if (message.phase !== 'all' && message.phase !== script.runAt) continue;
      if ((!script.allFrames && sender.frameId !== 0) ||
          !(matches(url, script.matches) || (blank && script.matchAboutBlank && matches(inherited, script.matches)))) continue;
      if (script.id === 'licensed-invite-toolbar') await assertInvitationAssets();
      if (script.css) await chrome.scripting.insertCSS({target, files: script.css});
      if (!desired || !licenseStatus().valid || epoch !== licenseEpoch()) return {ok: false};
      await chrome.scripting.executeScript({target, world: script.world || 'ISOLATED', files: script.js, injectImmediately: script.runAt === 'document_start'});
    }
    return {ok: true};
    });
    chain = operation.catch(() => {});
    return operation;
  }).then(respond, error => { console.error('网页工具加载失败', error.message); respond({ok: false, error: '网页工具加载失败，请在插件工作区重新打开邀约入口查看提示'}); });
  return true;
});
