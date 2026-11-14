/** Account-local list presentation and deletion selection. No platform requests. */
export function talentCopy(platform, row) {
  const label = platform === 'kuaishou' ? '快手号' : '昵称';
  // Match the platform adapter's identifier; never infer an account ID from a UID or URL.
  const value = platform === 'kuaishou' ? row.id : row.name;
  return {label, value: typeof value === 'string' ? value.trim() : ''};
}
export function talentTableMetrics(platform, metrics) {
  const keys = platform === 'kuaishou' ? ['sales30d', 'sales7d'] : ['sales30d', 'settlement30d'];
  return keys.map(key => metrics.find(([name]) => name === key)).filter(Boolean);
}
export async function deleteTalentSelection({selected, listIds, confirm, remove}) {
  const hasSelection = selected.length > 0;
  const ids = [...new Set(hasSelection ? selected : await listIds())];
  if (!ids.length) return false;
  if (ids.length > 10000 || ids.some(id => typeof id !== 'string' || !id)) throw Error('删除范围无效。');
  const range = hasSelection ? `已勾选的 ${ids.length} 位达人，包含其他页和筛选外的已选达人` : `当前账号全部 ${ids.length} 位已采集达人，包含筛选外的数据`;
  if (!confirm(`删除${range}？此操作无法恢复。邀约历史及防重复标记会保留。`)) return false;
  await remove(ids);
  return true;
}
