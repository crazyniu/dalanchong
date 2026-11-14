/** Real profile settings and safe authorization status; no credentials are displayed. */
import {requirePageLicense} from './license-ui.js';
import {$, send} from './ui.js';
const license = await requirePageLicense();
$('version').textContent = `v${chrome.runtime.getManifest().version}`;
function showLicense(value) {
  $('license-state').textContent = value.valid ? '已激活' : '需要激活';
  $('expires').textContent = value.expiresAt ? `有效期至 ${new Date(value.expiresAt).toLocaleString()}` : '长期有效';
}
function status(message, error = false) { $('settings-status').textContent = message; $('settings-status').dataset.error = String(error); }
showLicense(license);
$('verify-license').addEventListener('click', async event => {
  const button = event.currentTarget; button.disabled = true;
  try { const result = await send({type:'LICENSE_VERIFY'}); showLicense(result.license); status('授权状态已更新'); }
  catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
});
$('settings-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true;
  try { await send({type:'SETTINGS_SAVE', shopName:$('shop-name').value, showShopName:$('show-shop-name').checked}); status('设置已保存'); }
  catch (error) { status(error.message, true); }
  finally { button.disabled = false; }
});
try { const value = await send({type:'SETTINGS_GET'}); $('shop-name').value = value.shopName; $('show-shop-name').checked = value.showShopName; }
catch (error) { status(error.message, true); }
