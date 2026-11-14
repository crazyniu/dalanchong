/**
 * AI module map
 * Purpose: identify the seven supported creator source routes in browser tabs.
 * Entry: Invitation backend calls invitationSource; source matching delegates to the shared invitation core.
 * Flow: compare exact HTTPS origin and pathname; query filters do not alter support.
 * Boundary: identification only, not login verification or collection permission.
 * The catalog adds display names; shared route matching remains authoritative.
 */
import {collectionPage} from '../core/collection-pages.mjs';

export const invitationSources = [
  {platform: 'douyin', name: '抖音达人广场', origin: 'https://buyin.jinritemai.com', path: '/dashboard/servicehall/daren-square'},
  {platform: 'douyin', name: '抖音线索达人', origin: 'https://buyin.jinritemai.com', path: '/dashboard/servicehall/clue-daren'},
  {platform: 'douyin', name: '抖音同行参考', origin: 'https://buyin.jinritemai.com', path: '/dashboard/servicehall/peer-reference'},
  {platform: 'douyin', name: '抖音达人榜单', origin: 'https://buyin.jinritemai.com', path: '/dashboard/ranklist/daren'},
  {platform: 'kuaishou', name: '快手达人广场', origin: 'https://cps.kwaixiaodian.com', path: '/zone/daren-match/daren-square-pro'},
  {platform: 'kuaishou', name: '快手同行参考', origin: 'https://cps.kwaixiaodian.com', path: '/zone/daren-match/peer-reference'},
  {platform: 'kuaishou', name: '快手达人榜单', origin: 'https://cps.kwaixiaodian.com', path: '/zone-cps/promoter-rank-list'},
];

export function invitationSource(url) {
  if (!url || !url.startsWith('https://')) return null;
  const current = new URL(url);
  return invitationSources.find(source => source.origin === current.origin && source.path === current.pathname && collectionPage(source.platform, url)) || null;
}
