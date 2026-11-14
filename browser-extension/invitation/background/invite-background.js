/**
 * AI module map
 * Purpose: sole worker owner of scoped invitation sessions, licensing and jobs.
 * Entry: verified extension panels and top-frame toolbar use fixed scoped routes.
 * Flow: explicit preparation pins a Chromium document and account; native-looking
 * platform calls use that document, while IndexedDB owns account-scoped history.
 * State: sessions and running jobs are transient; restart recovery marks uncertainty,
 * never resumes sends. Business data stays local. License traffic uses its own module.
 * Boundary: no page-message bridge, arbitrary URLs/scripts, cloud data sync, or
 * automatic activation. Invalid authorization stops work; Stop is always available.
 */
import {createWorkspaceConnections} from './workspace-connection.js';
import {queryInvitationData} from './invite-query.js';
import {invitationSurface, selectedExport} from '../shared/invite-surface.js';
import {listenMessages} from '../../background/messages.js';
import {openInviteStore} from './invite-store.js';
import {inviteLicense} from './invite-license.js';
import {initializeLicense, publishLicenseState, onLicenseChange, licenseEpoch, requireLicense} from '../../background/license-background.js';
import {prepareObservation, readObservation} from './invite-observation.js';
import {createInvitationConnection, refreshInvitationIdentity} from './invite-browser.js';
import {createInviteRuntime} from './invite-runtime.js';

