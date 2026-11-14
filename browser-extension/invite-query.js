/** Worker-side pagination keeps account-wide data out of page refresh messages. */
import {normalizedFilters, matchesTalent} from './invite-filter.js';
export async function queryInvitationData(store, scope, input) {
  if (!input || !['talents','records','record'].includes(input.kind)) throw Error('查询类型无效');
  if (input.kind === 'record') {
    if (typeof input.id !== 'string' || input.id.length > 300) throw Error('记录 ID 无效');
    const records = await store.exportRows(scope, {}, true);
    return {record: records.find(row => row.id === input.id) || null};
  }
  const size = input.pageSize === undefined ? 20 : input.pageSize;
  const requestedPage = input.page === undefined ? 1 : input.page;
  if (!Number.isSafeInteger(size) || size < 1 || size > 1000 || !Number.isSafeInteger(requestedPage) || requestedPage < 1) throw Error('分页参数无效');
  const records = input.kind === 'records';
  let all, invitationById;
  let filtered;
  if (records) {
    filtered = await store.exportRows(scope, input.filters || {}, true);
  } else {
    const filters = normalizedFilters(input.filters || {});
    const snapshots = await Promise.all([store.exportRows(scope, {}, false), store.exportRows(scope, {}, true)]);
    all = snapshots[0];
    invitationById = new Map();
    // Records are newest-first. Preserve the latest outcome if a source ever has repeats.
    for (const row of snapshots[1]) if (!invitationById.has(row.talentId)) invitationById.set(row.talentId, row);
    filtered = all.filter(row => matchesTalent(row, filters, invitationById.get(row.id)));
  }
  const page = Math.min(requestedPage, Math.max(1, Math.ceil(filtered.length / size)));
  const rows = filtered.slice((page - 1) * size, page * size);
  const result = {rows, total: filtered.length, page};
  if (records) return result;
  return {...result, accountTotal: all.length,
    latestRecords: rows.map(row => invitationById.get(row.id)).filter(Boolean),
    sources: [...new Set(all.map(row => row.source).filter(Boolean))].sort(),
    columns: [...new Set(all.flatMap(row => Object.keys(row).filter(key => row[key] !== undefined && row[key] !== null && row[key] !== '')))]};
}
