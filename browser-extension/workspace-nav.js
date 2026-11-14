/** Shared workspace navigation; invitation entries focus a licensed platform page, never start a task. */
import {openInvitationSource} from './invite-entry.js';
export async function verifyWorkspaceLicense(runtime) {
  const result = await runtime.sendMessage({type: 'LICENSE_STATUS'});
  if (!result?.ok || result.license?.valid !== true) throw Error('请先激活插件。');
}
export function bindWorkspaceNavigation(root, {tabs, windows, runtime, onError = () => {}}) {
  for (const button of root.querySelectorAll('[data-invitation-platform]')) {
    button.addEventListener('click', async () => {
      if (button.disabled) return;
      button.disabled = true;
      try {
        await openInvitationSource({tabs, windows, verify: () => verifyWorkspaceLicense(runtime)}, button.dataset.invitationPlatform);
      } catch (error) { onError(error.message); }
      finally { button.disabled = false; }
    });
  }
}
