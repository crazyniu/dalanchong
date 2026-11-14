/** Restore the source after an explicit login/navigation detour; no automatic navigation or work. */
import {listenMessages} from './messages.js';
import {licenseEpoch, requireLicense} from './license-background.js';
import {invitationSource, invitationSources} from './invite-sources.js';
export async function returnToInvitation(message, sender, {runtime, storage, tabs, verify}) {
  let url; try { url = new URL(sender.url); } catch { throw Error('来源无效'); }
  if (sender.id !== runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id) || sender.url !== sender.tab.url ||
    !invitationSources.some(source => source.origin === url.origin)) throw Error('来源无效');
  verify();
  const key = `invite-return:${sender.tab.id}`;
  const source = invitationSource(url.href);
  if (source) { await storage.set({[key]:source.origin + source.path}); verify(); return {ok:true,url:null}; }
  const saved = (await storage.get(key))[key];
  verify();
  const target = invitationSource(saved);
  if (!target || target.origin !== url.origin) return {ok:true,url:null};
  const destination = target.origin + target.path;
  if (message.type === 'INVITE_RETURN_OPEN') {
    const current = await tabs.get(sender.tab.id);
    verify();
    if (current.url !== sender.url) throw Error('页面已变化，请在当前页面重新操作。');
    await tabs.update(sender.tab.id,{url:destination});
  }
  return {ok:true,url:destination};
}
listenMessages(new Set(['INVITE_RETURN_STATUS','INVITE_RETURN_OPEN']),async(message,sender,reply)=>{
  const epoch=licenseEpoch();
  reply(await returnToInvitation(message,sender,{runtime:chrome.runtime,storage:chrome.storage.session,tabs:chrome.tabs,verify:()=>requireLicense(epoch)}));
});
chrome.tabs.onRemoved.addListener(tabId=>{void chrome.storage.session.remove(`invite-return:${tabId}`);});
