/**
 * AI module map
 * Purpose: obtain per-work format ordering without transmitting media addresses.
 * Entry: the video library awaits rankVideoFormats before exposing grouped choices.
 * Flow: bounded non-URL metadata reaches the authenticated rules API; returned index
 * order is attached to local records. Cached results are bound to an active license.
 * Boundary: no platform cookies, signed URLs, video bytes, or local policy fallback.
 */
import {videoGroupKey} from './media-records.js';
import {inviteLicense} from './invite-license.js';
import {licenseEpoch, requireLicense, onLicenseChange} from './license-background.js';
const cache = new Map();
onLicenseChange(state => { if (!state.valid) cache.clear(); });
export async function rankVideoFormats(items) {
  const epoch = licenseEpoch();
  requireLicense(epoch);
  const groups = new Map();
  for (const item of items) {
    const key = videoGroupKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const ranked = [];
  for (const group of groups.values()) {
    requireLicense(epoch);
    if (group.length === 1) { ranked.push({...group[0], ruleOrder: 0}); continue; }
    const candidates = group.map((item, index) => ({index, quality: String(item.quality || ''), height: Number(item.height) || 0, updatedAt: Number(item.updatedAt) || 0}));
    const key = JSON.stringify(candidates);
    let indices = cache.get(key);
    if (!indices) {
      indices = (await inviteLicense.rules('video.rank', {candidates})).indices;
      requireLicense(epoch);
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(key, indices);
    }
    indices.forEach((index, order) => ranked.push({...group[index], ruleOrder: order}));
  }
  requireLicense(epoch);
  return ranked;
}
