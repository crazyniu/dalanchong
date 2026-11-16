/**
 * AI module map
 * Purpose: attach the workspace to an authorized page observer and read its source snapshot.
 * Entry: prepareObservation returns a session; read/watch provide validated observations.
 * Flow: fixed MAIN function pulls bounded snapshots; shared classifiers/parsers interpret data.
 * State: session pins browser document ID, route and page document nonce; versions reject regressions.
 * Boundary: observed account information is not authorization. No collection, replay or invitation sends.
 * Side effects: existing-tab lookup, explicit scripting injection and optional cancellable polling only.
 */
import {requireLicense, licenseEpoch} from '../../background/license-background.js';
import {invitationObserver} from '../content/invite-observer.js';
import {invitationSource} from '../shared/invite-sources.js';
import {classifyObservedRequest, interpretObservedResponse} from '../core/platform.mjs';

const limit = 2 * 1024 * 1024;

function assertRoute(platform, url) {
  if (invitationSource(url)?.platform !== platform) throw Error('来源页面已改变，请重新准备。');
}

async function invoke(session, action, payload = {}) {
  requireLicense(session.licenseEpoch);
  const results = await chrome.scripting.executeScript({
    target: {tabId: session.tabId, documentIds: [session.chromeDocumentId]},
    world: 'MAIN', func: invitationObserver, args: [session.platform, action, {...payload, expected: {documentId: session.pageDocumentId,
      pageUrl: session.pageUrl, routeRevision: session.routeRevision}}],
  });
  requireLicense(session.licenseEpoch);
  const result = results.find(item => item.frameId === 0 && item.documentId === session.chromeDocumentId);
  if (!result || result.error) throw Error('来源文档已关闭或改变，请重新准备。');
  return result.result;
}

function validateSnapshot(session, snapshot) {
  if (!snapshot || snapshot.documentId !== session.pageDocumentId ||
      snapshot.pageUrl !== session.pageUrl || snapshot.routeRevision !== session.routeRevision)
    throw Error('来源路由已改变，请重新准备。');
  assertRoute(session.platform, snapshot.pageUrl);
  if (!Array.isArray(snapshot.observations) || snapshot.observations.length > 3)
    throw Error('无效的网页观察数据。');
  const observations = [];
  const kinds = new Set();
  for (const payload of snapshot.observations) {
    const request = payload?.request;
    if (!request || request.documentId !== session.pageDocumentId ||
        request.pageUrl !== session.pageUrl || request.routeRevision !== session.routeRevision ||
        !Number.isSafeInteger(request.sequence) || request.sequence < 1 ||
        !['pending', 'complete'].includes(request.phase)) throw Error('无效的网页请求标识。');
    if (typeof request.url !== 'string' || request.url.length > 16384 ||
        JSON.stringify(request.body ?? null).length > limit) throw Error('网页请求过大。');
    const source = classifyObservedRequest(session.platform, request.url, request.body, session.pageUrl);
    if (!source || source.kind !== request.kind || source.path !== request.path ||
        source.method !== request.method || kinds.has(source.kind)) throw Error('网页请求不属于当前来源。');
    kinds.add(source.kind);
    const previous = session.versions.get(source.kind);
    if (previous && (request.sequence < previous.sequence ||
      request.sequence === previous.sequence && previous.phase === 'complete' && request.phase === 'pending'))
      throw Error('网页观察结果已过期。');
    const observation = {kind: source.kind, sequence: request.sequence, phase: request.phase, request: source};
    if (request.phase === 'complete') {
      if (payload.error) observation.error = String(payload.error).slice(0, 8000);
      else {
        const response = payload.response;
        if (!response || typeof response.text !== 'string' || response.text.length > limit ||
            !Number.isInteger(response.status) || response.status < 0 || response.status > 599 ||
            !Number.isSafeInteger(response.observedAt) || response.observedAt < 1 || response.observedAt > Date.now() + 1000 ||
            typeof response.url !== 'string' || response.url.length > 16384 ||
            new URL(response.url).origin !== new URL(session.pageUrl).origin)
          throw Error('无效的网页响应。');
        try {
          observation.value = interpretObservedResponse(session.platform, source, response.text, {
            status: response.status, url: response.url,
            requestId: typeof response.requestId === 'string' ? response.requestId.slice(0, 256) : '',
          });
          if (observation.value.capture) observation.value.capture.responseAt = response.observedAt;
        } catch (error) { observation.error = error.message; }
      }
    }
    session.versions.set(source.kind, {sequence: request.sequence, phase: request.phase});
    observations.push(observation);
  }
  const account = observations.find(item => item.kind === 'account')?.value?.account || null;
  const capture = observations.find(item => item.kind === 'list')?.value?.capture || null;
  return {tabId: session.tabId, documentId: session.chromeDocumentId, pageUrl: session.pageUrl,
    routeRevision: session.routeRevision, observations, account, capture: capture ? {list: capture} : null,
    readiness: account?.status === 'online' && !!account.shopId && !!capture};
}

