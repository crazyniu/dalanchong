import test from 'node:test';
import assert from 'node:assert/strict';
import {invitationLayout} from '../src/invitation-ui/layout.js';
const rect={x:5,y:6,width:380,height:200};
test('dialog, sheet and alert overlays request full viewport',()=>{
 assert.deepEqual(invitationLayout({querySelector(selector){assert.match(selector,/alert-dialog-overlay/);return {};}}),{type:'INVITATION_LAYOUT',modal:true,rects:[]});
});
test('actual progress/log/menu/toast surfaces are measured and zero-sized wrappers ignored',()=>{
 const result=invitationLayout({querySelector:()=>null,querySelectorAll(selector){
 for(const part of ['invite-progress','collection-log','collection-log-layer > button','select-content','dropdown-menu-content','data-sonner-toast'])assert.ok(selector.includes(part));
 return [rect,{...rect,width:0},{...rect,width:NaN}].map(r=>({getBoundingClientRect:()=>r}));
 }});
 assert.deepEqual(result.rects,[rect]);assert.equal(result.modal,false);
});
test('more than eight surfaces fail safe to a bounded full viewport message',()=>{
 const result=invitationLayout({querySelector:()=>null,querySelectorAll:()=>Array.from({length:9},()=>({getBoundingClientRect:()=>rect}))});
 assert.equal(result.modal,true);assert.deepEqual(result.rects,[]);
});
