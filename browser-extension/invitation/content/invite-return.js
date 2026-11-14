/** A licensed, explicit return control on the platform after leaving a creator source. */
(() => {
  if (window !== window.top) return;
  const scope = globalThis.__dlcFeatureGate?.begin('invite-return'); if (!scope) return;
  const host = scope.createElement('div');
  host.style.cssText='position:fixed;bottom:16px;right:16px;z-index:2147483647';
  const shadow=host.attachShadow({mode:'closed'}), button=document.createElement('button');
  button.textContent='返回邀约';button.type='button';
  button.style.cssText='border:1px solid #d4d4d8;border-radius:10px;background:#fff;color:#18181b;padding:12px 20px;font:600 14px system-ui;box-shadow:0 4px 18px #0002;cursor:pointer';
  shadow.append(button);
  let route='',generation=0;
  async function refresh(){
    const current=++generation;
    try {
      const result=await chrome.runtime.sendMessage({type:'INVITE_RETURN_STATUS'});
      if(!scope.active||current!==generation)return;
      if(result?.ok&&result.url)document.documentElement.append(host);else host.remove();
    } catch { if(scope.active)host.remove(); }
  }
  scope.listen(button,'click',async()=>{
    button.disabled=true;
    try{await chrome.runtime.sendMessage({type:'INVITE_RETURN_OPEN'});}finally{if(scope.active)button.disabled=false;}
  });
  scope.setInterval(()=>{if(route!==location.href){route=location.href;void refresh();}},500);
  scope.cleanup(()=>{generation++;host.remove();});
  route=location.href;void refresh();
})();
