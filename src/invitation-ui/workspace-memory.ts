/** Per-principal temporary drafts and selections. No task resumes automatically. */
import {useEffect,useRef,useState} from 'react'
import {useCommerce} from './store'
import type {InviteConfig,Platform} from './types'
type Scope={principalId:string;platform:Platform;accountId:string}
type Memory={selected:string[];inviteIds:string[];composeOpen:boolean;config?:InviteConfig}
const empty=():Memory=>({selected:[],inviteIds:[],composeOpen:false})
function validIds(value:unknown):value is string[]{return Array.isArray(value)&&value.length<=10000&&value.every(id=>typeof id==='string'&&id.length<=300)}
export function workspaceMemoryKey(scope:Scope){return 'invitation-workspace:'+JSON.stringify([scope.principalId,scope.platform,scope.accountId])}
export function sanitizedWorkspaceMemory(value:any):Memory|null {
 if(!value||!validIds(value.selected)||!validIds(value.inviteIds)||typeof value.composeOpen!=='boolean')return null
 const c=value.config
 const config=c&&['products','message','phone','wechat'].every(k=>typeof c[k]==='string'&&c[k].length<=10000)&&Number.isSafeInteger(c.interval)&&(c.maxInvites===null||Number.isSafeInteger(c.maxInvites))
   ? {products:c.products,message:c.message,phone:c.phone,wechat:c.wechat,interval:c.interval,maxInvites:c.maxInvites}:undefined
 return {selected:[...new Set<string>(value.selected)],inviteIds:[...new Set<string>(value.inviteIds)],composeOpen:value.composeOpen,config}
}
type Storage = {get:(key:string)=>Promise<Record<string,unknown>>;set:(data:Record<string,unknown>)=>Promise<void>}
/** Executable controller keeps render-time readiness and asynchronous hydration scoped. */
export function createWorkspaceMemoryController(storage:Storage,onChange:()=>void,onConfig:(accountId:string,config:InviteConfig)=>void) {
 type Current={key:string;accountId:string;value:Memory;ready:boolean;active:boolean;error:string;dirty:Set<keyof Memory>}
 let current:Current|null=null, serial=Promise.resolve()
 const newest=new Map<string,Current>()
 const notify=(item:Current)=>{if(item===current&&item.active)onChange()}
 function persist(item:Current) {
  if(!item.key||!item.ready||newest.get(item.key)!==item)return
  const saved=structuredClone(item.value)
  serial=serial.catch(()=>{}).then(()=>newest.get(item.key)===item?storage.set({[item.key]:saved}):undefined).catch(()=>{item.error='临时工作区保存失败';notify(item)})
 }
 return {
  bind(scope:Scope|null) {
   const nextKey=scope?workspaceMemoryKey(scope):''
   if(nextKey&&current?.key===nextKey){current.active=true;notify(current);return}
   if(current){current.active=false;if(current.ready&&current.dirty.size)persist(current)}
   const item:Current={key:scope?workspaceMemoryKey(scope):'',accountId:scope?.accountId||'',value:empty(),ready:false,active:true,error:'',dirty:new Set()};current=item
   if(item.key)newest.set(item.key,item)
   notify(item)
   if(!item.key)return
   void storage.get(item.key).then(result=>{
    const saved=sanitizedWorkspaceMemory(result[item.key])
    if(saved)for(const field of ['selected','inviteIds','composeOpen','config'] as const) {
     if(!item.dirty.has(field))Object.assign(item.value,{[field]:saved[field]})
    }
    item.ready=true
    if(item===current&&item.active&&item.value.config)onConfig(item.accountId,item.value.config)
    if(item.dirty.size)persist(item)
    notify(item)
   }).catch(()=>{item.error='临时工作区恢复失败';item.ready=true;if(item.dirty.size)persist(item);notify(item)})
  },
  view(key:string) {
   return current?.active&&current.key===key&&key
    ? {value:current.value,ready:current.ready,error:current.error}
    : {value:empty(),ready:false,error:''}
  },
  edit<K extends keyof Memory>(key:string,field:K,next:Memory[K]) {
   if(!key||!current?.active||current.key!==key||current.value[field]===next)return
   current.value={...current.value,[field]:next};current.dirty.add(field);persist(current);notify(current)
  },
  dispose(){if(current){current.active=false;if(current.ready&&current.dirty.size)persist(current)}},
  flushed:()=>serial,
 }
}
export function useWorkspaceMemory(scope:Scope|null) {
 const key=scope?.principalId&&scope.accountId?workspaceMemoryKey(scope):''
 const [,rerender]=useState(0)
 const controller=useRef<ReturnType<typeof createWorkspaceMemoryController>|null>(null)
 if(!controller.current)controller.current=createWorkspaceMemoryController(chrome.storage.session,()=>rerender(n=>n+1),(accountId,config)=>{
  useCommerce.setState(state=>({configs:{...state.configs,[accountId]:config}}))
 })
 const memory=controller.current
 useEffect(()=>{
  memory.bind(key?scope:null)
  const unsubscribe=useCommerce.subscribe((next,previous)=>{
   if(!scope)return
   const config=next.configs[scope.accountId]
   if(config&&config!==previous.configs[scope.accountId])memory.edit(key,'config',config)
  })
  return()=>{unsubscribe();memory.dispose()}
 },[key])
 const snapshot=memory.view(key)
 // Persisted sheet state is a return hint, never an automatic reopen or send.
 return {selected:snapshot.value.selected,setSelected:(ids:string[])=>memory.edit(key,'selected',ids),
  inviteIds:snapshot.value.inviteIds,setInviteIds:(ids:string[])=>memory.edit(key,'inviteIds',ids),
  composeWasOpen:snapshot.value.composeOpen,setComposeWasOpen:(open:boolean)=>memory.edit(key,'composeOpen',open),ready:snapshot.ready,error:snapshot.error}
}
