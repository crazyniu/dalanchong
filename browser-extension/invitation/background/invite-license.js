/**
 * AI module map
 * Purpose: standalone invitation licensing against the existing dalanchong service.
 * Entry: background is the sole owner of inviteLicense. initialize reads local secrets
 * once and verifies; explicit activate is the only binding operation. Background owns
 * the periodic verify alarm. requireValid only reads fresh in-memory verified state.
 * Boundary: code/installation ID stay in extension-local storage and HTTPS POST bodies;
 * status exposes installation ID only as principalId for local data scoping. Never pass
 * this module or storage values to platform pages/content scripts. No global storage
 * access-level change, to preserve existing extension features.
 * Identity is a persistent browser-profile UUID, NOT hardware identity or clone proof.
 * Existing code bindings remain authoritative; never auto-unbind/rebind.
 * No network at import, no persisted validity, no verify-to-activate fallback, no logs.
 */
import {testLicense} from '../../shared/build-mode.js';

const API = 'https://dabudian.top/functions/v1/license-api';
const APP_ID = 'dalanchong';
const RULES_API = 'https://dabudian.top/functions/v1/extension-rules';
const RULE_ACTIONS = new Set(['invite.validate', 'invite.decide', 'video.rank']);
const STORAGE_KEY = testLicense ? 'invitationLicenseTest' : 'invitationLicense';
const MAX_AGE = 10 * 60 * 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MESSAGES = Object.freeze({
  not_activated: '请输入激活码',
  invalid_license: '激活码无效，请检查是否属于大懒虫',
  device_unbound: '安装已解绑，请主动重新激活',
  device_mismatch: '激活码已绑定其他安装，请联系管理员解绑后再激活',
  device_disabled: '此安装已被禁用，请联系管理员',
  expired: '激活码已过期',
  network_error: '授权服务连接失败，邀约功能已暂停',
  invalid_response: '授权服务响应无效，邀约功能已暂停',
  storage_error: '无法读取或保存本地授权信息',
  verification_required: '需要重新联网验证激活码',
  account_changed: '当前安装身份不匹配，请重新打开邀约页面',
});
function failure(reason) {
  return Object.assign(new Error(MESSAGES[reason] || MESSAGES.invalid_response),
    {license: true, beforeSend: true, reason});
}
function normalizeCode(value) {
  if (typeof value !== 'string' || value.length > 100) throw failure('invalid_license');
  const normalized = value.toUpperCase().replace(/[\s-]/g, '');
  if (testLicense && normalized === testLicense.code) return normalized;
  if (!/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{24}$/.test(normalized)) throw failure('invalid_license');
  return normalized;
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw failure('invalid_response');
  return Date.parse(value);
}
function parseResult(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.valid !== 'boolean' ||
      typeof value.reason !== 'string') throw failure('invalid_response');
  const serverTime = timestamp(value.server_time);
  if (value.valid) {
    if (value.reason !== 'active' || value.app_id !== APP_ID) throw failure('invalid_response');
    timestamp(value.activated_at);
    const expiresAt = value.expires_at === null ? null : timestamp(value.expires_at);
    if (expiresAt !== null && expiresAt <= serverTime) throw failure('expired');
    return {valid: true, reason: 'active', serverTime, expiresAt: value.expires_at};
  }
  if (!['invalid_license', 'not_activated', 'device_unbound', 'device_mismatch',
    'device_disabled', 'expired'].includes(value.reason)) throw failure('invalid_response');
  if (value.reason !== 'invalid_license' && value.app_id !== APP_ID) throw failure('invalid_response');
  return {valid: false, reason: value.reason, serverTime, expiresAt: null};
}


