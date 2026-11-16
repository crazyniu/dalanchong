/**
 * AI module map
 * Purpose: isolated IndexedDB persistence for standalone creator invitations.
 * Entry: openInviteStore returns explicit scope-first methods; it does not authorize
 * users, collect data, send invitations, schedule retries, or recover automatically.
 * Scope: the authenticated user ID + platform + verified platform account ID.
 * Invariants: every historical invitation status blocks a new reservation. Reserve
 * atomically checks the talent/task and inserts sending; await commit before dispatch.
 * Only allowlisted business fields and explicitly saved account configurations are stored.
 * Platform cookies and tokens are never persisted; response summaries are redacted. Local storage is not an authorization boundary.
 * Reservation excludes duplicates only inside this browser profile; future server
 * claims must own cross-device exclusivity before any cross-device sending is enabled.
 * Recovery: the sole task owner calls recover once after losing its previous session,
 * before starting work. Never call it from a second UI while another owner is active.
 * Recovery stops tasks and marks uncertain sends review; the active runner owns retries.
 */
import {normalizedFilters, matchesTalent, matchesRecord} from '../shared/invite-filter.js';
const DATABASE = 'dalanchong-invitations';
const VERSION = 3;
const STORES = ['talents', 'tasks', 'invitations'];
const ALL_STORES = [...STORES, 'profiles', 'logs'];
const FINAL_STATUSES = new Set(['success', 'failed', 'skipped', 'review']);