const sessions = new Map();
const preparing = new Map();
let initialized, store, runtime;
const workspaceConnections = createWorkspaceConnections({runtime:chrome.runtime,initialize:initializeLicense,verify:requireLicense,onExpire(owner) {
  for (const [id,session] of sessions) if (session.owners.delete(owner)) {
    if (session.scope) runtime?.stop(session.scope);
    if (!session.owners.size) sessions.delete(id);
  }
}});
onLicenseChange(state => { if (!state.valid) { workspaceConnections.closeAll(); runtime?.stopAll(); sessions.clear(); } });
async function initialize() {
  if (!initialized) initialized = (async () => {
    store = await openInviteStore();
    await initializeLicense();
    runtime = createInviteRuntime({store, license: inviteLicense});
  })().catch(error => { initialized = null; throw error; });
  await initialized;
}
async function state(surface) {
  const epoch = licenseEpoch();
  const license = inviteLicense.status();
  if (!license.valid) return {license,tasks:[]};
  const tasks = new Map(), scopes = new Set();
  for (const session of sessions.values()) if (session.scope && session.owners.has(surface.owner) &&
      (surface.kind === 'page' || session.page.tabId === surface.tabId && session.page.platform === surface.source.platform)) {
    scopes.add(`${session.scope.platform}:${session.scope.platformAccountId}`);
    for (const task of await store.listTasks(session.scope, {limit:1000})) tasks.set(task.id,{...task,platform:session.scope.platform,platformAccountId:session.scope.platformAccountId});
  }
  for (const task of runtime.status()) if (scopes.has(`${task.platform}:${task.platformAccountId}`)) tasks.set(task.id,task);
  if (!inviteLicense.status().valid || licenseEpoch() !== epoch) return {license:inviteLicense.status(),tasks:[]};
  return {license,tasks:[...tasks.values()].sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt)).slice(0,20)};
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
async function handle(message, surface, cancelled = () => false, assertDocument = workspaceConnections.capture(surface)) {
  assertDocument();
  await initialize(); assertDocument();
  if (message.type === 'INVITE_HOST_CONTEXT') return {tabId:surface.tabId, platform:surface.source.platform, sourceName:surface.source.name,sourceOrigin:surface.source.origin};
  if (message.type === 'INVITE_STATUS') return state(surface);
  if (message.type === 'INVITE_ACTIVATE') {
    runtime.stopAll();
    try { await inviteLicense.activate(message.code); } finally { await publishLicenseState(); }
    return state(surface);
  }
  if (message.type === 'INVITE_VERIFY') {
    try { await inviteLicense.verify(); } finally { await publishLicenseState(); }
    if (!inviteLicense.status().valid) runtime.stopAll();
    return state(surface);
  }
  if (message.type === 'INVITE_PREPARE') {
    const epoch = licenseEpoch(); requireLicense(epoch);
    const tabId = surface.kind === 'page' ? message.tabId : surface.tabId;
    const platform = surface.kind === 'page' ? message.platform : surface.source.platform;
    if (!Number.isInteger(tabId) || !['douyin','kuaishou'].includes(platform)) throw new Error('来源选择无效');
    let pending = preparing.get(tabId);
    if (!pending) {
      pending = handle({...message,type:'_PREPARE',tabId,platform},surface,cancelled,assertDocument);
      preparing.set(tabId,pending);
    }
    try {
      const result = await pending; requireLicense(epoch); assertDocument();
      sessionFor(result.sessionId).owners.add(surface.owner);
      return result;
    } finally { if (preparing.get(tabId) === pending) preparing.delete(tabId); }
  }
  if (message.type === '_PREPARE') {
    const epoch = licenseEpoch();
    requireLicense(epoch);
    if (!Number.isInteger(message.tabId) || !['douyin', 'kuaishou'].includes(message.platform)) throw new Error('来源选择无效');
    if (surface.kind === 'embedded' || surface.kind === 'toolbar') {
      message = {...message, tabId:surface.tabId, platform:surface.source.platform};
    }
    for (const [sessionId, existing] of sessions) if (existing.page.tabId === message.tabId && existing.page.platform === message.platform) {
      try {
        const observation = await observe(existing);
        requireLicense(epoch);
        assertDocument(); existing.owners.add(surface.owner);
        return {sessionId, observation};
      } catch { if (existing.scope) runtime.stop(existing.scope); sessions.delete(sessionId); }
    }
    assertDocument();
    const page = await prepareObservation(message.tabId, message.platform); assertDocument();
    for (const [id, prior] of sessions) if (prior.page.tabId === message.tabId) {
      if (prior.scope) runtime.stop(prior.scope);
      sessions.delete(id);
    }
    requireLicense(epoch);
    const account = await refreshInvitationIdentity(page);
    requireLicense(epoch);
    const session = {page, account, owners:new Set([surface.owner])};
    let observation;
    for (let i = 0; i < 5; i++) {
      observation = await observe(session);
      if (observation.account) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    requireLicense(epoch);
    const sessionId = crypto.randomUUID();
    assertDocument(); sessions.set(sessionId, session);
    return {sessionId, observation};
  }
  if (message.type === 'INVITE_STOP') {
    const stoppedSession = sessions.get(message.sessionId);
    if (stoppedSession && !stoppedSession.owners.has(surface.owner)) throw new Error('当前页面无权操作此任务');
    if (stoppedSession?.scope) runtime.stop(stoppedSession.scope, message.kind);
    return {};
  }
  const session = sessionFor(message.sessionId);
  if (!session.owners.has(surface.owner) || surface.kind === 'embedded' && session.page.tabId !== surface.tabId) throw new Error('来源页面不匹配，请重新准备');
  if (message.type === 'INVITE_OBSERVE') return {observation: await observe(session)};
  const scope = requireScope(session);
  if (message.type === 'INVITE_QUERY') return {data:await queryInvitationData(store,scope,message.query)};
  if (message.type === 'INVITE_DELETE_LOGS') {
    if (!Array.isArray(message.ids) || message.ids.length > 10000) throw new Error('日志选择无效');
    return {deleted:await store.clearLogs(scope,message.ids)};
  }
  if (message.type === 'INVITE_CLEAR_LOGS') return {deleted: await store.clearLogs(scope)};
  if (message.type === 'INVITE_LOGS') return {rows: await store.listLogs(scope, {offset: message.offset ?? 0, limit: message.limit ?? 1000})};
  if (message.type === 'INVITE_DELETE_RECORDS') return {deleted: await store.deleteRecords(scope, message.ids)};
  if (message.type === 'INVITE_CONFIG_GET') return {config: await store.getConfig(scope)};
  if (message.type === 'INVITE_CONFIG_SAVE') return {config: await store.saveConfig(scope, message.config)};
  if (message.type === 'INVITE_REVIEW') return {record: await store.resolveReview(scope, message.talentId, message.result)};
  if (message.type === 'INVITE_TASKS') return {rows: await store.listTasks(scope, {limit: 1000})};
  if (message.type === 'INVITE_TALENT_IDS') return {ids: await store.listTalentIds(scope, message.filters, message.excludeInvited === true)};
  if (message.type === 'INVITE_EXPORT') return {rows: selectedExport(await store.exportRows(scope, message.ids ? {} : message.filters, message.view === 'records'), message.ids, message.view === 'records')};
  if (message.type === 'INVITE_DELETE_TALENTS') return {deleted: await store.deleteTalents(scope, message.ids)};
  if (message.type === 'INVITE_TALENTS' || message.type === 'INVITE_RECORDS') {
    const page = {offset: message.offset ?? 0, limit: message.limit ?? 20, filters: message.filters};
    if (message.type === 'INVITE_TALENTS') {
      const [rows, sources] = await Promise.all([store.listTalents(scope, page), store.listTalentSources(scope)]);
      return {rows, sources};
    }
    return {rows: await store.listInvitations(scope, page)};
  }
  const observation = await observe(session); assertDocument();
  if (message.type === 'INVITE_COLLECT') return {task: await runtime.startCollection(scope, session.connection, observation.capture, () => { try { assertDocument(); return cancelled(); } catch { return true; } })};
  if (message.type === 'INVITE_SEND') return {task: await runtime.startInvitation(scope, session.connection, message.config, message.ids)};
  throw new Error('不支持的邀约操作');
}
const types = new Set(['INVITE_STATUS', 'INVITE_ACTIVATE', 'INVITE_VERIFY', 'INVITE_PREPARE', 'INVITE_OBSERVE',
  'INVITE_QUERY', 'INVITE_DELETE_LOGS', 'INVITE_CLEAR_LOGS', 'INVITE_LOGS', 'INVITE_DELETE_RECORDS', 'INVITE_CONFIG_GET', 'INVITE_CONFIG_SAVE', 'INVITE_REVIEW', 'INVITE_TASKS', 'INVITE_TALENT_IDS', 'INVITE_EXPORT', 'INVITE_DELETE_TALENTS', 'INVITE_COLLECT', 'INVITE_SEND', 'INVITE_STOP', 'INVITE_TALENTS', 'INVITE_RECORDS']);
types.add('INVITE_HOST_CONTEXT');
listenMessages(types, (message, sender, respond) => {
  const surface = invitationSurface(sender, chrome.runtime);
  if (!surface || surface.kind === 'toolbar' || message.type === 'INVITE_HOST_CONTEXT' && surface.kind !== 'embedded') {
    respond({ok:false,error:'邀约操作仅允许插件工作区发起'}); return;
  }
  void handle(message, surface).then(payload => respond({ok:true,...payload}), error => respond({ok:false,error:error.message}));
});
const toolbarTypes = new Set(['INVITE_TOOLBAR_STATUS','INVITE_TOOLBAR_COLLECT','INVITE_TOOLBAR_STOP','INVITE_TOOLBAR_NAV']);
listenMessages(toolbarTypes, (message, sender, respond) => {
  const surface = invitationSurface(sender, chrome.runtime);
  if (surface?.kind !== 'embedded') { respond({ok:false,error:'来源页面不匹配'}); return; }
  void toolbar(message, surface).then(payload => respond({ok:true,...payload}), error => respond({ok:false,error:error.message}));
});
const preparations = new Map();
const preparationFailures = new Map();
const toolbarGenerations = new Map();
async function toolbar(message, surface) {
  const assertDocument = workspaceConnections.capture(surface);
  const initialGeneration = toolbarGenerations.get(surface.tabId) || 0;
  const assertCurrent = () => { assertDocument(); if (initialGeneration !== (toolbarGenerations.get(surface.tabId) || 0)) throw Error('来源页面或任务状态已改变，操作已停止'); };
  assertCurrent(); await initialize(); assertCurrent(); const epoch = licenseEpoch(); requireLicense(epoch);
  if (message.type === 'INVITE_TOOLBAR_STOP') toolbarGenerations.set(surface.tabId,(toolbarGenerations.get(surface.tabId) || 0)+1);
  const generation = toolbarGenerations.get(surface.tabId) || 0;
  const check = () => { assertDocument(); if (generation !== (toolbarGenerations.get(surface.tabId) || 0)) throw Error('来源页面或任务状态已改变，操作已停止'); };
  let toolbarObservation = null;
  let entry = [...sessions].find(([, item]) => item.page.tabId === surface.tabId && item.page.platform === surface.source.platform);
  if (entry) {
    try { toolbarObservation = await observe(entry[1]); check(); entry[1].owners.add(surface.owner); }
    catch { if (entry[1].scope) runtime.stop(entry[1].scope); sessions.delete(entry[0]); entry = null; }
  }
  if (message.type === 'INVITE_TOOLBAR_STATUS' && !entry) {
    const last = preparationFailures.get(surface.tabId);
    if (!last || last.url !== surface.source.origin + surface.source.path || Date.now() - last.at > 30000) {
      try {
        check(); const prepared = await handle({type:'INVITE_PREPARE',tabId:surface.tabId,platform:surface.source.platform},surface,()=>false,check);
        entry = [prepared.sessionId,sessionFor(prepared.sessionId)]; toolbarObservation = prepared.observation; preparationFailures.delete(surface.tabId);
      } catch (error) {
        preparationFailures.set(surface.tabId,{url:surface.source.origin + surface.source.path,at:Date.now(),message:error.message});
      }
    }
  }
  if (message.type === 'INVITE_TOOLBAR_COLLECT' && !entry) {
    if (preparations.has(surface.tabId)) throw new Error('正在准备当前页面，请稍候');
    check(); const prepare = handle({type:'INVITE_PREPARE',tabId:surface.tabId,platform:surface.source.platform},surface,()=>false,check);
    preparations.set(surface.tabId,prepare);
    try { const prepared = await prepare; entry = [prepared.sessionId, sessionFor(prepared.sessionId)]; toolbarObservation = prepared.observation; }
    finally { preparations.delete(surface.tabId); }
  }
  const session = entry?.[1];
  const tasks = session?.scope ? runtime.status().filter(t => t.platform === session.scope.platform && t.platformAccountId === session.scope.platformAccountId) : [];
  const active = tasks.filter(t => t.status === 'running');
  requireLicense(epoch);
  if (message.type === 'INVITE_TOOLBAR_NAV') {
    check();
    if (active.length) throw new Error('请先停止当前任务');
    if (message.action === 'back') await chrome.tabs.goBack(surface.tabId);
    else if (message.action === 'forward') await chrome.tabs.goForward(surface.tabId);
    else if (message.action === 'home') await chrome.tabs.update(surface.tabId,{url:surface.source.origin + surface.source.path});
    else throw new Error('导航操作无效');
  }
  check();
  if (message.type === 'INVITE_TOOLBAR_STOP' && session?.scope) runtime.stop(session.scope);
  if (message.type === 'INVITE_TOOLBAR_COLLECT') {
    check();
    await handle({type:'INVITE_COLLECT',sessionId:entry[0]},surface,() => generation !== (toolbarGenerations.get(surface.tabId) || 0),check);
  }
  const total = session?.scope ? (await store.listTalentIds(session.scope, {})).length : 0;
  requireLicense(epoch);
  const current = session?.scope ? runtime.status().filter(t => t.platform === session.scope.platform && t.platformAccountId === session.scope.platformAccountId && t.status === 'running') : [];
  const loggedIn = session?.account?.status === 'online' && !!session?.scope;
  const taskProgress = tasks.slice(-2).map(task => ({kind:task.kind,status:task.status,processed:task.processed,total:task.total,success:task.success,failed:task.failed,skipped:task.skipped,review:task.review,retryAt:task.retryAt,detail:task.detail || ''}));
  return {loggedIn, readiness:loggedIn && toolbarObservation?.readiness === true, tasks:taskProgress, accountName:session?.account?.name || session?.account?.shopName || '',total,
    collecting:current.some(t => t.kind === 'collect'), inviting:current.some(t => t.kind === 'invite'),
    progress:current.map(t => `${t.kind === 'collect' ? '采集' : '邀约'} ${t.processed}/${t.total} · 成功 ${t.success} · 跳过 ${t.skipped} · 失败 ${t.failed} · 待核实 ${t.review}${t.retryAt ? ' · 重试 '+Math.max(0,Math.ceil((t.retryAt-Date.now())/1000))+'秒' : ''}`).join('；'),
    status:session ? '当前账号已就绪' : (preparationFailures.get(surface.tabId)?.message || '请在网页筛选后采集')};
}
function discardTab(tabId) {
  toolbarGenerations.set(tabId,(toolbarGenerations.get(tabId) || 0)+1);
  preparationFailures.delete(tabId);
  for (const [id,session] of sessions) if (session.page.tabId === tabId) {
    if (session.scope) runtime?.stop(session.scope);
    sessions.delete(id);
  }
}
chrome.tabs.onRemoved.addListener(discardTab);
chrome.tabs.onUpdated.addListener((tabId,change) => {
  if (change.url) discardTab(tabId);
});
