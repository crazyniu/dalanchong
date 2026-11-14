/**
 * AI module map
 * Purpose: sole worker owner of standalone invitation sessions, licensing and jobs.
 * Entry: only exact extension invite.html senders may invoke fixed INVITE_* routes.
 * Flow: explicit preparation pins a Chromium document and account; native-looking
 * platform calls use that document, while IndexedDB owns account-scoped history.
 * State: sessions and running jobs are transient; restart recovery marks uncertainty,
 * never resumes sends. Business data stays local. License traffic uses its own module.
 * Boundary: no content-script calls, arbitrary URLs/scripts, cloud data sync, or
 * automatic activation. Invalid authorization stops work; Stop is always available.
 */
import {listenMessages} from './messages.js';
import {openInviteStore} from './invite-store.js';
import {inviteLicense} from './invite-license.js';
import {initializeLicense, publishLicenseState, onLicenseChange, licenseEpoch, requireLicense} from './license-background.js';
import {prepareObservation, readObservation} from './invite-observation.js';
import {createInvitationConnection, refreshInvitationIdentity} from './invite-browser.js';
import {createInviteRuntime} from './invite-runtime.js';

const sessions = new Map();
let initialized, store, runtime;
onLicenseChange(state => { if (!state.valid) { runtime?.stopAll(); sessions.clear(); } });
async function initialize() {
  if (!initialized) initialized = (async () => {
    store = await openInviteStore();
    await initializeLicense();
    runtime = createInviteRuntime({store, license: inviteLicense});
  })().catch(error => { initialized = null; throw error; });
  await initialized;
}
async function state() {
  const tasks = new Map();
  for (const session of sessions.values()) if (session.scope) {
    for (const task of await store.listTasks(session.scope, {limit: 1000})) tasks.set(task.id, {...task, platform: session.scope.platform, platformAccountId: session.scope.platformAccountId});
  }
  for (const task of runtime.status()) tasks.set(task.id, task);
  return {license: inviteLicense.status(), tasks: [...tasks.values()].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 20)};
}
function sessionFor(id) {
  const session = sessions.get(id);
  if (!session) throw new Error('准备状态已失效，请重新准备来源页面');
  return session;
}
async function observe(session) {
  let observation;
  try { observation = await readObservation(session.page); }
  catch (error) { if (session.scope) runtime.stop(session.scope); throw error; }
  if (observation.account) session.account = observation.account;
  else if (session.account) observation.account = session.account;
  observation.readiness = observation.account?.status === 'online' && !!observation.capture;
  if (session.scope && (observation.account?.status !== 'online' || observation.account.shopId !== session.scope.platformAccountId)) {
    runtime.stop(session.scope);
    throw new Error('平台账号已退出或发生变化，请重新准备来源页面');
  }
  if (!session.scope && observation.account?.status === 'online') {
    const status = inviteLicense.status();
    session.scope = {userId: status.principalId, platform: session.page.platform, platformAccountId: observation.account.shopId};
    await runtime.recoverScope(session.scope);
    session.connection = createInvitationConnection(session.page, inviteLicense, session.scope);
  }
  return observation;
}
function requireScope(session) {
  if (!session.scope) throw new Error('尚未识别当前登录的平台账号');
  inviteLicense.requireValid(session.scope);
  return session.scope;
}
async function handle(message) {
  await initialize();
  if (message.type === 'INVITE_STATUS') return state();
  if (message.type === 'INVITE_ACTIVATE') {
    runtime.stopAll();
    try { await inviteLicense.activate(message.code); } finally { await publishLicenseState(); }
    return state();
  }
  if (message.type === 'INVITE_VERIFY') {
    try { await inviteLicense.verify(); } finally { await publishLicenseState(); }
    if (!inviteLicense.status().valid) runtime.stopAll();
    return state();
  }
  if (message.type === 'INVITE_PREPARE') {
    const epoch = licenseEpoch();
    requireLicense(epoch);
    if (!Number.isInteger(message.tabId) || !['douyin', 'kuaishou'].includes(message.platform)) throw new Error('来源选择无效');
    const page = await prepareObservation(message.tabId, message.platform);
    for (const [id, prior] of sessions) if (prior.page.tabId === message.tabId) {
      if (prior.scope) runtime.stop(prior.scope);
      sessions.delete(id);
    }
    requireLicense(epoch);
    const account = await refreshInvitationIdentity(page);
    requireLicense(epoch);
    const session = {page, account};
    let observation;
    for (let i = 0; i < 5; i++) {
      observation = await observe(session);
      if (observation.account) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    requireLicense(epoch);
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, session);
    return {sessionId, observation};
  }
  if (message.type === 'INVITE_STOP') {
    const stoppedSession = sessions.get(message.sessionId);
    if (stoppedSession?.scope) runtime.stop(stoppedSession.scope, message.kind);
    return {};
  }
  const session = sessionFor(message.sessionId);
  if (message.type === 'INVITE_OBSERVE') return {observation: await observe(session)};
  const scope = requireScope(session);
  if (message.type === 'INVITE_CLEAR_LOGS') return {deleted: await store.clearLogs(scope)};
  if (message.type === 'INVITE_LOGS') return {rows: await store.listLogs(scope, {offset: message.offset ?? 0, limit: message.limit ?? 1000})};
  if (message.type === 'INVITE_DELETE_RECORDS') return {deleted: await store.deleteRecords(scope, message.ids)};
  if (message.type === 'INVITE_CONFIG_GET') return {config: await store.getConfig(scope)};
  if (message.type === 'INVITE_CONFIG_SAVE') return {config: await store.saveConfig(scope, message.config)};
  if (message.type === 'INVITE_REVIEW') return {record: await store.resolveReview(scope, message.talentId, message.result)};
  if (message.type === 'INVITE_TASKS') return {rows: await store.listTasks(scope, {limit: 1000})};
  if (message.type === 'INVITE_TALENT_IDS') return {ids: await store.listTalentIds(scope, message.filters)};
  if (message.type === 'INVITE_EXPORT') return {rows: await store.exportRows(scope, message.filters, message.view === 'records')};
  if (message.type === 'INVITE_DELETE_TALENTS') return {deleted: await store.deleteTalents(scope, message.ids)};
  if (message.type === 'INVITE_TALENTS' || message.type === 'INVITE_RECORDS') {
    const page = {offset: message.offset ?? 0, limit: message.limit ?? 20, filters: message.filters};
    return {rows: await (message.type === 'INVITE_TALENTS' ? store.listTalents(scope, page) : store.listInvitations(scope, page))};
  }
  const observation = await observe(session);
  if (message.type === 'INVITE_COLLECT') return {task: await runtime.startCollection(scope, session.connection, observation.capture)};
  if (message.type === 'INVITE_SEND') return {task: await runtime.startInvitation(scope, session.connection, message.config, message.ids)};
  throw new Error('不支持的邀约操作');
}
const types = new Set(['INVITE_STATUS', 'INVITE_ACTIVATE', 'INVITE_VERIFY', 'INVITE_PREPARE', 'INVITE_OBSERVE',
  'INVITE_CLEAR_LOGS', 'INVITE_LOGS', 'INVITE_DELETE_RECORDS', 'INVITE_CONFIG_GET', 'INVITE_CONFIG_SAVE', 'INVITE_REVIEW', 'INVITE_TASKS', 'INVITE_TALENT_IDS', 'INVITE_EXPORT', 'INVITE_DELETE_TALENTS', 'INVITE_COLLECT', 'INVITE_SEND', 'INVITE_STOP', 'INVITE_TALENTS', 'INVITE_RECORDS']);
listenMessages(types, (message, sender, respond) => {
  if (sender.url !== chrome.runtime.getURL('invite.html') || sender.tab?.url && sender.tab.url !== chrome.runtime.getURL('invite.html')) {
    respond({ok: false, error: '邀约操作仅允许插件工作区发起'}); return;
  }
  void handle(message).then(payload => respond({ok: true, ...payload}), error => respond({ok: false, error: error.message}));
});
chrome.tabs.onRemoved.addListener(tabId => {
  for (const [id, session] of sessions) if (session.page.tabId === tabId) {
    if (session.scope) runtime?.stop(session.scope);
    sessions.delete(id);
  }
});
chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (!changes.url && changes.status !== 'loading') return;
  for (const [id, session] of sessions) if (session.page.tabId === tabId) {
    if (session.scope) runtime?.stop(session.scope);
    sessions.delete(id);
  }
});
