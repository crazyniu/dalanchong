/** Local-only list filtering; no platform requests, authorization or data transmission. */
export function normalizedFilters(input = {}, records = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('筛选条件无效');
  const result = {query: String(input.query || '').trim().toLocaleLowerCase().slice(0, 200)};
  if (records) {
    result.status = input.status || 'all';
    if (!['all', 'sending', 'success', 'failed', 'skipped', 'review'].includes(result.status)) throw new Error('记录状态无效');
    for (const key of ['from', 'to']) if (input[key]) {
      const value = Date.parse(input[key]);
      if (!Number.isFinite(value)) throw new Error('日期筛选无效');
      result[key] = value;
    }
    if (result.from !== undefined && result.to !== undefined && result.from > result.to) throw new Error('开始日期不能晚于结束日期');
  } else {
    result.invitationStatus = input.invitationStatus || 'all'; result.gender = input.gender || 'all';
    if (!['all', 'invited', 'uninvited'].includes(result.invitationStatus) || !['all', 'male', 'female', 'unknown'].includes(result.gender)) throw new Error('达人筛选无效');
    result.source = String(input.source || '').trim().slice(0, 200);
    for (const key of ['minFans', 'maxFans']) if (input[key] !== undefined && input[key] !== '') {
      if (!Number.isFinite(Number(input[key])) || Number(input[key]) < 0) throw new Error('粉丝范围无效');
      result[key] = Number(input[key]);
    }
    if (result.minFans !== undefined && result.maxFans !== undefined && result.minFans > result.maxFans) throw new Error('粉丝最小值不能大于最大值');
  }
  return result;
}
export function matchesTalent(row, filters, invitation) {
  const query = filters.query;
  if (query && ![row.name, row.id, row.uid].some(value => String(value || '').toLocaleLowerCase().includes(query))) return false;
  if (filters.invitationStatus === 'invited' && !invitation || filters.invitationStatus === 'uninvited' && invitation) return false;
  const gender = ['male', '男', 1].includes(row.gender) ? 'male' : ['female', '女', 2].includes(row.gender) ? 'female' : 'unknown';
  if (filters.gender !== 'all' && filters.gender !== gender) return false;
  if (filters.source && !String(row.source || '').includes(filters.source)) return false;
  if (filters.minFans !== undefined && (!Number.isFinite(row.fans) || row.fans < filters.minFans)) return false;
  if (filters.maxFans !== undefined && (!Number.isFinite(row.fans) || row.fans > filters.maxFans)) return false;
  return true;
}
export function matchesRecord(row, filters) {
  if (filters.query && ![row.talentId, row.name, row.note].some(value => String(value || '').toLocaleLowerCase().includes(filters.query))) return false;
  if (filters.status !== 'all' && row.status !== filters.status) return false;
  const time = Date.parse(row.updatedAt || row.createdAt);
  if (filters.from !== undefined && (!Number.isFinite(time) || time < filters.from)) return false;
  if (filters.to !== undefined && (!Number.isFinite(time) || time > filters.to)) return false;
  return true;
}
