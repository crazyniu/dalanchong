/** Account-local filters use the captured platform values and disclosed amount ranges. */
const salesMetrics = {
  kuaishou: ['sales30d', 'sales7d', 'avgLiveSales30d', 'avgLiveSales7d', 'videoSales30d', 'videoSales7d'],
  douyin: ['sales30d', 'liveSales30d', 'videoSales30d', 'settlement30d'],
};
function bounds(input, label) {
  const result = {min: input?.min ?? '', max: input?.max ?? ''};
  for (const value of Object.values(result)) {
    if (typeof value !== 'string' || (value !== '' && (!Number.isFinite(Number(value)) || Number(value) < 0)))
      throw new Error(`${label}范围无效`);
  }
  if (result.min !== '' && result.max !== '' && Number(result.min) > Number(result.max))
    throw new Error(`${label}最小值不能大于最大值`);
  return result;
}
export function normalizedFilters(input = {}, records = false, platform) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('筛选条件无效');
  const result = {query: String(input.query || '').trim().toLowerCase().slice(0, 200)};
  if (records) {
    result.status = input.status || 'all';
    if (!['all', 'sending', 'success', 'failed', 'skipped', 'review'].includes(result.status)) throw new Error('记录状态无效');
    for (const key of ['from', 'to']) if (input[key]) {
      const value = Date.parse(input[key]);
      if (!Number.isFinite(value)) throw new Error('日期筛选无效');
      result[key] = value;
    }
    if (result.from !== undefined && result.to !== undefined && result.from > result.to) throw new Error('开始日期不能晚于结束日期');
    return result;
  }
  result.status = input.status || 'all';
  if (!['all', 'pending', 'success'].includes(result.status)) throw new Error('邀约状态无效');
  result.choices = {};
  const gender = input.choices?.gender;
  if (gender) {
    if (!['男', '女'].includes(gender)) throw new Error('达人性别无效');
    result.choices.gender = gender;
  }
  const deliveryType = input.choices?.deliveryType;
  if (platform === 'douyin' && deliveryType) {
    if (!['live', 'video'].includes(deliveryType)) throw new Error('带货类型无效');
    result.choices.deliveryType = deliveryType;
  }
  result.ranges = {};
  if (input.ranges?.fans) result.ranges.fans = bounds(input.ranges.fans, '粉丝数');
  if (input.gmv) {
    if (!salesMetrics[platform].includes(input.gmv.metric)) throw new Error('销售额口径无效');
    result.gmv = {metric: input.gmv.metric, ...bounds(input.gmv, '金额')};
  }
  return result;
}
function salesRange(value) {
  if (value == null) return undefined;
  const text = value.trim().replace(/^[¥￥]/, '').replace(/[,，\s]/g, '');
  const match = text.match(/^(\d+(?:\.\d+)?)([万亿]?)(?:[-~～至–—](\d+(?:\.\d+)?)([万亿]?))?(\+)?$/);
  if (!match || (match[3] != null && match[5])) return undefined;
  const multiplier = unit => unit === '亿' ? 100_000_000 : unit === '万' ? 10_000 : 1;
  const lower = Number(match[1]), upper = match[3] == null ? lower : Number(match[3]);
  const lowerUnit = match[2] || (match[4] && lower <= upper ? match[4] : '');
  const min = lower * multiplier(lowerUnit);
  const max = match[5] ? null : upper * multiplier(match[3] == null ? lowerUnit : match[4]);
  if (!Number.isFinite(min) || (max != null && (!Number.isFinite(max) || min > max))) return undefined;
  return {min, max};
}
export function matchesTalent(row, filters, invitation, platform) {
  if (filters.query && ![row.name, row.id, row.source].some(value => String(value || '').toLowerCase().includes(filters.query))) return false;
  if (filters.status !== 'all' && filters.status !== (invitation?.status || 'pending')) return false;
  const gender = ['male', '男', 1].includes(row.gender) ? '男' : ['female', '女', 2].includes(row.gender) ? '女' : '';
  if (filters.choices.gender && filters.choices.gender !== gender) return false;
  if (platform === 'douyin' && filters.choices.deliveryType) {
    const primary = {'纯直播': 'live', '直播为主': 'live', '纯短视频': 'video', '短视频为主': 'video'}[row.salesMode];
    const deliveryTypes = row.deliveryTypes?.length ? row.deliveryTypes : primary ? [primary] : [];
    if (!deliveryTypes.includes(filters.choices.deliveryType)) return false;
  }
  const fans = filters.ranges.fans;
  if (fans && (fans.min !== '' || fans.max !== '')) {
    if (!Number.isFinite(row.fans) ||
        (fans.min !== '' && row.fans < Number(fans.min)) ||
        (fans.max !== '' && row.fans > Number(fans.max))) return false;
  }
  const gmv = filters.gmv;
  if (gmv && (gmv.min !== '' || gmv.max !== '')) {
    const range = salesRange(row[gmv.metric]);
    if (!range || (gmv.min !== '' && range.min < Number(gmv.min)) ||
        (gmv.max !== '' && (range.max == null || range.max > Number(gmv.max)))) return false;
  }
  return true;
}
export function matchesRecord(row, filters) {
  if (filters.query && ![row.talentId, row.name, row.note].some(value => String(value || '').toLowerCase().includes(filters.query))) return false;
  if (filters.status !== 'all' && row.status !== filters.status) return false;
  const time = Date.parse(row.createdAt || row.updatedAt);
  if (filters.from !== undefined && (!Number.isFinite(time) || time < filters.from)) return false;
  if (filters.to !== undefined && (!Number.isFinite(time) || time > filters.to)) return false;
  return true;
}
