/** Open the platform source, never a detached invitation form. No collection or sending. */
import {invitationSource} from './invite-sources.js';
export const invitationEntryUrls = Object.freeze({douyin:'https://buyin.jinritemai.com/dashboard/servicehall/daren-square', kuaishou:'https://cps.kwaixiaodian.com/zone/daren-match/peer-reference'});
export async function openInvitationSource({tabs, windows, verify}, platform, preferredTab) {
  if (!Object.hasOwn(invitationEntryUrls, platform)) throw Error('请选择邀约平台。');
  await verify();
  const all = await tabs.query({});
  await verify();
  const candidate = [preferredTab, ...all.filter(tab => tab.active), ...all].find(tab => tab?.id !== undefined && invitationSource(tab.url)?.platform === platform);
  if (candidate) {
    await tabs.update(candidate.id, {active:true});
    await verify();
    if (windows && candidate.windowId !== undefined) await windows.update(candidate.windowId, {focused:true});
    return candidate;
  }
  await verify();
  return tabs.create({url:invitationEntryUrls[platform]});
}
