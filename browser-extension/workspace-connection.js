/** Active extension-document ownership. A disconnected document cannot resume queued work. */
import {invitationSurface} from './invite-surface.js';
export function createWorkspaceConnections({runtime, initialize, verify, onExpire = () => {}}) {
  const owners = new Map();
  function expire(record) {
    if (!record.live) return;
    record.live = false;
    if (owners.get(record.owner) === record) owners.delete(record.owner);
    onExpire(record.owner);
    try { record.port.disconnect(); } catch {}
  }
  runtime.onConnect.addListener(port => {
    if (port.name !== 'invitation-workspace') return;
    const surface = invitationSurface(port.sender || {}, runtime);
    let path; try { path = new URL(port.sender.url).pathname; } catch {}
    if (surface?.kind !== 'embedded' || path !== '/invitation-workspace.html') { port.disconnect(); return; }
    const prior = owners.get(surface.owner); if (prior) expire(prior);
    const record = {owner:surface.owner,port,live:true,ready:false};
    owners.set(record.owner, record);
    port.onDisconnect.addListener(() => expire(record));
    void (async () => {
      await initialize(); verify();
      if (!record.live || owners.get(record.owner) !== record) return;
      record.ready = true;
      port.postMessage({type:'INVITATION_WORKSPACE_READY'});
    })().catch(() => expire(record));
  });
  return {
    capture(surface) {
      const record = owners.get(surface?.owner);
      if (surface?.kind !== 'embedded' || !record?.live || !record.ready) throw Error('工作区连接已失效，请重新打开');
      return () => {
        if (!record.live || !record.ready || owners.get(record.owner) !== record) throw Error('工作区文档已关闭，请重新打开');
      };
    },
    closeAll() { for (const record of [...owners.values()]) expire(record); },
  };
}
