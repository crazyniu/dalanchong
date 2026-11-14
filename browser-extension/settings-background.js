/** Settings affect only this browser profile; writes require an authorized settings page. */
import {listenMessages} from './messages.js';
import {trustedLicensePage} from './license-background.js';
listenMessages(new Set(['SETTINGS_GET', 'SETTINGS_SAVE']), async (message, sender, respond) => {
  if (!trustedLicensePage(sender) || new URL(sender.url).pathname !== '/settings.html')
    throw new Error('请从插件设置页面操作');
  if (message.type === 'SETTINGS_SAVE') {
    if (typeof message.shopName !== 'string' || message.shopName.length > 40 || typeof message.showShopName !== 'boolean')
      throw new Error('请输入不超过40字的店铺名称');
    const name = message.shopName.trim();
    if (message.showShopName && !name) throw new Error('请先填写店铺名称');
    await chrome.storage.local.set({shopIdentity: message.showShopName ? {name} : null,
      settingsShopName: name});
  }
  const values = await chrome.storage.local.get(['shopIdentity', 'settingsShopName']);
  respond({ok: true, shopName: values.settingsShopName || values.shopIdentity?.name || '',
    showShopName: Boolean(values.shopIdentity?.name)});
});
