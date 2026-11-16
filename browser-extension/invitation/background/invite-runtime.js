/**
 * AI module map
 * Purpose: own local standalone collection/invitation jobs in the browser background.
 * Entry: createInviteRuntime receives a durable store and a trusted license gate;
 * startCollection/startInvitation require explicit UI commands and a bound page API.
 * Flow: freeze inputs, check license and page identity before every request, persist
 * before dispatch, reuse shared platform preparation and maintain cancellable pacing.
 * Boundary: no startup sends, cloud business sync, credentials, or account inference.
 * The background is the sole owner; worker restart must recover before new work.
 * Send failures retry the same record; cancellation retains uncertain sends for review.
 */
import {collect, prepareInvite} from '../core/platform.mjs';

const stoppedError = () => Object.assign(new Error('任务已停止'), {stopped: true, beforeSend: true});
const keyFor = (scope, kind) => JSON.stringify([scope.userId, scope.platform, scope.platformAccountId, kind]);

export function createInviteRuntime({store, license, onChange = () => {}}) {
  const jobs = new Map();
  const completed = new Map();
  const recovered = new Map();
  const starting = new Map();
  let stopGeneration = 0;
  const scopeStops = new Map();
  function cancellation(scope, kind) {
    const generation = stopGeneration;
    const keys = [keyFor(scope, 'scope'), keyFor(scope, kind)];
    const versions = keys.map(key => scopeStops.get(key) || 0);
    return () => generation !== stopGeneration || keys.some((key, index) => (scopeStops.get(key) || 0) !== versions[index]);
  }
  async function wait(job, deadline) {
    if (job.stopped) throw stoppedError();
    while (deadline > Date.now()) {
      await new Promise(resolve => {
        const timer = setTimeout(resolve, Math.min(deadline - Date.now(), 20000));
        job.wake = () => { clearTimeout(timer); resolve(); };
      });
      if (job.stopped) throw stoppedError();
      // During longer backoff, verify real page/account readiness rather than
      // issuing synthetic keepalive calls or resuming blindly after navigation.
      if (deadline > Date.now()) await check(job);
    }
    job.wake = null;
    if (job.stopped) throw stoppedError();
  }
  async function check(job) {
    if (job.stopped) throw stoppedError();
    await license.requireValid(job.scope);
    await job.connection.assertIdentity(job.scope);
    await license.requireValid(job.scope);
    if (job.stopped) throw stoppedError();
  }
  function beforeDispatch(job) {
    if (job.stopped) throw stoppedError();
    license.requireValid(job.scope);
  }
  async function save(job, patch) {
    job.task = await store.updateTask(job.scope, job.task.id, {...patch, detail: job.current || ''});
    onChange({...job.task, current: job.current, retryAt: job.retryAt});
  }
  function log(job, message, level = 'info', response) {
    return store.appendTaskLog(job.scope, job.task.id, {message, level,
      status:level === 'error' ? 'failed' : level === 'success' ? 'success' : 'info',
      ...(response ? {response} : {})});
  }
  function recoverScope(scope) {
    license.requireValid(scope);
    const owner = keyFor(scope, 'scope');
    // Exactly once per worker and scope. Page preparation may call this too;
    // it must never recover an already-running task from this worker.
    if (!recovered.has(owner)) {
      const recovery = Promise.resolve().then(() => store.recover(scope))
        .catch(error => { recovered.delete(owner); throw error; });
      recovered.set(owner, recovery);
    }
    return recovered.get(owner);
  }
  async function begin(scope, kind, connection, total = 0, cancelled = () => false) {
    const key = keyFor(scope, kind);
    if (cancelled()) throw stoppedError();
    if (jobs.has(key) || starting.has(key)) throw new Error('该账号已有同类任务');
    const pending = {scope: structuredClone(scope), kind, stopped: false};
    starting.set(key, pending);
    try {
      await license.requireValid(scope);
      await connection.assertIdentity(scope);
      await recoverScope(scope);
      const task = await store.createTask(scope, {kind, total, processed: 0, success: 0, failed: 0, skipped: 0, review: 0});
      try {
        if (pending.stopped || cancelled()) throw stoppedError();
        await license.requireValid(scope);
        if (pending.stopped || cancelled()) throw stoppedError();
      } catch (error) {
        await store.updateTask(scope, task.id, {status: 'stopped'});
        throw error;
      }
      const job = {scope: structuredClone(scope), connection, task, stopped: false, wake: null, key};
      jobs.set(key, job);
      onChange(task);
      return job;
    } finally { starting.delete(key); }
  }
  function launch(job, operation) {
    job.promise = operation().catch(async error => {
      const cancelled = job.stopped && error.beforeSend;
      job.current = error.message;
      job.stopped = true;
      if (!cancelled) {
        try { await log(job, `${job.task.kind === 'collect' ? '采集失败' : '邀约中断'}：${error.message}`, 'error', error.response); }
        catch (logError) { job.current += `；日志保存失败：${logError.message}`; }
      }
    })
      .finally(async () => {
        try { await save(job, {status: job.stopped ? 'stopped' : 'completed'}); }
        catch (error) { onChange({...job.task, error: error.message}); }
        finally { completed.set(job.key, {...job.task, platform: job.scope.platform, platformAccountId: job.scope.platformAccountId, current: job.current}); jobs.delete(job.key); }
      });
    return job.task;
  }
  async function retry(job, error, nextAt = 0, candidate) {
    if (error.login || error.license || error.rules || error.cloudRules || error.stopped || job.stopped) throw error;
    const frequent = (job.scope.platform === 'douyin' && String(error.code) === '11001') || /请求过于频繁|请求频繁/.test(error.message);
    job.retryAt = Math.max(Date.now() + (frequent ? job.rules.frequencyRetryDelayMs : job.rules.retryDelayMs), nextAt);
    const current = job.current;
    job.current = frequent ? '请求频繁' : '邀约失败';
    if (candidate) await store.updateInvitation(job.scope, candidate.id, job.task.id, {note:error.message, response:error.response});
    await log(job, `${candidate ? `${candidate.name}（${candidate.id}）· ` : ''}邀约失败：${error.message}，${Math.ceil((job.retryAt-Date.now())/1000)} 秒后重试`, 'error', error.response);
    onChange({...job.task, current: job.current, retryAt: job.retryAt});
    try { await wait(job, job.retryAt); } finally {
      job.retryAt = null;
      job.current = current;
      onChange({...job.task, current: job.current});
    }
  }
  async function readRequest(job, path, body = null, onResponse) {
    while (true) {
      await check(job);
      try { return await job.connection.api(path, body, undefined, onResponse, () => beforeDispatch(job)); }
      catch (error) { await retry(job, error); }
    }
  }
  return {
    recoverScope,
    status: () => [...[...completed.entries()].filter(([key]) => !jobs.has(key)).map(([, task]) => task), ...[...jobs.values()].map(job => ({...job.task,
      ...(job.stopped && job.task.kind === 'collect' ? {status:'stopped'} : {}),
      platform: job.scope.platform, platformAccountId: job.scope.platformAccountId, current: job.current, retryAt: job.retryAt}))],
    stop(scope, kind) {
      const key = keyFor(scope, kind || 'scope');
      scopeStops.set(key, (scopeStops.get(key) || 0) + 1);
      for (const pending of starting.values()) if (keyFor(pending.scope, 'scope') === keyFor(scope, 'scope') && (!kind || kind === pending.kind)) pending.stopped = true;
      for (const job of jobs.values()) if (keyFor(job.scope, 'scope') === keyFor(scope, 'scope') && (!kind || kind === job.task.kind)) {
        job.stopped = true; job.wake?.();
        if (job.task.kind === 'collect') {
          job.current = '采集已停止';
          onChange({...job.task, status:'stopped', current:job.current});
        }
      }
    },
    stopAll() { stopGeneration++; for (const pending of starting.values()) pending.stopped = true; for (const job of jobs.values()) { job.stopped = true; job.wake?.(); } },
    async startCollection(scope, connection, capture, cancelled = () => false) {
      if (!capture?.list) throw new Error('请先在当前来源页面搜索或应用筛选');
      const snapshot = structuredClone(capture);
      const job = await begin(scope, 'collect', connection, 0, cancelled);
      return launch(job, async () => {
        job.current = '正在采集达人';
        await log(job, '开始采集达人');
        let nextAt = 0;
        await collect({platform: scope.platform, capture: snapshot, stopped: () => job.stopped,
          request: async (path, body) => {
            await wait(job, nextAt);
            try { return await connection.api(path, body, undefined, undefined, () => beforeDispatch(job)); } finally { nextAt = Date.now() + 1000; }
          },
          progress: async (count, text, batch) => {
            await check(job);
            const saved = await store.upsertTalents(scope, batch);
            const updated = new Set(saved.updatedIds);
            for (const talent of saved.talents) await log(job, `${talent.name} · ${updated.has(talent.id) ? '更新' : '新增'}`, 'success');
            job.current = `${text} · 新增 ${saved.added} · 已有 ${batch.length-saved.added}`;
            await log(job, job.current);
            await save(job, {total: count, processed: count});
          },
        });
        job.current = job.stopped ? '采集已停止' : `采集完成，共 ${job.task.processed} 位达人`;
        await log(job, job.current, job.stopped ? 'info' : 'success');
      });
    },
    async startInvitation(scope, connection, input, ids) {
      const cancelled = cancellation(scope, 'invite');
      const config = structuredClone(input);
      const rules = await license.rules('invite.validate', {platform: scope.platform,
        products: config.products, messageLength: Array.from(config.message.trim()).length,
        hasPhone: Boolean(config.phone.trim()), hasWechat: Boolean(config.wechat.trim()),
        interval: config.interval, maxInvites: config.maxInvites});
      if (!Array.isArray(ids) || !ids.length || ids.length > 10000 || ids.some(id => typeof id !== 'string'))
        throw new Error('请选择当前账号的达人（最多 10000 条）');
      let selected = [...new Set(ids)];
      // Validate the complete selection before starting any side effects.
      for (const id of selected) if (!await store.getTalent(scope, id)) throw new Error('所选达人不属于当前账号');
      const available = new Set(await store.listTalentIds(scope, {}, true));
      selected = selected.filter(id => available.has(id));
      if (!selected.length) throw new Error('没有无邀约记录的达人');
      const job = await begin(scope, 'invite', connection, selected.length, cancelled);
      job.rules = rules;
      return launch(job, async () => {
        const request = (path, body, onResponse) => readRequest(job, path, body, onResponse);
        const contact = scope.platform === 'kuaishou' ? (await request('/distribute/pc/seller/invite/contact?inviteType=1')).data : undefined;
        const tags = scope.platform === 'kuaishou' ? (await request('/gateway/distribute/pc/seller/invite/tag/query')).data.filter(t => t.selected === 1).slice(0, 5) : [];
        let nextSendAt = 0;
        for (const id of selected) {
          await check(job);
          if (job.task.success >= (config.maxInvites ?? Infinity)) break;
          const reserved = await store.reserveInvitation(scope, {talentId: id, taskId: job.task.id, details:{products:config.products,message:config.message}});
          if (!reserved.created) { await save(job, {processed: job.task.processed + 1, skipped: job.task.skipped + 1}); continue; }
          const candidate = await store.getTalent(scope, id);
          job.current = candidate.name;
          let outcome = 'skipped', dispatched = false, attempted = false, note = '', response, retryResponse;
          const candidateRequest = (path, body) => request(path, body, value => { response = value; });
          try {
            let invitation = await prepareInvite(candidateRequest, scope.platform, config, candidate, contact, tags, input => license.rules('invite.decide', input), rules.productIds);
            if (invitation.skip) note = invitation.skip;
            else while (true) {
              await wait(job, nextSendAt);
              if (scope.platform === 'douyin' && attempted) {
                invitation = await prepareInvite(candidateRequest, scope.platform, config, candidate, contact, tags, input => license.rules('invite.decide', input), rules.productIds);
                if (invitation.skip) {
                  if (dispatched) throw Object.assign(Error(invitation.skip), {beforeSend:true});
                  outcome = 'skipped'; note = invitation.skip; break;
                }
              }
              response = undefined; note = '';
              await store.updateInvitation(scope, id, job.task.id, {note:'', response:null});
              attempted = true;
              await check(job);
              job.current = candidate.name;
              onChange({...job.task, current: job.current});
              nextSendAt = Date.now() + rules.interval;
              try {
                await connection.api(invitation.path, invitation.body, undefined, value => { response = value; }, () => beforeDispatch(job));
                dispatched = true; outcome = 'success'; break;
              } catch (error) {
                if (!error.beforeSend) dispatched = true;
                if (error.response) retryResponse = error.response;
                if (scope.platform === 'kuaishou' && /近7天有未处理|近7天.*被拒绝/.test(error.message)) throw error;
                await retry(job, error, nextSendAt, candidate);
              }
            }
          } catch (error) {
            if (error.beforeSend) {
              if (!dispatched) {
                await store.cancelInvitation(scope, id, job.task.id);
                throw error;
              }
              outcome = 'review'; note = `${error.message}，请核实上次邀约结果`; response = retryResponse;
              job.stopped = true; job.current = error.message;
            } else {
              outcome = scope.platform === 'kuaishou' && /近7天有未处理|近7天.*被拒绝/.test(error.message)
                ? 'skipped' : dispatched && !error.rejected ? 'review' : 'failed';
              note = error.message;
              if (error.response) response = error.response;
              if (outcome !== 'skipped') {
                job.stopped = true;
                await log(job, `${candidate.name}（${candidate.id}）· ${outcome === 'review' ? '待核实' : '失败'}：${error.message}`, 'error', error.response);
              }
            }
          }
          // Persistence failures never return to the platform retry loop.
          await store.finishInvitation(scope, id, {taskId: job.task.id, status: outcome, note, response});
          await save(job, {processed: job.task.processed + 1, [outcome]: job.task[outcome] + 1});
          if (job.stopped) break;
        }
        job.current = job.stopped
          ? job.task.review ? '结果待核实，已停止' : job.task.failed ? '邀约失败，已停止' : '已停止'
          : job.task.success >= (config.maxInvites ?? Infinity) ? '已达到本次邀约上限' : '本次邀约已完成';
      });
    },
  };
}
