/**
 * AI module map
 * Purpose: license-aware right-click shortcuts to extension-owned pages.
 * Flow: start locked, rebuild on license changes, recheck authorization on click.
 * Boundary: opens pages only; never sends invitations, starts downloads or reads a page.
 */
import {initializeLicense, licenseEpoch, requireLicense, onLicenseChange} from './license-background.js';

import {openInvitationSource} from '../invitation/shared/invite-entry.js';

const destinations = new Map([
  ['dalanchong-video', {title: '视频工作区', page: 'manager.html?view=captured'}],
  ['dalanchong-invite-douyin', {title: '抖音达人邀约', platform:'douyin'}],
  ['dalanchong-invite-kuaishou', {title: '快手达人邀约', platform:'kuaishou'}],
  ['dalanchong-settings', {title: '设置', page: 'settings.html'}],
]);
const activationId = 'dalanchong-activate';
export function createContextMenuController({menus, tabs, windows, runtime, license}) {
  let revision = 0, queue = Promise.resolve(), initialized;
  const callbackCall = (method, ...args) => new Promise((resolve, reject) => {
    method(...args, () => {
      const error = runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve();
    });
  });
  function rebuild(active = false) {
    const requested = ++revision;
    queue = queue.catch(() => {}).then(async () => {
      if (requested !== revision) return;
      await callbackCall(menus.removeAll.bind(menus));
      if (requested !== revision) return;
      let valid = false;
      if (active) { try { license.require(); valid = true; } catch { /* Locked shortcut only. */ } }
      const entries = valid ? [...destinations] : [[activationId, {title: '激活大懒虫', page: 'popup.html'}]];
      for (const [id, item] of entries) {
        if (requested !== revision) return;
        await callbackCall(menus.create.bind(menus), {id, title: item.title, contexts: ['all']});
      }
    });
    return queue;
  }
  async function click(info, sourceTab) {
    const id = String(info.menuItemId);
    if (id !== activationId && !destinations.has(id)) return;
    let page = 'popup.html';
    const epoch = license.epoch();
    if (id !== activationId) {
      try {
        await license.initialize();
        license.require(epoch);
        page = destinations.get(id).page || 'platform';
      } catch { /* A stale menu leads to activation, never into an authorized action. */ }
    }
    if (page === 'platform') {
      await openInvitationSource({tabs, windows, verify:async () => { license.require(epoch); }}, destinations.get(id).platform, sourceTab);
      return;
    }
    const tab = await tabs.create({url: runtime.getURL(page)});
    if (page !== 'popup.html') {
      // A revocation can arrive while Chrome is creating the tab. Its page also
      // gates rendering; redirect this shortcut to activation when still available.
      try { license.require(epoch); }
      catch { if (tab?.id !== undefined) await tabs.update(tab.id, {url: runtime.getURL('popup.html')}).catch(() => {}); }
    }
  }
  function initialize() {
    if (!initialized) {
      menus.onClicked.addListener((info, tab) => { void click(info, tab).catch(() => {}); });
      license.subscribe(state => rebuild(state.valid));
      initialized = rebuild(false).then(async () => {
        try { await license.initialize(); return rebuild(true); }
        catch { return rebuild(false); }
      });
    }
    return initialized;
  }
  return {initialize, rebuild, click};
}
let controller;
export function initializeContextMenus() {
  controller ||= createContextMenuController({menus: chrome.contextMenus, tabs: chrome.tabs, windows:chrome.windows, runtime: chrome.runtime,
    license: {initialize: initializeLicense, epoch: licenseEpoch, require: requireLicense, subscribe: onLicenseChange}});
  return controller.initialize();
}
