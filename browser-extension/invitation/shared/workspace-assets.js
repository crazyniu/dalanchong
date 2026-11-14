/** Check only the packaged local workspace before opening its platform entry. */
export async function assertInvitationAssets(fetchImpl = fetch) {
  const message = '邀约工作区尚未构建，请在仓库运行 pnpm install --frozen-lockfile 和 pnpm build:ui 后重新加载插件';
  try {
    const response = await fetchImpl(chrome.runtime.getURL('invitation/ui/invitation-ui.js'));
    if (!response?.ok || !(await response.text()).trim()) throw Error(message);
  } catch {
    throw Error(message);
  }
}
