/** Measure actual painted interactive surfaces, not zero-sized absolute-position wrappers. */
export function invitationLayout(document) {
  const modal = !!document.querySelector('[data-slot="dialog-overlay"],[data-slot="sheet-overlay"],[data-slot="alert-dialog-overlay"]');
  if (modal) return {type:'INVITATION_LAYOUT', modal:true, rects:[]};
  const selector = '[data-layout-region],[data-slot="invite-progress"],[data-testid="collection-log"],.collection-log-layer > button,[data-slot="select-content"],[data-slot="dropdown-menu-content"],[data-slot="dropdown-menu-sub-content"],[data-slot="context-menu-content"],[data-slot="tooltip-content"],[data-sonner-toast]';
  const rects = [...document.querySelectorAll(selector)].map(node => {
    const r = node.getBoundingClientRect();
    return {x:r.x,y:r.y,width:r.width,height:r.height};
  }).filter(r => Object.values(r).every(Number.isFinite) && r.width > 0 && r.height > 0);
  // Never silently clip a keyboard-accessible popup when several surfaces are visible.
  return {type:'INVITATION_LAYOUT',modal:rects.length > 8,rects:rects.length > 8 ? [] : rects};
}