export async function prepareObservation(tabId, platform) {
  requireLicense();
  const epoch = licenseEpoch();
  const tab = await chrome.tabs.get(tabId);
  requireLicense(epoch);
  assertRoute(platform, tab.url);
  const gateResults = await chrome.scripting.executeScript({target: {tabId, frameIds: [0]},
    world: 'MAIN', files: ['content/feature-gate.js']});
  requireLicense(epoch);
  const documentId = gateResults.find(item => item.frameId === 0)?.documentId;
  if (!documentId) throw Error('来源文档已改变，请重新准备。');
  const results = await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]},
    world: 'MAIN', func: invitationObserver, args: [platform, 'install', {lifecycleEpoch: epoch}]});
  const result = results.find(item => item.frameId === 0);
  const snapshot = result?.result;
  try { requireLicense(epoch); } catch (error) {
    if (snapshot?.documentId) {
      await chrome.scripting.executeScript({target: {tabId, documentIds: [documentId]},
        world: 'MAIN', func: invitationObserver, args: [platform, 'dispose',
          {expected: {documentId: snapshot.documentId, pageUrl: snapshot.pageUrl, routeRevision: snapshot.routeRevision}}]}).catch(() => {});
    }
    throw error;
  }
  if (result?.error || !result?.documentId || !snapshot || typeof snapshot.documentId !== 'string' ||
      !Number.isSafeInteger(snapshot.routeRevision) || snapshot.routeRevision < 0)
    throw Error('无法准备当前来源页面。');
  assertRoute(platform, snapshot.pageUrl);
  if (snapshot.pageUrl !== tab.url) throw Error('来源页面已改变，请重新准备。');
  const session = {tabId, platform, licenseEpoch: epoch, chromeDocumentId: result.documentId,
    pageDocumentId: snapshot.documentId, pageUrl: snapshot.pageUrl,
    routeRevision: snapshot.routeRevision, versions: new Map()};
  validateSnapshot(session, snapshot);
  return session;
}

export async function readObservation(session) {
  return validateSnapshot(session, await invoke(session, 'snapshot'));
}

export async function readIdentityObservation(session) {
  return validateSnapshot(session, await invoke(session, 'identity'));
}

export async function markOwnObservation(session, path, body) {
  const url = new URL(path, session.pageUrl);
  if (!classifyObservedRequest(session.platform, url.href, body, session.pageUrl))
    throw Error('不能标记当前来源以外的请求。');
  return invoke(session, 'markOwn', {path, body});
}

export function releaseOwnObservation(session, handle) {
  return invoke(session, 'releaseOwn', {handle});
}

export function watchObservation(session, onSnapshot, onError, interval = 1000) {
  let stopped = false, timer;
  const poll = async () => {
    try {
      const snapshot = await readObservation(session);
      if (!stopped) onSnapshot(snapshot);
    } catch (error) {
      if (!stopped) onError(error);
      stopped = true;
    }
    if (!stopped) timer = setTimeout(poll, Math.max(500, interval));
  };
  void poll();
  return () => { stopped = true; clearTimeout(timer); };
}