function rulesFailure(reason) {
  const message = {
    invalid_action: '不支持此云规则操作',
    invalid_input: '邀约或推荐参数不符合规则，请检查配置',
    rate_limited: '云规则请求过于频繁，请稍后重试',
    unavailable: '云规则服务不可用，当前操作已停止',
  }[reason] || '云规则服务不可用';
  return Object.assign(new Error(message), {cloudRules: true, beforeSend: true, reason});
}
function ruleFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
      Object.keys(value).some(key => !allowed.includes(key))) throw rulesFailure('invalid_input');
}
function ruleIds(value, limit) {
  if (!Array.isArray(value) || value.length > limit ||
      value.some(id => typeof id !== 'string' || !/^\d{1,40}$/.test(id))) throw rulesFailure('invalid_input');
  return [...value];
}
function ruleInput(action, input) {
  const allowed = {
    'invite.validate': ['platform', 'products', 'messageLength', 'hasPhone', 'hasWechat', 'interval', 'maxInvites'],
    'invite.decide': ['platform', 'productIds', 'eligibility', 'availableProductIds', 'hasContactName', 'hasPhone', 'hasWechat'],
    'video.rank': ['candidates'],
  }[action];
  ruleFields(input, allowed);
  if (action === 'video.rank') {
    if (!Array.isArray(input.candidates) || input.candidates.length > 1000) throw rulesFailure('invalid_input');
    const seen = new Set();
    return {candidates: input.candidates.map(item => {
      ruleFields(item, ['index', 'quality', 'height', 'updatedAt']);
      if (!Number.isSafeInteger(item.index) || item.index < 0 || seen.has(item.index) ||
          typeof item.quality !== 'string' || item.quality.length > 80 ||
          !Number.isFinite(item.height) || item.height < 0 ||
          !Number.isFinite(item.updatedAt) || item.updatedAt < 0) throw rulesFailure('invalid_input');
      seen.add(item.index);
      return {index: item.index, quality: item.quality, height: item.height, updatedAt: item.updatedAt};
    })};
  }
  if (!['douyin', 'kuaishou'].includes(input.platform)) throw rulesFailure('invalid_input');
  const result = {platform: input.platform};
  for (const key of ['hasPhone', 'hasWechat', 'hasContactName']) if (input[key] !== undefined) {
    if (typeof input[key] !== 'boolean') throw rulesFailure('invalid_input');
    result[key] = input[key];
  }
  if (action === 'invite.validate') {
    if (typeof input.products !== 'string' || input.products.length > 4000 ||
        !/^[\d\s,，、;；]+$/.test(input.products) ||
        !Number.isSafeInteger(input.messageLength) || input.messageLength < 0 ||
        !Number.isSafeInteger(input.interval) || input.interval < 0 ||
        (input.maxInvites != null && (!Number.isSafeInteger(input.maxInvites) || input.maxInvites < 1)))
      throw rulesFailure('invalid_input');
    return {...result, products: input.products, messageLength: input.messageLength,
      interval: input.interval, maxInvites: input.maxInvites ?? null};
  }
  result.productIds = ruleIds(input.productIds, input.platform === 'douyin' ? 5 : 100);
  if (input.eligibility !== undefined) {
    ruleFields(input.eligibility, ['is_passed', 'connection_type', 'need_strong_template']);
    const e = input.eligibility;
    if (typeof e.is_passed !== 'boolean' || typeof e.need_strong_template !== 'boolean' ||
        !Number.isSafeInteger(e.connection_type)) throw rulesFailure('invalid_input');
    result.eligibility = {is_passed: e.is_passed, connection_type: e.connection_type,
      need_strong_template: e.need_strong_template};
  }
  if (input.availableProductIds !== undefined) result.availableProductIds = ruleIds(input.availableProductIds, 5);
  return result;
}
function ruleResult(action, result, input) {
  const bad = () => { throw rulesFailure('unavailable'); };
  if (!result || typeof result !== 'object' || Array.isArray(result)) bad();
  if (action === 'video.rank') {
    const indices = result.indices;
    const expected = new Set(input.candidates.map(item => item.index));
    if (!Array.isArray(indices) || indices.length !== expected.size || new Set(indices).size !== indices.length ||
        indices.some(index => !expected.has(index))) bad();
    return {indices: [...indices]};
  }
  const expected = [...new Set(action === 'invite.validate'
    ? input.products.trim().split(/[\s,，、;；]+/).filter(Boolean) : input.productIds)];
  const idsMatch = () => Array.isArray(result.productIds) && result.productIds.length === expected.length &&
    result.productIds.every((id, index) => id === expected[index]);
  if (action === 'invite.validate') {
    if (!idsMatch() || result.interval !== input.interval ||
        result.minInterval !== (input.platform === 'douyin' ? 5000 : 2000) ||
        !Number.isSafeInteger(result.interval) || result.interval < result.minInterval || result.interval > 60000 ||
        result.retryDelayMs !== 10000 || result.frequencyRetryDelayMs !== 60000) bad();
    return {productIds: [...result.productIds], minInterval: result.minInterval, interval: result.interval,
      retryDelayMs: result.retryDelayMs, frequencyRetryDelayMs: result.frequencyRetryDelayMs};
  }
  if (typeof result.skip === 'string') {
    if (result.allowed !== undefined || result.needsProducts !== undefined || !result.skip || result.skip.length > 200) bad();
    return {skip: result.skip};
  }
  if (result.needsProducts === true) {
    if (input.platform !== 'douyin' || result.allowed !== undefined || input.availableProductIds !== undefined || !idsMatch()) bad();
    return {needsProducts: true, productIds: [...result.productIds]};
  }
  const kuaishou = input.platform === 'kuaishou';
  if (result.allowed !== true || !idsMatch() || result.sendPath !== (kuaishou
    ? '/distribute/pc/seller/invite/seller/create' : '/connection/pc/im/invite/card/send')) bad();
  const d = result.defaults;
  if (!d || typeof d !== 'object' || Array.isArray(d)) bad();
  if (kuaishou) {
    if (d.canRealUpdatePrice !== 2 || d.selected !== 1) bad();
    return {allowed: true, productIds: [...result.productIds], sendPath: result.sendPath,
      defaults: {canRealUpdatePrice: 2, selected: 1}};
  }
  if (d.account_type !== 1 || d.entry_point !== 1 || d.author_sample_status !== 0 ||
      !Array.isArray(d.rights) || d.rights.length || d.is_open_feed !== false || d.client_form !== 'pc') bad();
  return {allowed: true, productIds: [...result.productIds], sendPath: result.sendPath,
    defaults: {account_type: 1, entry_point: 1, author_sample_status: 0, rights: [], is_open_feed: false, client_form: 'pc'}};
}