function identifier(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 256)
    throw new Error(`${label}无效`);
  return value;
}
function scopeKey(scope) {
  if (!scope || !['douyin', 'kuaishou'].includes(scope.platform)) throw new Error('平台无效');
  return JSON.stringify([identifier(scope.userId, '用户 ID'), scope.platform,
    identifier(scope.platformAccountId, '平台账号 ID')]);
}
function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label}无效`);
  return value;
}
function enumValue(value, choices, label) {
  if (!choices.includes(value)) throw new Error(`${label}无效`);
  return value;
}
function talentFields(input) {
  const result = {id: identifier(input.id, '达人 ID')};
  if (input.uid !== undefined) result.uid = identifier(input.uid, '达人 UID');
  if (input.name !== undefined) {
    if (typeof input.name !== 'string' || input.name.length > 200) throw new Error('达人名称无效');
    result.name = input.name;
  }
  if (input.gender !== undefined) {
    if (!['male', 'female', 'unknown', '男', '女', 0, 1, 2].includes(input.gender)) throw new Error('达人性别无效');
    result.gender = input.gender;
  }
  for (const key of ['fans', 'liveCount30d', 'videoCount30d', 'liveViews30d', 'videoViews30d', 'cooperationProducts30d']) {
    if (input[key] !== undefined) {
      if (!Number.isFinite(input[key]) || input[key] < 0) throw new Error('达人指标无效');
      result[key] = input[key];
    }
  }
  for (const key of ['source', 'region', 'level', 'contentType', 'salesMode', 'sales7d', 'sales30d',
    'settlement30d', 'liveSales30d', 'avgLiveSales7d', 'avgLiveSales30d', 'videoSales7d', 'videoSales30d', 'imageTextSales30d', 'windowSales30d',
    'avgLiveSales', 'avgVideoSales', 'cooperationLevel', 'replyRate']) {
    if (typeof input[key] === 'string' || typeof input[key] === 'number')
      result[key] = String(input[key]).slice(0, 500);
  }
  if (Array.isArray(input.categories)) result.categories = [...input.categories];
  if (input.deliveryTypes !== undefined) {
    if (!Array.isArray(input.deliveryTypes) || input.deliveryTypes.some(value => !['live', 'video'].includes(value))) throw new Error('带货类型无效');
    result.deliveryTypes = [...new Set(input.deliveryTypes)];
  }
  if (typeof input.avatarUrl === 'string') {
    const avatar = new URL(input.avatarUrl);
    if (avatar.protocol === 'https:' && !avatar.username && !avatar.password) result.avatarUrl = avatar.href;
  }
  return result;
}
function taskFields(input) {
  const result = {};
  if (typeof input.detail === 'string') result.detail = safeDetail(input.detail).slice(0, 1000);
  for (const key of ['total', 'processed', 'success', 'failed', 'skipped', 'review'])
    if (input[key] !== undefined) result[key] = count(input[key], key);
  return result;
}
function safeDetail(value) {
  const sensitive = /cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation/i;
  const redact = text => String(text).replace(/(["']?[\w-]*(?:cookie|token|authorization|password|secret|phone|mobile|wechat|contact|license|activation)[\w-]*["']?\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s<>&;]+)/gi, '$1[已隐藏]');
  const text = typeof value === 'string' ? redact(value) : JSON.stringify(value,
    (key, entry) => sensitive.test(key) ? '[已隐藏]' : typeof entry === 'string' ? redact(entry) : entry);
  return text.slice(0, 8000);
}
function publicRow(row) {
  if (!row) return null;
  const {scope, ...value} = row;
  if (value.source === '达人广场 · 当前筛选') value.source = '达人广场';
  return value;
}

// Resolve only on transaction completion, not on an individual successful write.
// Callbacks must enqueue IDB requests synchronously or from request handlers.
function transaction(db, stores, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = mode === 'readwrite'
      ? db.transaction(stores, mode, {durability: 'strict'})
      : db.transaction(stores, mode);
    let value, failure;
    const fail = error => {
      failure = error;
      try { tx.abort(); } catch { /* An aborted transaction already owns completion. */ }
    };
    const on = (request, callback) => {
      request.onsuccess = () => { try { callback(request.result); } catch (error) { fail(error); } };
    };
    tx.oncomplete = () => resolve(value);
    tx.onabort = () => reject(failure || tx.error || new Error('本地数据事务已取消'));
    tx.onerror = () => { failure ||= tx.error; };
    try { operation(tx, result => { value = result; }, on); } catch (error) { fail(error); }
  });
}

export async function openInviteStore() {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    let abandoned = false;
    request.onupgradeneeded = () => {
      for (const name of ALL_STORES) {
        if (request.result.objectStoreNames.contains(name)) continue;
        const store = request.result.createObjectStore(name, {keyPath: ['scope', 'id']});
        store.createIndex('scope', 'scope');
        if (name === 'tasks') store.createIndex('scopeKind', ['scope', 'kind']);
      }
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      abandoned = true;
      reject(new Error('请关闭其他邀约页面后重试数据库升级'));
    };
    request.onsuccess = () => {
      if (abandoned) request.result.close();
      else resolve(request.result);
    };
  });
  db.onversionchange = () => db.close();

  const list = (storeName, scope, {offset = 0, limit = 100} = {}) => {
    const key = scopeKey(scope);
    count(offset, '偏移量'); count(limit, '每页数量');
    if (!limit || limit > 1000) throw new Error('每页数量应为 1–1000');
    return transaction(db, [storeName], 'readonly', (tx, done, on) => {
      const rows = [];
      // Log IDs start with their creation timestamp: newest-first pages feed live activity.
      const request = tx.objectStore(storeName).index('scope').openCursor(IDBKeyRange.only(key), storeName === 'logs' ? 'prev' : 'next');
      let skipped = false;
      on(request, cursor => {
        if (!cursor || rows.length === limit) { done(rows); return; }
        if (offset && !skipped) { skipped = true; cursor.advance(offset); return; }
        rows.push(publicRow(cursor.value)); cursor.continue();
      });
    });
  };

  const query = (scope, options = {}, records = false, all = false) => {
    const key = scopeKey(scope), {offset = 0, limit = 100} = options;
    count(offset, '偏移量'); count(limit, '每页数量');
    if (!all && (!limit || limit > 1000)) throw new Error('每页数量应为 1–1000');
    const filters = normalizedFilters(options.filters, records, scope.platform);
    return transaction(db, ['talents', 'invitations'], 'readonly', (tx, done, on) => {
      const invitations = new Map(), result = [];
      on(tx.objectStore('invitations').index('scope').getAll(IDBKeyRange.only(key)), rows => {
        for (const row of rows) invitations.set(row.talentId, row);
        const finish = talents => {
          for (const row of (records ? rows : talents)) {
            if (!(records ? matchesRecord(row, filters) : matchesTalent(row, filters, invitations.get(row.id), scope.platform))) continue;
            if (!records && options.excludeInvited === true && invitations.has(row.id)) continue;
            const item = publicRow(row);
            if (!records) item.invitationStatus = invitations.get(row.id)?.status || '';
            result.push(item);
          }
          const time = row => Date.parse(records ? row.createdAt || row.updatedAt : row.collectedAt || row.updatedAt);
          result.sort((a, b) => time(b) - time(a));
          done(all ? (records ? result : result.slice(0, 10000)) : result.slice(offset, offset + limit));
        };
        if (records) finish([]);
        else on(tx.objectStore('talents').index('scope').getAll(IDBKeyRange.only(key)), finish);
      });
    });
  };

  return {
    close: () => db.close(),
    listLogs(scope, page) { return list('logs', scope, page); },
    clearLogs(scope, ids) {
      const selected = ids === undefined ? null : new Set(ids.map(id => identifier(id, '日志 ID')));
      const key = scopeKey(scope);
      return transaction(db, ['tasks', 'logs'], 'readwrite', (tx, done, on) => {
        on(tx.objectStore('tasks').index('scope').getAll(IDBKeyRange.only(key)), tasks => {
          if (tasks.some(task => task.status === 'running')) throw new Error('请先停止当前账号任务');
          let removed = 0;
          on(tx.objectStore('logs').index('scope').openCursor(IDBKeyRange.only(key)), cursor => {
            if (!cursor) { done(removed); return; }
            if (!selected || selected.has(cursor.value.id)) { cursor.delete(); removed++; } cursor.continue();
          });
        });
      });
    },
    appendTaskLog(scope, taskId, input) {
      const key = scopeKey(scope); identifier(taskId, '任务 ID');
      const row = {scope: key, id: `${Date.now()}-${crypto.randomUUID()}`, taskId,
        createdAt: new Date().toISOString(), message: safeDetail(input.message || '').slice(0, 1000),
        ...(input.talentId ? {talentId: identifier(input.talentId, '达人 ID')} : {}),
        ...(input.status ? {status: String(input.status).slice(0, 50)} : {}),
        ...(input.level ? {level: enumValue(input.level, ['info', 'success', 'error'], '日志级别')} : {}),
        ...(input.response ? {response: safeDetail(input.response)} : {})};
      return transaction(db, ['tasks', 'logs'], 'readwrite', (tx, done, on) =>
        on(tx.objectStore('tasks').get([key, taskId]), task => {
          if (!task) throw new Error('任务不存在');
          tx.objectStore('logs').add(row); done(publicRow(row));
        }));
    },
    deleteRecords(scope, ids) {
      const key = scopeKey(scope);
      if (!Array.isArray(ids) || !ids.length || ids.length > 10000) throw new Error('记录选择无效');
      const selected = [...new Set(ids.map(id => identifier(id, '记录 ID')))];
      return transaction(db, ['tasks', 'invitations'], 'readwrite', (tx, done, on) => {
        on(tx.objectStore('tasks').index('scope').getAll(IDBKeyRange.only(key)), tasks => {
          if (tasks.some(task => task.status === 'running')) throw new Error('请先停止当前账号任务');
          let deleted = 0;
          for (const id of selected) on(tx.objectStore('invitations').get([key, id]), record => {
            if (record?.status === 'sending') throw new Error('发送中的记录不可清理');
            if (record) { tx.objectStore('invitations').delete([key, id]); deleted++; }
            done(deleted);
          });
        });
      });
    },
    getCollectionFilters(scope) {
      const key = scopeKey(scope);
      return transaction(db, ['profiles'], 'readonly', (tx, done, on) =>
        on(tx.objectStore('profiles').get([key, 'collection-filters']), row => done(row?.filters || null)));
    },
    saveCollectionFilters(scope, input) {
      const key = scopeKey(scope);
      const {query, ...filters} = normalizedFilters(input, false, scope.platform);
      return transaction(db, ['profiles'], 'readwrite', (tx, done) => {
        tx.objectStore('profiles').put({scope: key, id: 'collection-filters', filters}); done(filters);
      });
    },
    getConfig(scope) {
      const key = scopeKey(scope);
      return transaction(db, ['profiles'], 'readonly', (tx, done, on) =>
        on(tx.objectStore('profiles').get([key, 'config']), row => done(row?.config || null)));
    },
    saveConfig(scope, input) {
      const key = scopeKey(scope), config = {};
      if (!input || typeof input !== 'object') throw new Error('配置无效');
      for (const field of ['products', 'message', 'phone', 'wechat']) {
        if (typeof input[field] !== 'string' || input[field].length > 10000) throw new Error('配置字段无效');
        config[field] = input[field];
      }
      config.interval = count(input.interval, '间隔');
      if (config.interval < 2000 || config.interval > 60000) throw new Error('间隔无效');
      config.maxInvites = input.maxInvites == null ? null : count(input.maxInvites, '数量');
      return transaction(db, ['profiles'], 'readwrite', (tx, done) => {
        tx.objectStore('profiles').put({scope: key, id: 'config', config}); done(config);
      });
    },
    resolveReview(scope, talentId, result) {
      const key = scopeKey(scope); identifier(talentId, '达人 ID');
      if (!['success', 'not-sent'].includes(result)) throw new Error('核实结果无效');
      return transaction(db, ['invitations', 'tasks'], 'readwrite', (tx, done, on) => {
        const records = tx.objectStore('invitations');
        on(records.get([key, talentId]), row => {
          if (!row || row.status !== 'review') throw new Error('仅待核实记录可人工确认');
          on(tx.objectStore('tasks').index('scope').getAll(IDBKeyRange.only(key)), tasks => {
            if (tasks.some(task => task.status === 'running')) throw new Error('请先停止该账号的任务');
            const sent = result === 'success';
            const next = {...row, status: sent ? 'success' : 'skipped',
              note: sent ? '人工确认已邀约' : '人工确认未邀约', resolution: new Date().toISOString()};
            records.put(next); done(publicRow(next));
          });
        });
      });
    },
    listTalents: (scope, page) => query(scope, page),
    listTalentSources(scope) {
      const key = scopeKey(scope);
      return transaction(db, ['talents'], 'readonly', (tx, done, on) =>
        on(tx.objectStore('talents').index('scope').getAll(IDBKeyRange.only(key)), rows => {
          done([...new Set(rows.map(row => row.source).filter(value => typeof value === 'string' && value.trim()))].sort((a, b) => a.localeCompare(b, 'zh-CN')));
        }));
    },
    listTalentIds: async (scope, filters, excludeInvited = false) => (await query(scope, {filters, excludeInvited}, false, true)).map(row => row.id),
    exportRows: (scope, filters, records = false) => query(scope, {filters}, records, true),
    listTasks(scope, {offset = 0, limit = 100} = {}) {
      const key = scopeKey(scope);
      count(offset, '偏移量'); count(limit, '每页数量');
      if (!limit || limit > 1000) throw new Error('每页数量应为 1–1000');
      return transaction(db, ['tasks'], 'readonly', (tx, done, on) => {
        on(tx.objectStore('tasks').index('scope').getAll(IDBKeyRange.only(key)), rows => {
          const time = row => Date.parse(row.updatedAt || row.createdAt) || 0;
          rows.sort((a, b) => time(b) - time(a) || String(a.id).localeCompare(String(b.id)));
          done(rows.slice(offset, offset + limit).map(publicRow));
        });
      });
    },
    listInvitations: (scope, page) => query(scope, page, true),
    getTalent(scope, id) {
      const key = scopeKey(scope); identifier(id, '达人 ID');
      return transaction(db, ['talents'], 'readonly', (tx, done, on) =>
        on(tx.objectStore('talents').get([key, id]), row => done(publicRow(row))));
    },
    upsertTalents(scope, inputs) {
      const key = scopeKey(scope);
      if (!Array.isArray(inputs) || inputs.length > 1000) throw new Error('达人批次无效');
      const unique = new Map();
      for (const input of inputs) {
        const row = talentFields(input);
        unique.set(row.id, {...unique.get(row.id), ...row});
      }
      const rows = [...unique.values()], now = new Date().toISOString();
      return transaction(db, ['talents'], 'readwrite', (tx, done, on) => {
        const store = tx.objectStore('talents');
        const result = {added: 0, updatedIds: [], talents: []};
        on(store.count(), total => {
          for (const row of rows) on(store.get([key, row.id]), previous => {
            if (previous) result.updatedIds.push(row.id);
            else if (total + ++result.added > 10000) throw new Error('当前浏览器最多保存 10000 位达人，请先清理不需要的数据');
            const next = {...previous, ...row, scope: key, collectedAt: now};
            store.put(next);
            result.talents.push(publicRow(next));
          });
          done(result);
        });
      });
    },
    // Remove selected local talents only. Historical results remain for deduplication.
    deleteTalents(scope, ids) {
      const key = scopeKey(scope);
      if (!Array.isArray(ids) || !ids.length || ids.length > 10000) throw new Error('删除选择无效');
      const selected = [...new Set(ids.map(id => identifier(id, '达人 ID')))];
      return transaction(db, STORES, 'readwrite', (tx, done, on) => {
        const tasks = tx.objectStore('tasks').index('scope').openCursor(IDBKeyRange.only(key));
        on(tasks, cursor => {
          if (cursor) {
            if (cursor.value.status === 'running') throw new Error('请先停止当前账号任务再删除达人');
            cursor.continue(); return;
          }
          let removed = 0;
          for (const id of selected) on(tx.objectStore('invitations').get([key, id]), record => {
            if (record?.status === 'sending') throw new Error('该达人邀约结果尚未确定，请先恢复任务状态');
            const talents = tx.objectStore('talents');
            on(talents.get([key, id]), row => {
              if (row) { talents.delete([key, id]); removed++; }
              done(removed);
            });
          });
        });
      });
    },
    createTask(scope, input) {
      const key = scopeKey(scope);
      const kind = enumValue(input.kind, ['collect', 'invite'], '任务类型');
      const now = new Date().toISOString();
      const row = {...taskFields(input), scope: key, id: crypto.randomUUID(), kind,
        status: 'running', createdAt: now, updatedAt: now};
      return transaction(db, ['tasks'], 'readwrite', (tx, done, on) => {
        const store = tx.objectStore('tasks');
        const request = store.index('scopeKind').openCursor(IDBKeyRange.only([key, kind]));
        on(request, cursor => {
          if (cursor) {
            if (cursor.value.status === 'running') throw new Error('该账号已有运行中的同类任务');
            cursor.continue();
          } else { store.add(row); done(publicRow(row)); }
        });
      });
    },
    updateTask(scope, id, input) {
      const key = scopeKey(scope); identifier(id, '任务 ID');
      const patch = taskFields(input);
      if (input.status !== undefined) patch.status = enumValue(input.status,
        ['running', 'stopped', 'completed', 'failed'], '任务状态');
      return transaction(db, ['tasks'], 'readwrite', (tx, done, on) => {
        const store = tx.objectStore('tasks');
        on(store.get([key, id]), row => {
          if (!row) throw new Error('任务不存在');
          if (row.status !== 'running') throw new Error('已结束任务不可重新启动或覆盖');
          const next = {...row, ...patch, updatedAt: new Date().toISOString()};
          store.put(next); done(publicRow(next));
        });
      });
    },
    // id is the talent ID: the composite primary key provides status-independent
    // deduplication across all tasks/tabs, even under concurrent reservations.
    reserveInvitation(scope, {talentId, taskId, details}) {
      const snapshot = {};
      if (details !== undefined) {
        if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('记录详情无效');
        for (const field of ['products', 'message']) {
          if (typeof details[field] !== 'string' || details[field].length > 10000) throw new Error('记录详情字段无效');
          snapshot[field] = details[field];
        }
      }
      const key = scopeKey(scope); identifier(talentId, '达人 ID'); identifier(taskId, '任务 ID');
      return transaction(db, STORES, 'readwrite', (tx, done, on) => {
        const records = tx.objectStore('invitations');
        on(records.get([key, talentId]), existing => {
          if (existing) { done({created: false, record: publicRow(existing)}); return; }
          on(tx.objectStore('tasks').get([key, taskId]), task => {
            if (!task || task.kind !== 'invite' || task.status !== 'running') throw new Error('邀约任务未运行');
            on(tx.objectStore('talents').get([key, talentId]), talent => {
              if (!talent) throw new Error('当前账号未采集该达人');
              const now = new Date().toISOString();
              const row = {...snapshot, scope: key, id: talentId, talentId, taskId, name: talent.name || '', uid: talent.uid || '', source: talent.source || '', status: 'sending',
                createdAt: now, updatedAt: now};
              records.add(row); done({created: true, record: publicRow(row)});
            });
          });
        });
      });
    },
    cancelInvitation(scope, talentId, taskId) {
      const key = scopeKey(scope); identifier(talentId, '达人 ID'); identifier(taskId, '任务 ID');
      return transaction(db, ['invitations'], 'readwrite', (tx, done, on) => {
        const records = tx.objectStore('invitations');
        on(records.get([key, talentId]), row => {
          if (!row || row.taskId !== taskId || row.status !== 'sending') throw new Error('邀约记录不属于当前发送任务');
          records.delete([key, talentId]); done({removed: true});
        });
      });
    },
    updateInvitation(scope, talentId, taskId, patch) {
      const key = scopeKey(scope); identifier(talentId, '达人 ID'); identifier(taskId, '任务 ID');
      return transaction(db, ['invitations'], 'readwrite', (tx, done, on) => {
        const records = tx.objectStore('invitations');
        on(records.get([key, talentId]), row => {
          if (!row || row.taskId !== taskId || row.status !== 'sending') throw new Error('邀约记录不属于当前发送任务');
          const next = {...row, updatedAt: new Date().toISOString()};
          if (patch.note !== undefined) next.note = safeDetail(patch.note).slice(0, 1000);
          if (patch.response === null) delete next.response;
          else if (patch.response !== undefined) next.response = safeDetail(patch.response);
          records.put(next); done(publicRow(next));
        });
      });
    },
    finishInvitation(scope, talentId, {taskId, status, note, response}) {
      const key = scopeKey(scope); identifier(talentId, '达人 ID'); identifier(taskId, '任务 ID');
      if (!FINAL_STATUSES.has(status)) throw new Error('邀约结果无效');
      return transaction(db, ['invitations'], 'readwrite', (tx, done, on) => {
        const store = tx.objectStore('invitations');
        on(store.get([key, talentId]), row => {
          if (!row) throw new Error('邀约记录不存在');
          if (row.taskId !== taskId) throw new Error('邀约记录不属于该任务');
          if (row.status !== 'sending') {
            if (row.status === status) { done(publicRow(row)); return; }
            throw new Error('邀约记录已结束，不能覆盖');
          }
          const next = {...row, status, updatedAt: new Date().toISOString(), ...(note ? {note: safeDetail(note).slice(0, 1000)} : {}), ...(response ? {response: safeDetail(response)} : {})};
          store.put(next); done(publicRow(next));
        });
      });
    },
    recover(scope) {
      const key = scopeKey(scope), now = new Date().toISOString();
      return transaction(db, ['tasks', 'invitations'], 'readwrite', (tx, done, on) => {
        const counts = {tasks: 0, invitations: 0};
        for (const name of ['tasks', 'invitations']) {
          const request = tx.objectStore(name).index('scope').openCursor(IDBKeyRange.only(key));
          on(request, cursor => {
            if (!cursor) return;
            const row = cursor.value;
            if (row.status === (name === 'tasks' ? 'running' : 'sending')) {
              cursor.update({...row, status: name === 'tasks' ? 'stopped' : 'review',
                updatedAt: now, recoveryReason: 'session-interrupted'});
              counts[name]++;
            }
            cursor.continue();
          });
        }
        done(counts);
      });
    },
  };
}
