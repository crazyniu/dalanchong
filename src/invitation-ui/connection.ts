/** A live extension port pins actions to the current embedded document. */
export function connectInvitationWorkspace(runtime:Pick<typeof chrome.runtime,'connect'|'lastError'>=chrome.runtime) {
 return new Promise<{active:()=>boolean;close:()=>void;onDisconnect:(listener:()=>void)=>()=>void}>((resolve,reject)=>{
  const port=runtime.connect({name:'invitation-workspace'}),listeners=new Set<()=>void>()
  let connected=true,ready=false
  const timer=setTimeout(()=>{if(!ready){reject(Error('工作区连接超时'));port.disconnect()}},15000)
  const disconnected=()=>{
   void runtime.lastError
   if(!connected)return
   connected=false;clearTimeout(timer)
   if(!ready)reject(Error('工作区连接已关闭'))
   for(const listener of listeners)listener()
   listeners.clear()
  }
  port.onDisconnect.addListener(disconnected)
  port.onMessage.addListener(message=>{
   if(!connected||ready||message?.type!=='INVITATION_WORKSPACE_READY')return
   ready=true;clearTimeout(timer)
   resolve({active:()=>connected,close:()=>{port.disconnect();disconnected()},onDisconnect:listener=>{if(!connected)listener();else listeners.add(listener);return()=>{listeners.delete(listener)}}})
  })
 })
}