// Only the extension background imports this factory's singleton. Concurrent callers
// share initialization and an operation queue; delayed verify cannot replace activation.
export function createInviteLicense() {
  let installationId = '', savedCode = '', initializing;
  let queue = Promise.resolve();
  let checkedMonotonic = 0, checkedWall = 0, lifetime = 0;
  let state = {checked: false, valid: false, reason: 'verification_required', expiresAt: null};
  const serialize = operation => {
    const result = queue.then(operation);
    queue = result.catch(() => {});
    return result;
  };
  const invalidate = reason => {
    lifetime = 0;
    state = {checked: true, valid: false, reason, expiresAt: null};
  };
  function status() {
    if (state.valid && !(testLicense && savedCode === testLicense.code)) {
      const elapsed = performance.now() - checkedMonotonic;
      const wallElapsed = Date.now() - checkedWall;
      if (elapsed < 0 || wallElapsed < 0 || Math.max(elapsed, wallElapsed) >= lifetime)
        invalidate('verification_required');
    }
    return {...state, hasCode: Boolean(savedCode), principalId: installationId || null,
      message: state.valid ? '' : MESSAGES[state.reason] || MESSAGES.invalid_response};
  }
  function requireValid(scope) {
    const current = status();
    if (!current.valid) throw failure(current.reason);
    if (scope !== undefined && scope?.userId !== installationId) throw failure('account_changed');
    return current;
  }
  async function call(action, code) {
    if (testLicense && code === testLicense.code) {
      return {valid: true, reason: 'active', serverTime: Date.now(), expiresAt: null,
        started: performance.now(), startedWall: Date.now()};
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    const started = performance.now(), startedWall = Date.now();
    try {
      const response = await fetch(`${API}/${action}`, {
        method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
        body: JSON.stringify({app_id: APP_ID, code, device_id: installationId}),
        credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (!response.ok) throw failure('network_error');
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json'))
        throw failure('invalid_response');
      return {...parseResult(await response.json()), started, startedWall};
    } catch (error) {
      if (error?.license) throw error;
      // Do not propagate provider bodies or fetch exceptions containing request details.
      throw failure('network_error');
    } finally { clearTimeout(timer); }
  }
  function publish(result) {
    if (!result.valid) { invalidate(result.reason); return status(); }
    checkedMonotonic = performance.now();
    checkedWall = Date.now();
    // Server time determines expiry. Subtract the full request duration conservatively;
    // the local wall clock can shorten this lease but cannot extend it after rollback.
    lifetime = Math.max(0, Math.min(MAX_AGE,
      result.expiresAt === null ? MAX_AGE : Date.parse(result.expiresAt) - result.serverTime)
      - Math.max(0, performance.now() - result.started, Date.now() - result.startedWall));
    state = {checked: true, valid: true, reason: 'active', expiresAt: result.expiresAt};
    return status();
  }
  async function verifySaved() {
    if (!savedCode) { invalidate('not_activated'); return status(); }
    try { return publish(await call('verify', savedCode)); }
    catch (error) { invalidate(error.reason || 'network_error'); return status(); }
  }
  async function load() {
    try {
      // The lock prevents two extension-owned contexts creating different profile IDs.
      // No content-script storage policy changes or synced storage are introduced.
      await navigator.locks.request('dalanchong-invitation-license-install', async () => {
        const stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
        if (stored !== undefined && (!stored || typeof stored !== 'object' || Array.isArray(stored)))
          throw failure('storage_error');
        if (stored?.installationId !== undefined && !UUID.test(stored.installationId))
          throw failure('storage_error');
        if (stored?.code && !stored.installationId) throw failure('storage_error');
        installationId = stored?.installationId || crypto.randomUUID();
        savedCode = stored?.code ? normalizeCode(stored.code) : '';
        if (!stored?.installationId)
          await chrome.storage.local.set({[STORAGE_KEY]: {installationId}});
      });
    } catch { invalidate('storage_error'); throw failure('storage_error'); }
    return verifySaved();
  }
  function initialize() {
    if (!initializing) initializing = serialize(load).catch(error => {
      initializing = undefined;
      throw error;
    });
    return initializing.then(() => status());
  }

  return Object.freeze({
    initialize,
    status,
    requireValid,
    async rules(action, input) {
      if (!RULE_ACTIONS.has(action)) throw rulesFailure('invalid_action');
      const payload = ruleInput(action, input);
      await initialize();
      return serialize(async () => {
        requireValid();
        if (testLicense && savedCode === testLicense.code)
          return ruleResult(action, testLicense.evaluate(action, payload), payload);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        try {
          const response = await fetch(RULES_API, {
            method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json'},
            body: JSON.stringify({app_id: APP_ID, code: savedCode, device_id: installationId,
              action, input: payload}),
            credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer',
            signal: controller.signal,
          });
          if (response.status === 403) {
            let reason = 'invalid_response';
            try {
              const denied = await response.json();
              if (denied?.valid === false && ['invalid_license', 'not_activated', 'device_unbound',
                'device_mismatch', 'device_disabled', 'expired'].includes(denied.reason)) reason = denied.reason;
            } catch { /* Unknown forbidden responses also revoke current permission. */ }
            invalidate(reason);
            throw failure(reason);
          }
          if (response.status === 400) throw rulesFailure('invalid_input');
          if (response.status === 429) throw rulesFailure('rate_limited');
          if (!response.ok || !response.headers.get('content-type')?.toLowerCase().includes('application/json'))
            throw rulesFailure('unavailable');
          const envelope = await response.json();
          if (!envelope || envelope.valid !== true || !Object.hasOwn(envelope, 'result'))
            throw rulesFailure('unavailable');
          requireValid();
          return ruleResult(action, envelope.result, payload);
        } catch (error) {
          if (error?.license || error?.cloudRules) throw error;
          throw rulesFailure('unavailable');
        } finally { clearTimeout(timer); }
      });
    },
    async verify() {
      const firstInitialization = !initializing;
      await initialize();
      if (firstInitialization) return status();
      return serialize(verifySaved);
    },
    async activate(input) {
      const code = normalizeCode(input);
      await initialize();
      return serialize(async () => {
        let result;
        try { result = await call('activate', code); }
        catch (error) {
          // Failed replacement never discards an existing code. Unknown connectivity
          // does invalidate permission, even if the previous code remains on disk.
          invalidate(error.reason || 'network_error');
          throw error;
        }
        if (!result.valid) {
          // A rejected replacement code preserves a working old code.
          // A rejection of the current code must immediately revoke in-memory validity.
          if (code === savedCode || result.reason === 'device_disabled' || !status().valid) invalidate(result.reason);
          throw failure(result.reason);
        }
        try {
          await chrome.storage.local.set({[STORAGE_KEY]: {installationId, code}});
        } catch { invalidate('storage_error'); throw failure('storage_error'); }
        savedCode = code;
        return publish(result);
      });
    },
  });
}

export const inviteLicense = createInviteLicense();
