/** Licensed display host. Child messages control hit regions only, never business actions. */
(() => {
  if (window !== window.top) return;
  const scope = globalThis.__dlcFeatureGate?.begin('invitation-host');
  if (!scope) return;
  const routes = {
    'https://buyin.jinritemai.com': ['/dashboard/servicehall/daren-square', '/dashboard/servicehall/clue-daren', '/dashboard/servicehall/peer-reference', '/dashboard/ranklist/daren'],
    'https://cps.kwaixiaodian.com': ['/zone/daren-match/daren-square-pro', '/zone/daren-match/peer-reference', '/zone-cps/promoter-rank-list'],
  };
  const supported = () => routes[location.origin]?.includes(location.pathname) === true;
  const origin = chrome.runtime.getURL('/').replace(/\/$/, '');
  let frame = null, route = '', expectedFrame = null;
  let lockedBody = null, previousInert = false;
  function setCollecting(collecting) {
    if (collecting && !lockedBody) {
      lockedBody = document.body;
      previousInert = lockedBody.inert;
      lockedBody.inert = true;
      frame.focus();
    } else if (!collecting && lockedBody) {
      lockedBody.inert = previousInert;
      lockedBody = null;
    }
  }
  function hideRegions() { frame?.style.setProperty('clip-path', 'inset(100%)', 'important'); }
  function removeFrame() {
    setCollecting(false);
    expectedFrame = null;
    const old = frame; frame = null;
    if (old) { old.src = 'about:blank'; old.remove(); }
  }
  function syncRoute() {
    if (!scope.active) return;
    if (expectedFrame && !expectedFrame.isConnected) { scope.stop(); return; }
    const next = location.href;
    if (route === next) return;
    route = next; removeFrame();
    if (!supported()) return;
    frame = document.createElement('iframe');
    frame.title = '大懒虫达人邀约'; frame.referrerPolicy = 'no-referrer';
    frame.style.cssText = 'all:initial!important;position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;border:0!important;background:transparent!important;z-index:2147483647!important;clip-path:inset(100%)!important;pointer-events:auto!important;color-scheme:normal!important';
    frame.src = chrome.runtime.getURL('invitation-workspace.html?embedded=1');
    document.documentElement.append(frame); expectedFrame = frame;
  }
  scope.listen(window, 'message', event => {
    if (!frame || !supported() || location.href !== route || event.source !== frame.contentWindow || event.origin !== origin) return;
    const value = event.data;
    if (!value || value.type !== 'INVITATION_LAYOUT' || typeof value.modal !== 'boolean' || !Array.isArray(value.rects) || value.rects.length > 8) return;
    const rects = [];
    for (const rect of value.rects) {
      if (!rect || !['x','y','width','height'].every(key => typeof rect[key] === 'number' && Number.isFinite(rect[key])) || rect.width < 0 || rect.height < 0) return;
      // Limit all values before addition to avoid overflow or unreasonable CSS strings.
      if (Object.values({x:rect.x,y:rect.y,width:rect.width,height:rect.height}).some(n => Math.abs(n) > 1000000)) return;
      const left = Math.max(0, Math.min(innerWidth, rect.x));
      const top = Math.max(0, Math.min(innerHeight, rect.y));
      const right = Math.max(0, Math.min(innerWidth, rect.x + rect.width));
      const bottom = Math.max(0, Math.min(innerHeight, rect.y + rect.height));
      if (right > left && bottom > top) rects.push(`M${left} ${top}H${right}V${bottom}H${left}Z`);
    }
    setCollecting(value.collecting === true);
    frame.style.setProperty('clip-path', value.modal ? 'inset(0)' : rects.length ? `path('${rects.join(' ')}')` : 'inset(100%)', 'important');
  });
  scope.listen(window, 'resize', hideRegions);
  scope.listen(window, 'popstate', syncRoute);
  scope.listen(window, 'hashchange', syncRoute);
  scope.listen(window, 'pagehide', () => scope.stop());
  const removal = new scope.MutationObserver(() => {
    if (expectedFrame && !expectedFrame.isConnected) scope.stop();
  });
  removal.observe(document.documentElement, {childList:true, subtree:true});
  scope.cleanup(removeFrame);
  scope.setInterval(syncRoute, 500);
  syncRoute();
})();
