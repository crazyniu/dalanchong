/** Pin a complete UI operation to one mounted account workspace. */
export function workspaceActionGuard(current:()=>{active:boolean;key:string}) {
 const initial=current()
 return ()=>{
  const next=current()
  if(!initial.active||!next.active||next.key!==initial.key)throw Error('当前工作区已改变，请重新操作')
 }
}
