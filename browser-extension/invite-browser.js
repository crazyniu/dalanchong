/**
 * AI module map
 * Purpose: adapt the shared platform API to one verified Chromium document.
 * Entry: createInvitationConnection(session, license) returns assertIdentity/api.
 * Flow: read current observed account, check the independent license, suppress own
 * list replays, and inject only the shared fixed request function into MAIN world.
 * Boundary: no arbitrary scripts or remote messages; page data is untrusted and
 * cannot grant authorization. Closed/navigated documents stop, never select a fallback.
 */
import {makeApi, classifyObservedRequest, interpretObservedResponse} from './invitation-core/platform.mjs';
import {licenseEpoch, requireLicense} from './license-background.js';
import {readObservation, markOwnObservation, releaseOwnObservation} from './invite-observation.js';

export function createInvitationConnection(session, license, scope) {
  const assertIdentity = async expectedScope => {
    let snapshot;
    try { snapshot = await readObservation(session); snapshot.account = await refreshInvitationIdentity(session); }
    catch (error) { throw Object.assign(error, {login: true, beforeSend: true}); }
    if (expectedScope.platform !== session.platform || snapshot.account?.status !== 'online' ||
        snapshot.account.shopId !== expectedScope.platformAccountId)
      throw Object.assign(new Error('平台登录账号已变化，请重新准备'), {login: true, beforeSend: true});
    return snapshot;
  };
  const api = (path, body, method, onResponse, beforeDispatch = () => {}) => makeApi({
    getURL: () => session.pageUrl,
    executePageRequest: async (func, args) => {
      beforeDispatch();
      const epoch = licenseEpoch();
      requireLicense(epoch);
      await license.requireValid(scope);
      await assertIdentity(scope);
      requireLicense(epoch);
      const [, path, body] = args;
      let handle;
      const observed = classifyObservedRequest(session.platform, new URL(path, session.pageUrl).href, body, session.pageUrl);
      if (observed) handle = await markOwnObservation(session, path, body);
      try {
        beforeDispatch();
        requireLicense(epoch);
        const results = await chrome.scripting.executeScript({
          target: {tabId: session.tabId, documentIds: [session.chromeDocumentId]},
          world: 'MAIN', func, args: [...args, session.pageUrl],
        });
        const result = results.find(item => item.frameId === 0 && item.documentId === session.chromeDocumentId);
        if (!result || result.error) throw new Error('平台请求结果不可确认');
        return result.result;
      } finally {
        // A cleanup failure after a successful send must not convert it into a retry.
        if (handle) await releaseOwnObservation(session, handle).catch(() => {});
      }
    },
  }, session.platform)(path, body, method, onResponse);
  return {assertIdentity, api};
}

// An explicit Prepare action refreshes identity inside the selected account page.
// This is read-only, never a quota probe, and returns no cookies or session tokens.
export async function refreshInvitationIdentity(session) {
  const results = await chrome.scripting.executeScript({
    target: {tabId: session.tabId, documentIds: [session.chromeDocumentId]}, world: 'MAIN',
    func: async (platform, expectedUrl) => {
      const origin = platform === 'douyin' ? 'https://buyin.jinritemai.com' : 'https://cps.kwaixiaodian.com';
      if (location.origin !== origin || location.href !== expectedUrl) throw new Error('来源页面已改变');
      const path = platform === 'douyin' ? '/index/getUser' : '/gateway/distribute/match/user/basic/login/info';
      const headers = {};
      if (platform === 'kuaishou') {
        headers.businessKey = '00635321-8464-4815-8d15-45929c610aff';
        const token = document.cookie.split('; ').find(value => value.startsWith('ks-s-ctn='));
        if (token) headers['ks-s-ctn'] = decodeURIComponent(token.slice(9));
      }
      const response = await fetch(path, {credentials: 'include', headers});
      return {text: await response.text(), status: response.status, url: response.url};
    }, args: [session.platform, session.pageUrl],
  });
  const result = results.find(item => item.frameId === 0 && item.documentId === session.chromeDocumentId)?.result;
  if (!result || typeof result.text !== 'string' || result.text.length > 2 * 1024 * 1024)
    throw new Error('无法读取当前平台账号，请在来源页面完成登录');
  const path = session.platform === 'douyin' ? '/index/getUser' : '/gateway/distribute/match/user/basic/login/info';
  const request = classifyObservedRequest(session.platform, new URL(path, session.pageUrl).href, null, session.pageUrl);
  return interpretObservedResponse(session.platform, request, result.text, result).account;
}
