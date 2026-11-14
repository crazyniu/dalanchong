/**
 * AI module map
 * Purpose: register extension-owned message handlers without claiming other routes.
 * Entry: background modules call listenMessages with their handled message types.
 * Flow: same-extension requests pass the central license gate before reaching their
 * matching handler. Delayed business replies are rejected after license epoch changes.
 * Boundary: sender/type filtering applies to every declared route.
 */
import {initializeLicense, requireLicense, licenseEpoch, trustedLicensePage} from './license-background.js';

const UNLICENSED = new Set(['LICENSE_STATUS', 'LICENSE_ACTIVATE', 'LICENSE_VERIFY',
  'INVITE_STATUS', 'INVITE_ACTIVATE', 'INVITE_VERIFY', 'INVITE_STOP']);
const LICENSE_WRITES = new Set(['LICENSE_ACTIVATE', 'LICENSE_VERIFY', 'INVITE_ACTIVATE', 'INVITE_VERIFY']);
export function listenMessages(types, handler) {
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !types.has(message?.type)) return;
    if (LICENSE_WRITES.has(message.type) && !trustedLicensePage(sender)) {
      respond({ok: false, success: false, error: '只能从插件页面操作授权'}); return;
    }
    void (async () => {
      const protectedRoute = !UNLICENSED.has(message.type);
      if (protectedRoute) {
        await initializeLicense();
        requireLicense();
      }
      const epoch = licenseEpoch();
      const reply = value => {
        try {
          if (protectedRoute) requireLicense(epoch);
          respond(value);
        } catch (error) { respond({ok: false, success: false, error: error.message, license: true}); }
      };
      await handler(message, sender, reply);
    })().catch(error => respond({ok: false, success: false, error: error.message, license: Boolean(error.license)}));
    return true;
  });
}
