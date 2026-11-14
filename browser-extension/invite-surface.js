/** Derive invitation UI authority only from Chrome sender identity, never page arguments. */
import {invitationSource} from './invite-sources.js';
export function invitationSurface(sender, runtime) {
  if (sender.id !== runtime.id || typeof sender.documentId !== 'string') return null;
  const own = new URL(runtime.getURL('invite.html'));
  let url; try { url = new URL(sender.url); } catch { return null; }
  const isPanel = url.protocol === own.protocol && url.host === own.host && url.pathname === own.pathname;
  const source = invitationSource(sender.tab?.url);
  if (isPanel && url.searchParams.get('embedded') === '1') {
    if (!source || !Number.isInteger(sender.tab?.id) || !(sender.frameId > 0)) return null;
    return {kind:'embedded', source, tabId:sender.tab.id, owner:`${sender.tab.id}:${sender.documentId}`};
  }
  if (isPanel && (!sender.tab?.url || new URL(sender.tab.url).protocol === own.protocol && new URL(sender.tab.url).host === own.host))
    return {kind:'page', owner:`${sender.tab?.id ?? 'popup'}:${sender.documentId}`};
  if (source && sender.frameId === 0 && sender.url === sender.tab.url)
    return {kind:'toolbar', source, tabId:sender.tab.id, owner:`${sender.tab.id}:${sender.documentId}`};
  return null;
}
export function selectedExport(rows, ids, records) {
  if (ids === undefined) return rows;
  if (!Array.isArray(ids) || ids.length > 10000 || ids.some(id => typeof id !== 'string' || !id || id.length > 200))
    throw new Error('导出选择无效');
  const wanted = new Set(ids);
  return rows.filter(row => wanted.has(row.id));
}
