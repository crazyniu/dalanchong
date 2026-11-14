/**
 * AI module map
 * Purpose: one worker-wide license owner, authorization events and periodic verification.
 * Boundary: no business imports; subscribers cancel their own operations on revocation.
 * Secrets remain in invite-license; broadcasts contain only its safe status DTO.
 */
import {inviteLicense} from './invite-license.js';

const listeners = new Set();
const ALARM = 'extension-license-verify';
let initialization, lastState, epoch = 0, watchdog;
export const licenseEpoch = () => epoch;
export const licenseStatus = () => inviteLicense.status();
export function trustedLicensePage(sender) {
  if (sender.id !== chrome.runtime.id) return false;
  try {
    const url = new URL(sender.url);
    const own = new URL(chrome.runtime.getURL('/'));
    if (url.protocol !== own.protocol || url.host !== own.host ||
        !['/popup.html', '/manager.html', '/preview.html', '/settings.html'].includes(url.pathname)) return false;
    // An extension iframe embedded in a remote website is not an activation surface.
    if (sender.tab?.url) {
      const tab = new URL(sender.tab.url);
      if (tab.protocol !== own.protocol || tab.host !== own.host) return false;
    }
    return true;
  } catch { return false; }
}
export function onLicenseChange(listener) {
  listeners.add(listener);
  if (lastState) Promise.resolve().then(() => listener({...lastState})).catch(() => {});
  return () => listeners.delete(listener);
}
export async function publishLicenseState() {
  const state = licenseStatus();
  if (lastState && JSON.stringify(lastState) === JSON.stringify(state)) return state;
  if (!state.valid || (lastState && state.principalId !== lastState.principalId)) epoch++;
  lastState = state;
  // Subscribers start cancellation before any UI broadcasts are awaited.
  const work = [...listeners].map(listener => {
    try { return Promise.resolve(listener({...state})).catch(() => {}); } catch { return Promise.resolve(); }
  });
  const message = {type: 'LICENSE_CHANGED', license: state};
  work.push(chrome.runtime.sendMessage(message).catch(() => {}));
  work.push(chrome.tabs.query({}).then(tabs => Promise.all(tabs.map(tab =>
    chrome.tabs.sendMessage(tab.id, message).catch(() => {})))).catch(() => {}));
  await Promise.all(work);
  return state;
}
export function requireLicense(expectedEpoch) {
  try {
    const state = inviteLicense.requireValid();
    if (expectedEpoch !== undefined && expectedEpoch !== epoch)
      throw Object.assign(new Error('授权状态已改变，操作已停止，请重新开始'), {license: true, beforeSend: true});
    return state;
  } catch (error) { void publishLicenseState(); throw error; }
}
export function initializeLicense() {
  if (!initialization) initialization = (async () => {
    try { await inviteLicense.initialize(); }
    finally { await publishLicenseState(); }
    await chrome.alarms.create(ALARM, {periodInMinutes: 10});
    watchdog = setInterval(() => { void publishLicenseState(); }, 1000);
    return licenseStatus();
  })().catch(error => { initialization = undefined; throw error; });
  return initialization;
}
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== ALARM) return;
  void initializeLicense().then(async () => {
    try { await inviteLicense.verify(); } finally { await publishLicenseState(); }
  }).catch(() => {});
});
const TYPES = new Set(['LICENSE_STATUS', 'LICENSE_ACTIVATE', 'LICENSE_VERIFY']);
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !TYPES.has(message?.type)) return;
  if (message.type !== 'LICENSE_STATUS' && !trustedLicensePage(sender)) {
    respond({ok: false, error: '只能从插件页面操作授权'}); return;
  }
  void (async () => {
    await initializeLicense();
    try {
      if (message.type === 'LICENSE_ACTIVATE') await inviteLicense.activate(message.code);
      if (message.type === 'LICENSE_VERIFY') await inviteLicense.verify();
    } finally { await publishLicenseState(); }
    return {ok: true, license: licenseStatus()};
  })().then(respond, error => respond({ok: false, error: error.message, license: licenseStatus()}));
  return true;
});
