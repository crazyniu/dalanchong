/**
 * AI module map
 * Purpose: in-page invitation UI behind the shared license gate, scoped sources, lists and tasks.
 * Entry: invite.html; runtime messages delegate every privileged action to background.
 * Flow: prepare source, observe account, collect, select creators and explicitly submit invitations.
 * State: drafts/selections stay in memory; explicit save persists per-account config through background.
 * Invariants: no auto activation/send; changing source stops old work before losing its stop handle.
 * Side effects: browser tab focus and declared invitation messages; polling only refreshes UI state.
 */
import {talentCopy, talentTableMetrics, deleteTalentSelection} from './invite-list-actions.js';
import {invitationSources, invitationSource} from './invite-sources.js';
import {requirePageLicense} from './license-ui.js';
import {mountLiveLogs} from './invite-live-logs.js';

if (window.top === window) {
  location.replace(chrome.runtime.getURL('popup.html'));
  await new Promise(() => {});
}
await requirePageLicense();
const embedded = new URLSearchParams(location.search).get('embedded') === '1' && window.top !== window;
if (embedded) document.body.dataset.embedded = '';

const $ = id => document.getElementById(id);
const fields = ['products', 'message', 'phone', 'wechat', 'interval', 'limit'];
const drafts = new Map();
const composeScopes = new Map();
let workspaceRestore = Promise.resolve();
let draftScope = null, composeCount = null;
let memoryRevision = 0, memoryTimer;
const loadedScopes = new Set();
const memoryKey = scope => 'invite-workspace:' + scope;
const emptyDraft = () => ({products: '', message: '', phone: '', wechat: '', interval: platform === 'douyin' ? '5000' : '2000', limit: ''});
function rememberDraft() {
  if (draftScope) drafts.set(draftScope, Object.fromEntries(fields.map(field => [field, $(`invite-${field}`).value])));
}
function switchDraftScope(key) {
  if (draftScope === key) return;
  liveLogs.reset();
  clearTimeout(memoryTimer);
  rememberDraft(); void persistWorkspace(); draftScope = key; composeCount = null; memoryRevision++;
  workspaceRestore = key ? restoreWorkspace(key) : Promise.resolve();
  $('compose-sheet').close(); applyPlatformFields();
}
async function persistWorkspace() {
  if (!draftScope) return;
  const key = draftScope;
  rememberDraft();
  try {
    await chrome.storage.session.set({[memoryKey(key)]: {draft: drafts.get(key), talents: [...selected], records: [...selectedRecords], composeWasOpen: composeScopes.get(key) === true}});
  } catch (error) { showError(Error('临时工作区保存失败：' + error.message)); }
}
async function restoreWorkspace(key) {
  if (loadedScopes.has(key)) return;
  loadedScopes.add(key);
  const revision = memoryRevision;
  try {
    const saved = (await chrome.storage.session.get(memoryKey(key)))[memoryKey(key)];
    if (!saved || draftScope !== key || revision !== memoryRevision) return;
    composeScopes.set(key, saved.composeWasOpen === true);
    if (saved.draft && fields.every(field => typeof saved.draft[field] === 'string')) {
      drafts.set(key, Object.fromEntries(fields.map(field => [field, saved.draft[field]])));
      applyPlatformFields();
    }
    for (const [values, set] of [[saved.talents, selected], [saved.records, selectedRecords]]) {
      if (Array.isArray(values) && values.length <= 10000 && values.every(id => typeof id === 'string')) {
        set.clear(); values.forEach(id => set.add(id));
      }
    }
    renderRows();
  } catch (error) { loadedScopes.delete(key); showError(Error('临时工作区恢复失败：' + error.message)); }
}
function queueWorkspaceSave() {
  if (!draftScope) return;
  memoryRevision++; clearTimeout(memoryTimer);
  memoryTimer = setTimeout(() => { void persistWorkspace(); }, 250);
}
for (const event of ['input', 'change', 'click']) document.addEventListener(event, queueWorkspaceSave);
window.addEventListener('pagehide', () => { clearTimeout(memoryTimer); void persistWorkspace(); });
async function eligibleIds() {
  const current = sessionId, scope = draftScope;
  const selectedIds = new Set(selected);
  const result = await request('INVITE_TALENT_IDS', {sessionId: current,
    filters: selectedIds.size ? {} : appliedFilters.talents, excludeInvited: true});
  if (current !== sessionId || scope !== draftScope) throw Error('当前账号已改变，请重新打开邀约配置。');
  if (!Array.isArray(result.ids) || result.ids.some(id => typeof id !== 'string') || result.ids.length > 10000) throw Error('可邀约名单无效。');
  return selectedIds.size ? result.ids.filter(id => selectedIds.has(id)) : result.ids;
}
let platform = 'douyin';
let selectedTabId = null;
let refreshing = false;
let sessionId = null, observation = null, license = {valid: false, hasCode: false};
let busy = false, polling = false, disposed = false, rowEpoch = 0, offset = 0, view = 'talents', rows = [];
const selected = new Set();
const selectedRecords = new Set();
const scopeSelections = new Map();
let selectionScope = null;
let logOffset = 0, logRows = [];
const appliedFilters = {talents: {}, records: {}};
let tasks = [];
const metricColumns = Object.entries({gender:'性别',level:'等级',categories:'主营类目',source:'来源',contentType:'内容类型',salesMode:'销售方式',sales7d:'7 日销售额',sales30d:'30 日销售额',settlement30d:'30 日结算额',liveSales30d:'直播销售额',videoSales30d:'短视频销售额',imageTextSales30d:'图文销售额',windowSales30d:'橱窗销售额',liveCount30d:'30 日直播数',videoCount30d:'30 日视频数',liveViews30d:'直播平均观看',videoViews30d:'视频平均观看',avgLiveSales:'直播平均销售',avgVideoSales:'视频平均销售',cooperationProducts30d:'合作商品数',cooperationLevel:'合作等级',replyRate:'回复率'});
function displayValue(value) {
  if (value == null || value === '') return '—';
  if (Array.isArray(value)) return value.map(displayValue).join(' / ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
const labels = {running: '运行中', queued: '排队中', complete: '已完成', completed: '已完成',
  stopped: '已停止', interrupted: '已中断', success: '成功', failed: '失败', skipped: '已跳过', review: '待核实', sending: '发送中'};

const liveLogs = mountLiveLogs({panel: $('live-logs-panel'), list: $('live-event-logs'), status: $('live-logs-status'),
  followButton: $('follow-live-logs'), labels,
  read: async () => (await request('INVITE_LOGS', {sessionId, offset: 0, limit: 200})).rows});
async function refreshLiveLogs() {
  await liveLogs.refresh(!disposed && license.valid && observation?.account?.status === 'online' && sessionId && draftScope
    ? `${sessionId}:${draftScope}` : null);
}

function textNode(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
for (const source of invitationSources) $('supported-sources').append(textNode('li', source.name));

async function refreshSources() {
  if (refreshing) return;
  const requestedPlatform = platform;
  refreshing = true;
  $('refresh-sources').disabled = true;
  $('focus-source').disabled = true;
  $('source-status').textContent = '正在读取标签页…';
  try {
    const tabs = await chrome.tabs.query({url: ['https://buyin.jinritemai.com/*', 'https://cps.kwaixiaodian.com/*']});
    if (requestedPlatform !== platform) return;
    const sources = tabs.map(tab => ({tab, source: invitationSource(tab.url)}))
      .filter(item => item.source?.platform === requestedPlatform);
    if (!sources.some(({tab}) => tab.id === selectedTabId)) {
      await clearSession(); selectedTabId = null;
    }
    $('source-list').replaceChildren();
    for (const {tab, source} of sources) {
      const row = document.createElement('li');
      const label = textNode('label', '', 'source-row');
      const radio = document.createElement('input');
      radio.type = 'radio'; radio.name = 'source-tab'; radio.value = String(tab.id);
      radio.checked = tab.id === selectedTabId;
      radio.disabled = busy;
      radio.addEventListener('change', () => run(async () => {
        await clearSession(); selectedTabId = tab.id; updateControls();
      }));
      const copy = textNode('span', '', 'source-copy');
      copy.append(textNode('strong', source.name), textNode('span', tab.title || source.name));
      label.append(radio, copy); row.append(label); $('source-list').append(row);
    }
    $('source-status').textContent = sources.length ? `找到 ${sources.length} 个来源页面` : '当前没有打开的来源页面。';
    $('focus-source').disabled = selectedTabId === null;
  } catch (error) { $('source-status').textContent = `无法读取标签页：${error.message}`; }
  finally {
    refreshing = false; updateControls();
    if (requestedPlatform !== platform) void refreshSources();
  }
}
async function openCompose({resume = false} = {}) {
  if (!sessionId || !draftScope || !license.valid) throw Error('请先准备当前账号。');
  const currentScope = draftScope;
  await workspaceRestore;
  if (draftScope !== currentScope) throw Error('当前账号已改变，请重新打开邀约配置。');
  if (resume && composeScopes.get(currentScope) !== true) return;
  const ids = await eligibleIds();
  composeCount = ids.length;
  if (!ids.length) {
    closeCompose();
    throw Error('当前名单没有可邀约达人，已排除所有已有邀约记录。');
  }
  if (!resume) $('invite-limit').value = '';
  rememberDraft();
  $('compose-summary').textContent = `${observation?.account?.shopName || '当前账号'} · 可邀约 ${composeCount} 人（已排除已有记录）`;
  composeScopes.set(currentScope, true);
  if (!$('compose-sheet').open) $('compose-sheet').showModal();
  await persistWorkspace();
}
function closeCompose() {
  if (draftScope) composeScopes.set(draftScope, false);
  $('compose-sheet').close();
  void persistWorkspace();
}
$('open-compose').addEventListener('click', () => run(() => openCompose()));
$('close-compose').addEventListener('click', closeCompose);
$('compose-sheet').addEventListener('cancel', event => { event.preventDefault(); closeCompose(); });
$('refresh-sources').addEventListener('click', refreshSources);
$('focus-source').addEventListener('click', async () => {
  if (selectedTabId === null) return;
  $('focus-source').disabled = true;
  try {
    const tab = await chrome.tabs.get(selectedTabId);
    if (invitationSource(tab.url)?.platform !== platform) throw new Error('来源页面已改变，请刷新列表。');
    await chrome.tabs.update(tab.id, {active: true});
    await chrome.windows.update(tab.windowId, {focused: true});
  } catch (error) { $('source-status').textContent = error.message; }
  finally { $('focus-source').disabled = selectedTabId === null; }
});
$('invite-config').addEventListener('submit', event => {
  event.preventDefault();
  void run(async () => {
    if (!sessionId || !license.valid || !observation?.readiness) throw Error('请确认授权、来源和已选达人。');
    const config = readConfig();
    const ids = await eligibleIds();
    if (!ids.length) throw Error('当前筛选中没有未处理达人。');
    await request('INVITE_SEND', {sessionId, config, ids});
    closeCompose();
    await refreshStatus();
  });
});
$('invite-config').addEventListener('input', () => {
  rememberDraft();
});
$('invite-platform').addEventListener('change', () => run(async () => {
  const nextPlatform = $('invite-platform').value;
  try { await clearSession(); } catch (error) { $('invite-platform').value = platform; throw error; }
  platform = nextPlatform;
  selectedTabId = null;
  $('focus-source').disabled = true;
  $('source-list').replaceChildren();
  void refreshSources();
  applyPlatformFields();
}));
function applyPlatformFields() {
  const draft = draftScope ? drafts.get(draftScope) || emptyDraft() : emptyDraft();
  for (const field of fields) $(`invite-${field}`).value = draft[field];
  const douyin = platform === 'douyin';
  $('contact-hint').textContent = douyin ? '抖音手机号和微信号至少填写一项。' : '快手联系方式可选：填写后覆盖平台联系方式，留空时使用平台返回的联系方式。';
  $('product-hint').hidden = !douyin;
  $('message-hint').hidden = !douyin;
  $('invite-interval').min = douyin ? '5000' : '2000';
}
// Explicit defaults avoid restoring browser form values as persisted task configuration.
$('invite-config').reset();
async function request(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({type, ...payload});
  if (!result?.ok) throw Error(result?.error || '插件后台未响应，请重新加载插件。');
  return result;
}
function showError(error) {
  $('workspace-error').textContent = error.message || String(error);
  $('workspace-error').hidden = false;
}
async function run(action) {
  if (busy) return;
  busy = true; $('workspace-error').hidden = true; updateControls();
  try { await action(); } catch (error) { showError(error); }
  finally { busy = false; updateControls(); }
}
function updateControls() {
  $('prepare-source').disabled = busy || selectedTabId === null;
  $('focus-source').disabled = busy || selectedTabId === null;
  $('refresh-sources').disabled = busy || refreshing;
  $('invite-platform').disabled = busy || embedded;
  $('open-compose').disabled = busy || !sessionId || !license.valid;
  $('collect').disabled = busy || !sessionId || !license.valid || !observation?.readiness;
  $('start-invite').disabled = busy || !sessionId || !license.valid || !observation?.readiness || composeCount === 0;
  $('start-invite').textContent = composeCount === null ? '开始邀约' : `开始邀约（${composeCount} 人）`;
  $('export-rows').textContent = (view === 'talents' ? selected.size : selectedRecords.size) ? '导出所选 CSV' : '导出当前筛选 CSV';
  // Stop is independent of authorization and in-flight action buttons.
  for (const id of ['stop-task', 'stop-collect', 'stop-invite']) $(id).disabled = !sessionId;
  $('delete-talents').textContent = selected.size ? '删除所选达人' : '删除全部达人';
  $('delete-talents').disabled = busy || !sessionId || !license.valid || tasks.some(task => task.status === 'running');
  for (const id of ['select-filtered', 'export-rows', 'save-config', 'load-config', 'load-tasks']) $(id).disabled = busy || !sessionId || !license.valid;
  $('record-selection-status').textContent = `已选 ${selectedRecords.size} 条`;
  $('delete-records').disabled = busy || !sessionId || !license.valid || !selectedRecords.size;
  for (const id of ['delete-filtered-records', 'refresh-logs', 'export-logs', 'clear-logs', 'select-record-page']) $(id).disabled = busy || !sessionId || !license.valid;
  $('previous-logs').disabled = busy || !sessionId || logOffset === 0;
  $('next-logs').disabled = busy || !sessionId || logRows.length < 100;
  $('page-size').disabled = busy;
  $('selection-status').textContent = `已选 ${selected.size} 人`;
  $('select-page').checked = rows.length > 0 && rows.every(row => selected.has(row.id));
  $('select-page').indeterminate = rows.some(row => selected.has(row.id)) && !$('select-page').checked;
  $('select-page').disabled = busy || !sessionId || view !== 'talents' || !rows.length;
  $('previous-page').disabled = busy || !sessionId || offset === 0;
  $('next-page').disabled = busy || !sessionId || rows.length < Number($('page-size').value);
  document.querySelectorAll('input[name="source-tab"]').forEach(input => {
    input.disabled = busy; input.checked = Number(input.value) === selectedTabId;
  });
}
function rememberSelection() {
  if (selectionScope) scopeSelections.set(selectionScope, {talents: [...selected], records: [...selectedRecords]});
}
async function clearSession() {
  rememberSelection(); selectionScope = null;
  if (sessionId) {
    try { await request('INVITE_STOP', {sessionId}); }
    catch (error) {
      if (!error.message.includes('准备状态已失效')) throw error;
    }
  }
  switchDraftScope(null);
  $('task-history').replaceChildren(); $('event-logs').replaceChildren();
  selectedRecords.clear(); logOffset = 0; logRows = [];
  sessionId = null; observation = null; selected.clear(); offset = 0; rows = []; rowEpoch++;
  $('observation-status').textContent = '尚未准备来源。';
  renderRows();
}
function applyObservation(value) {
  observation = value;
  const account = value?.account;
  if (account?.status === 'online' && account.shopId && license.principalId) {
    const key = JSON.stringify([license.principalId, platform, account.shopId]);
    switchDraftScope(key);
    if (selectionScope !== key) {
      rememberSelection(); selectionScope = key; selected.clear(); selectedRecords.clear();
      const saved = scopeSelections.get(key);
      saved?.talents.forEach(id => selected.add(id)); saved?.records.forEach(id => selectedRecords.add(id));
    }
  }
  if (account?.status !== 'online') switchDraftScope(null);
  $('observation-status').textContent = account?.status === 'online'
    ? `${account.shopName || '平台账号'}（${account.shopId}） · ${value.readiness ? '来源已就绪' : '等待当前页面列表响应，请在来源页切换筛选。'}`
    : '尚未观察到有效账号，请在来源页面登录并操作筛选。';
  updateControls();
}
async function refreshStatus() {
  const state = await request('INVITE_STATUS');
  if (license.principalId && (!state.license.valid || state.license.principalId !== license.principalId)) {
    await clearSession(); scopeSelections.clear(); drafts.clear(); loadedScopes.clear();
  }
  license = state.license;
  tasks = state.tasks || []; renderTasks();
  updateControls();
}
async function refreshRows() {
  if (!sessionId || observation?.account?.status !== 'online' || !license.valid) {
    rows = []; renderRows(); return;
  }
  const epoch = ++rowEpoch;
  const result = await request(view === 'talents' ? 'INVITE_TALENTS' : 'INVITE_RECORDS',
    {sessionId, offset, limit: Number($('page-size').value), filters: appliedFilters[view]});
  if (epoch !== rowEpoch) return;
  if (view === 'talents') updateSourceOptions(result.sources || []);
  rows = result.rows; renderRows();
}
function updateSourceOptions(sources) {
  const select = $('filter-source');
  const value = select.value || appliedFilters.talents.source || '';
  const options = [...new Set(sources.filter(source => typeof source === 'string' && source.trim()))];
  select.replaceChildren();
  const all = textNode('option', '全部来源'); all.value = ''; select.append(all);
  for (const source of options) { const option = textNode('option', source); option.value = source; select.append(option); }
  if (value && !options.includes(value)) { const option = textNode('option', `${value}（无匹配数据）`); option.value = value; select.append(option); }
  select.value = value;
  $('filter-source-label').hidden = options.length === 0 && !value;
}
function renderRows() {
  const columns = talentTableMetrics(platform, metricColumns).filter(([key]) => rows.some(row => row[key] != null && row[key] !== ''));
  const head = document.createElement('tr');
  for (const title of view === 'talents' ? ['选择', '达人', '达人 ID', '粉丝', '地区', ...columns.map(([, label]) => label), '操作'] : ['选择', '达人', '达人 ID', '来源', '状态', '时间', '说明', '详情 / 核实'])
    head.append(textNode('th', title));
  $('rows-head').replaceChildren(head); $('rows-body').replaceChildren();
  for (const row of rows) {
    const tr = document.createElement('tr');
    if (view === 'talents') {
      const cell = document.createElement('td'); const check = document.createElement('input');
      check.type = 'checkbox'; check.checked = selected.has(row.id); check.setAttribute('aria-label', `选择${row.name || row.id}`);
      check.addEventListener('change', () => { check.checked ? selected.add(row.id) : selected.delete(row.id); updateControls(); });
      cell.append(check); tr.append(cell);
      for (const value of [row.name || '未命名', row.id, row.fans ?? '—', row.region || '—']) tr.append(textNode('td', String(value)));
      for (const [key] of columns) tr.append(textNode('td', displayValue(row[key])));
      const actions = textNode('td', '', 'row-actions');
      const profile = textNode('button', '主页', 'btn outline'); profile.type = 'button';
      profile.disabled = platform === 'douyin' && !row.uid;
      profile.title = profile.disabled ? '缺少真实 UID，请重新采集' : '在新标签页打开平台主页';
      profile.addEventListener('click', () => run(async () => {
        const url = platform === 'kuaishou'
          ? 'https://cps.kwaixiaodian.com/zone/daren-match/daren-detail?' + new URLSearchParams({promoterId: row.id})
          : 'https://buyin.jinritemai.com/dashboard/servicehall/daren-profile?' + new URLSearchParams({uid: row.uid, enter_from:'1', scene:'1', author_type:'1'});
        await chrome.tabs.create({url});
      }));
      const copied = talentCopy(platform, row);
      const copy = textNode('button', `复制${copied.label}`, 'btn outline'); copy.type = 'button';
      copy.disabled = !copied.value;
      copy.title = copied.value ? `复制${copied.label}` : `缺少${copied.label}`;
      copy.addEventListener('click', () => run(async () => {
        await navigator.clipboard.writeText(copied.value);
        $('rows-status').textContent = `${copied.label}已复制。`;
      }));
      const details = document.createElement('details'); details.className = 'talent-details';
      details.append(textNode('summary', '详情'));
      const values = document.createElement('dl');
      const detailFields = [['uid', 'UID'], ...metricColumns.filter(([key]) => !columns.some(([column]) => column === key))];
      for (const [key, label] of detailFields) {
        if (row[key] == null || row[key] === '') continue;
        values.append(textNode('dt', label), textNode('dd', displayValue(row[key])));
      }
      details.append(values.childElementCount ? values : textNode('p', '暂无更多资料'));
      actions.append(profile, copy, details); tr.append(actions);
    } else {
      const selectionCell = document.createElement('td');
      const check = document.createElement('input'); check.type = 'checkbox'; check.checked = selectedRecords.has(row.id);
      check.setAttribute('aria-label', `选择记录 ${row.name || row.talentId || row.id}`);
      check.addEventListener('change', () => { check.checked ? selectedRecords.add(row.id) : selectedRecords.delete(row.id); updateControls(); });
      selectionCell.append(check); tr.append(selectionCell);
      const timestamp = row.updatedAt || row.createdAt;
      for (const value of [row.name || '—', row.talentId || row.id, row.source || '—', labels[row.status] || row.status,
        timestamp ? new Date(timestamp).toLocaleString('zh-CN') : '—', row.note || '—']) tr.append(textNode('td', String(value)));
    }
    if (view === 'records') {
      const cell = document.createElement('td');
      const profile = textNode('button', '主页', 'btn outline'); profile.type = 'button';
      profile.disabled = platform === 'douyin' && !row.uid;
      profile.title = profile.disabled ? '历史记录缺少 UID，无法打开主页' : '打开平台主页';
      profile.addEventListener('click', () => run(async () => {
        const url = platform === 'kuaishou'
          ? 'https://cps.kwaixiaodian.com/zone/daren-match/daren-detail?' + new URLSearchParams({promoterId: row.talentId || row.id})
          : 'https://buyin.jinritemai.com/dashboard/servicehall/daren-profile?' + new URLSearchParams({uid: row.uid, enter_from:'1', scene:'1', author_type:'1'});
        await chrome.tabs.create({url});
      })); cell.append(profile);
      const details = document.createElement('details'); details.append(textNode('summary', '响应详情'));
      details.append(textNode('pre', row.response == null ? '未保存平台响应。' : JSON.stringify(row.response, null, 2))); cell.append(details);
      if (row.status === 'review') {
        for (const [result, label] of [['success', '确认已发送'], ['not-sent', '确认未发送']]) {
          const button = textNode('button', label, 'btn outline'); button.type = 'button';
          button.addEventListener('click', () => run(async () => {
            const prompt = result === 'not-sent'
              ? '请先在平台人工核实确实未发送。继续会删除此去重记录并允许再次邀约；判断错误可能导致重复发送。确认已核实未发送？'
              : '请先在平台人工核实已成功发送。确认将该记录标为成功？';
            if (!window.confirm(prompt)) return;
            await request('INVITE_REVIEW', {sessionId, talentId: row.talentId, result}); await refreshRows();
          })); cell.append(button);
        }
      }
      tr.append(cell);
    }
    $('rows-body').append(tr);
  }
  $('selection-controls').hidden = view !== 'talents';
  $('record-selection-controls').hidden = view !== 'records';
  $('talent-filters').hidden = view !== 'talents';
  $('record-filters').hidden = view !== 'records';
  for (const [id, enabled] of [['talent-filters', view === 'talents'], ['record-filters', view === 'records']]) {
    $(id).querySelectorAll('input, select').forEach(input => { input.disabled = !enabled; });
  }
  $('rows-status').textContent = !sessionId ? '请先准备来源。' : rows.length ? `本页 ${rows.length} 条` : '暂无记录。';
  $('page-number').textContent = `第 ${Math.floor(offset / Number($('page-size').value)) + 1} 页`;
  updateControls();
}
function readConfig() {
  if (!$('invite-config').reportValidity()) throw Error('请检查配置字段。');
  const config = {products: $('invite-products').value.trim(), message: $('invite-message').value.trim(),
    phone: $('invite-phone').value.trim(),
    wechat: $('invite-wechat').value.trim(),
    interval: Number($('invite-interval').value), maxInvites: $('invite-limit').value === '' ? null : Number($('invite-limit').value)};
  if (!config.products || !config.message) throw Error('请填写商品 ID 和邀约话术。');
  const products = config.products.split(/[\s,，;；]+/).filter(Boolean);
  if (products.some(id => !/^\d+$/.test(id)) || platform === 'douyin' && products.length > 5)
    throw Error('商品 ID 只填写数字，抖音最多 5 个。');
  if (!Number.isInteger(config.interval) || config.interval < (platform === 'douyin' ? 5000 : 2000) || config.interval > 60000 ||
      config.maxInvites !== null && (!Number.isSafeInteger(config.maxInvites) || config.maxInvites < 1))
    throw Error('请填写有效的邀约间隔和最大邀约数。');
  if (platform === 'douyin' && (Array.from(config.message).length > 150 || !config.phone && !config.wechat))
    throw Error('抖音话术不超过 150 字，手机号和微信号至少填写一项。');
  return config;
}
$('prepare-source').addEventListener('click', () => run(async () => {
  await clearSession();
  const result = await request('INVITE_PREPARE', {tabId: selectedTabId, platform});
  sessionId = result.sessionId; applyObservation(result.observation); await refreshRows();
}));
$('collect').addEventListener('click', () => run(async () => { await request('INVITE_COLLECT', {sessionId}); await refreshStatus(); }));
$('stop-task').addEventListener('click', async () => {
  try { await request('INVITE_STOP', {sessionId}); await refreshStatus(); }
  catch (error) { showError(error); }
});
for (const [id, kind] of [['stop-collect', 'collect'], ['stop-invite', 'invite']]) $(id).addEventListener('click', async () => {
  try { await request('INVITE_STOP', {sessionId, kind}); await refreshStatus(); }
  catch (error) { showError(error); }
});
$('refresh-rows').addEventListener('click', () => run(refreshRows));
$('select-page').addEventListener('change', () => {
  for (const row of rows) $('select-page').checked ? selected.add(row.id) : selected.delete(row.id);
  renderRows();
});
$('clear-selection').addEventListener('click', () => { selected.clear(); renderRows(); });
$('delete-talents').addEventListener('click', () => run(async () => {
  const current = sessionId;
  if (!current) return;
  const deleted = await deleteTalentSelection({selected: [...selected],
    listIds: async () => (await request('INVITE_TALENT_IDS', {sessionId: current, filters: {}})).ids,
    confirm: message => current === sessionId && window.confirm(message),
    remove: ids => {
      if (current !== sessionId) throw Error('当前账号已改变，请重新操作。');
      return request('INVITE_DELETE_TALENTS', {sessionId: current, ids});
    },
  });
  if (deleted && current === sessionId) { selected.clear(); offset = 0; await refreshRows(); }
}));
async function showWorkspaceView(target) {
  const resumeCompose = target === 'resume-invite';
  if (resumeCompose) target = 'talents';
  if (target === 'logs') {
    $('logs-panel').open = true;
    $('live-logs-panel').open = true; await refreshLiveLogs();
    await refreshLogs(); $('live-logs-panel').scrollIntoView(); return;
  }
  if (!['talents', 'records'].includes(target)) return;
  view = target; offset = 0;
  $('filter-query').value = appliedFilters[view].query || '';
  for (const name of ['talents', 'records']) {
    $(name + '-tab').className = `btn ${name === view ? 'primary' : 'outline'}`;
    $(name + '-tab').setAttribute('aria-pressed', String(name === view));
  }
  await refreshRows();
  if (resumeCompose) await openCompose({resume: true});
}
for (const target of ['talents', 'records']) $(target + '-tab').addEventListener('click', () => run(() => showWorkspaceView(target)));
window.addEventListener('message', event => {
  if (embedded && event.source === window.parent && event.origin === invitationSources.find(source => source.platform === platform)?.origin && event.data?.type === 'INVITE_RESUME_COMPOSE' && sessionId && license.valid) {
    void run(() => showWorkspaceView('resume-invite'));
  }
});
window.addEventListener('hashchange', () => {
  if (embedded && sessionId && license.valid) void run(() => showWorkspaceView(location.hash.slice(1)));
});
$('page-size').addEventListener('change', () => run(async () => { offset = 0; await refreshRows(); }));
$('previous-page').addEventListener('click', () => run(async () => { offset = Math.max(0, offset - Number($('page-size').value)); await refreshRows(); }));
$('next-page').addEventListener('click', () => run(async () => { offset += Number($('page-size').value); await refreshRows(); }));
$('save-config').addEventListener('click', () => run(async () => {
  const config = readConfig();
  if (!window.confirm('将商品、话术及手机号/微信号按当前平台账号保存在本机浏览器中？此操作不会发送邀约。')) return;
  await request('INVITE_CONFIG_SAVE', {sessionId, config});
  $('rows-status').textContent = '配置已保存至本机。';
}));
$('load-config').addEventListener('click', () => run(async () => {
  const current = sessionId;
  const {config} = await request('INVITE_CONFIG_GET', {sessionId: current});
  if (current !== sessionId) return;
  if (!config) throw Error('当前账号尚无本机配置。');
  for (const field of fields) {
    const value = config[field === 'limit' ? 'maxInvites' : field];
    $(`invite-${field}`).value = value == null ? '' : String(value);
    // Explicitly loaded configuration becomes only this account's in-memory draft.
  }
  rememberDraft();
  $('rows-status').textContent = '已读取当前账号配置，请检查后再开始邀约。';
}));
$('load-tasks').addEventListener('click', () => run(async () => {
  const current = sessionId;
  const result = await request('INVITE_TASKS', {sessionId: current});
  if (current !== sessionId) return;
  $('task-history').replaceChildren();
  for (const task of result.rows) {
    const details = document.createElement('details');
    details.append(textNode('summary', `${task.kind === 'collect' ? '采集' : '邀约'} · ${labels[task.status] || task.status} · ${task.processed || 0}/${task.total || 0} · ${task.createdAt || ''}`));
    details.append(textNode('pre', JSON.stringify(task, null, 2))); $('task-history').append(details);
  }
  if (!result.rows.length) $('task-history').textContent = '暂无本地任务记录。';
}));
function renderTasks() {
  $('task-status').replaceChildren();
  if (!tasks.length) { $('task-status').textContent = '暂无任务。'; return; }
  for (const task of tasks) {
    const seconds = Math.max(0, Math.ceil((Number(task.retryAt) - Date.now()) / 1000));
    const summary = `${task.kind === 'collect' ? '采集' : '邀约'} · ${task.platform || ''} ${task.platformAccountId || ''} · ${labels[task.status] || task.status} · ${task.processed ?? 0} / ${task.total ?? 0}`;
    const detail = `成功 ${task.success ?? 0} / 失败 ${task.failed ?? 0} / 跳过 ${task.skipped ?? 0} / 待核实 ${task.review ?? 0}`;
    $('task-status').append(textNode('span', [summary, detail, task.current || task.error || '', seconds > 0 ? `${seconds} 秒后重试` : ''].filter(Boolean).join('；'), 'task-line'));
  }
}
function readFilters() {
  const result = {query: $('filter-query').value.trim()};
  if (view === 'talents') {
    Object.assign(result, {invitationStatus: $('filter-invitation').value, gender: $('filter-gender').value, source: $('filter-source').value.trim()});
    for (const [key, id] of [['minFans','filter-min-fans'],['maxFans','filter-max-fans']]) {
      if ($(id).value !== '') {
        const value = Number($(id).value);
        if (!Number.isSafeInteger(value) || value < 0) throw Error('粉丝数量必须是非负整数。');
        result[key] = value;
      }
    }
    if (result.minFans !== undefined && result.maxFans !== undefined && result.minFans > result.maxFans) throw Error('最少粉丝不能大于最多粉丝。');
  } else {
    result.status = $('filter-status').value;
    if ($('filter-from').value) result.from = new Date($('filter-from').value + 'T00:00:00').toISOString();
    if ($('filter-to').value) result.to = new Date($('filter-to').value + 'T23:59:59.999').toISOString();
    if (result.from && result.to && result.from > result.to) throw Error('开始日期不能晚于结束日期。');
  }
  return result;
}
$('list-filters').addEventListener('submit', event => {
  event.preventDefault(); void run(async () => {
    appliedFilters[view] = readFilters(); offset = 0; await refreshRows();
  });
});
$('reset-filters').addEventListener('click', () => run(async () => {
  $('list-filters').reset(); appliedFilters.talents = {}; appliedFilters.records = {};
  offset = 0; await refreshRows();
}));
$('select-filtered').addEventListener('click', () => run(async () => {
  const current = sessionId;
  const result = await request('INVITE_TALENT_IDS', {sessionId: current, filters: appliedFilters.talents});
  if (current !== sessionId) return;
  if (!Array.isArray(result.ids) || result.ids.length > 10000 || result.ids.some(id => typeof id !== 'string')) throw Error('全选结果无效。');
  selected.clear(); result.ids.forEach(id => selected.add(id)); renderRows();
}));
// Quote every field and neutralize spreadsheet formula prefixes from untrusted platform data.
function csvCell(value) {
  let text = value == null ? '' : displayValue(value);
  if (/^[\s]*[=+@-]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
$('export-rows').addEventListener('click', () => run(async () => {
  const current = sessionId, exportedView = view;
  const result = await request('INVITE_EXPORT', {sessionId: current, view: exportedView, filters: appliedFilters[exportedView], ids: (exportedView === 'talents' ? selected.size : selectedRecords.size) ? [...(exportedView === 'talents' ? selected : selectedRecords)] : undefined});
  if (current !== sessionId) return;
  if (!Array.isArray(result.rows) || result.rows.length > 10000) throw Error('导出结果无效。');
  const columns = exportedView === 'talents'
    ? [['name','达人'],['id','达人 ID'],['uid','UID'],['fans','粉丝'],['region','地区'], ...metricColumns]
    : [['talentId','达人 ID'],['name','达人'],['status','状态'],['createdAt','创建时间'],['updatedAt','更新时间'],['note','说明']];
  const csv = [columns.map(([, title]) => csvCell(title)).join(','), ...result.rows.map(row => columns.map(([key]) => csvCell(row[key])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], {type:'text/csv;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `${exportedView}-${platform}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  $('rows-status').textContent = `已导出当前筛选的 ${result.rows.length} 条记录。`;
}));
$('select-record-page').addEventListener('click', () => { if (view === 'records') rows.forEach(row => selectedRecords.add(row.id)); renderRows(); });
$('clear-record-selection').addEventListener('click', () => { selectedRecords.clear(); renderRows(); });
async function deleteRecords(filtered) {
  const current = sessionId;
  let ids = [...selectedRecords];
  if (filtered) {
    const result = await request('INVITE_EXPORT', {sessionId: current, view: 'records', filters: appliedFilters.records});
    ids = result.rows.map(row => row.id);
  }
  if (current !== sessionId) return;
  if (!ids.length) throw Error('没有可清理的记录。');
  if (ids.length > 10000 || ids.some(id => typeof id !== 'string')) throw Error('记录选择无效。');
  if (!window.confirm(`清理 ${ids.length} 条邀约记录？这会同时清除这些达人的去重标记，允许再次邀约，可能导致重复发送。运行中的任务必须先停止。确认清理？`)) return;
  await request('INVITE_DELETE_RECORDS', {sessionId: current, ids});
  selectedRecords.clear(); offset = 0; await refreshRows();
}
$('delete-records').addEventListener('click', () => run(() => deleteRecords(false)));
$('delete-filtered-records').addEventListener('click', () => run(() => deleteRecords(true)));
async function refreshLogs() {
  const current = sessionId;
  const result = await request('INVITE_LOGS', {sessionId: current, offset: logOffset, limit: 100});
  if (current !== sessionId) return;
  logRows = result.rows; $('event-logs').replaceChildren();
  for (const log of logRows) {
    const details = document.createElement('details');
    details.append(textNode('summary', `${log.createdAt || ''} · ${labels[log.status] || log.status || ''} · ${log.message || ''}`));
    details.append(textNode('pre', JSON.stringify(log, null, 2))); $('event-logs').append(details);
  }
  if (!logRows.length) $('event-logs').textContent = '本页暂无事件日志。';
  $('logs-page').textContent = `第 ${Math.floor(logOffset / 100) + 1} 页`;
  updateControls();
}
$('refresh-logs').addEventListener('click', () => run(async () => { logOffset = 0; await refreshLogs(); }));
$('previous-logs').addEventListener('click', () => run(async () => { logOffset = Math.max(0, logOffset - 100); await refreshLogs(); }));
$('next-logs').addEventListener('click', () => run(async () => { logOffset += 100; await refreshLogs(); }));
$('clear-logs').addEventListener('click', () => run(async () => {
  if (!window.confirm('清理当前账号的全部本地事件日志？此操作不可撤销，不会清除邀约记录或去重标记。运行中的任务必须先停止。')) return;
  await request('INVITE_CLEAR_LOGS', {sessionId});
  logOffset = 0; await refreshLogs();
}));
$('export-logs').addEventListener('click', () => run(async () => {
  const current = sessionId;
  const columns = [['id','日志 ID'],['taskId','任务 ID'],['status','状态'],['message','消息'],['talentId','达人 ID'],['createdAt','时间']];
  const parts = ['\uFEFF' + columns.map(([, label]) => csvCell(label)).join(',') + '\r\n'];
  const seen = new Set();
  for (let position = 0; ; position += 1000) {
    const result = await request('INVITE_LOGS', {sessionId: current, offset: position, limit: 1000});
    if (current !== sessionId || disposed) return;
    if (!Array.isArray(result.rows) || result.rows.length > 1000) throw Error('日志导出响应无效。');
    if (!result.rows.length) break;
    for (const row of result.rows) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      parts.push(columns.map(([key]) => csvCell(row[key])).join(',') + '\r\n');
    }
    $('rows-status').textContent = `正在导出日志：已读取 ${seen.size} 条…`;
  }
  const url = URL.createObjectURL(new Blob(parts, {type: 'text/csv;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href = url;
  anchor.download = `invitation-logs-${platform}-${new Date().toISOString().slice(0,10)}.csv`;
  document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  $('rows-status').textContent = `已导出 ${seen.size} 条本地事件日志。`;
}));
async function poll() {
  if (!busy && !polling) {
    polling = true;
    try {
      await refreshStatus();
      const current = sessionId;
      if (current) {
        const result = await request('INVITE_OBSERVE', {sessionId: current});
        if (current === sessionId) {
          const previousAccount = observation?.account?.shopId;
          applyObservation(result.observation);
          if (observation?.account?.shopId !== previousAccount) {
            $('task-history').replaceChildren(); $('event-logs').replaceChildren(); logOffset = 0; logRows = []; offset = 0; await refreshRows();
          }
        }
      }
      await refreshLiveLogs();
    } catch (error) {
      liveLogs.reset();
      observation = null;
      if (error.message.includes('准备状态已失效')) {
        sessionId = null; selected.clear(); selectedRecords.clear(); $('task-history').replaceChildren(); $('event-logs').replaceChildren(); logOffset = 0; logRows = []; rows = []; rowEpoch++; renderRows();
        $('observation-status').textContent = '准备状态已失效，请重新准备来源。';
      }
      updateControls(); showError(error);
    }
    finally { polling = false; }
  }
  if (!disposed) pollTimer = setTimeout(poll, 2000);
}
let pollTimer;
const countdownTimer = setInterval(() => { if (tasks.some(task => task.retryAt)) renderTasks(); }, 1000);
window.addEventListener('pagehide', () => { disposed = true; liveLogs.reset(); clearTimeout(pollTimer); clearInterval(countdownTimer); });
renderRows();
async function initializeWorkspace() {
  if (!embedded) { void refreshSources(); void poll(); return; }
  try {
    const host = await request('INVITE_HOST_CONTEXT');
    if (!Number.isInteger(host.tabId) || !['douyin', 'kuaishou'].includes(host.platform)) throw Error('当前来源页面无效。');
    platform = host.platform; selectedTabId = host.tabId;
    $('invite-platform').value = platform; applyPlatformFields();
    await refreshStatus();
    const result = await request('INVITE_PREPARE', {tabId: selectedTabId, platform});
    sessionId = result.sessionId; applyObservation(result.observation);
    await showWorkspaceView(location.hash.slice(1) || 'talents');
  } catch (error) { showError(error); }
  finally { void poll(); }
}
void initializeWorkspace();
