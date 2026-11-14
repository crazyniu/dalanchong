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
export function useWorkspaceMemory(scope:Scope|null) {
 const key=scope?.principalId&&scope.accountId?workspaceMemoryKey(scope):''
 const [value,setValue]=useState<Memory>(empty),[ready,setReady]=useState(false),[error,setError]=useState('')
 const state=useRef({key:'',value:empty(),edited:0,ready:false,serial:Promise.resolve()})
 const persist=()=>{
  const current=state.current;if(!current.key||!current.ready)return
  const saved=structuredClone(current.value),savedKey=current.key
  current.serial=current.serial.catch(()=>{}).then(()=>chrome.storage.session.set({[savedKey]:saved})).catch(()=>{if(state.current===current)setError('临时工作区保存失败')})
 }
 useEffect(()=>{
  const current={key,value:empty(),edited:0,ready:false,serial:Promise.resolve()};state.current=current;setValue(empty());setReady(false);setError('')
  if(!key||!scope)return
  const accountId=scope.accountId
  const initialEdits=current.edited
  const unsubscribe=useCommerce.subscribe((next,previous)=>{
   if(state.current!==current||!next.configs[accountId]||next.configs[accountId]===previous.configs[accountId])return
   current.edited++;current.value={...current.value,config:next.configs[accountId]};setValue(current.value);persist()
  })
  void chrome.storage.session.get(key).then(result=>{
   if(state.current!==current)return
   const saved=sanitizedWorkspaceMemory(result[key])
   // Any user edit or freshly loaded config wins over an older asynchronous read.
   if(saved&&current.edited===initialEdits){
    current.value=saved
    if(saved.config)useCommerce.setState(s=>({configs:{...s.configs,[accountId]:saved.config!}}))
    setValue(current.value)
   }
   current.ready=true;setReady(true)
  }).catch(()=>{if(state.current===current){current.ready=true;setReady(true);setError('临时工作区恢复失败')}})
  return()=>{persist();unsubscribe();if(state.current===current)state.current={...current,key:'',ready:false}}
 },[key])
 function update<K extends 'selected'|'inviteIds'|'composeOpen'>(field:K,next:Memory[K]){
  if(state.current.key!==key||!key)return
  const current=state.current;current.edited++;current.value={...current.value,[field]:next};setValue(current.value);persist()
 }
 // A persisted open sheet is a return hint only, never an automatic reopen/send.
 return {selected:state.current.key===key?value.selected:[],setSelected:(ids:string[])=>update('selected',ids),
  inviteIds:state.current.key===key?value.inviteIds:[],setInviteIds:(ids:string[])=>update('inviteIds',ids),
  composeWasOpen:state.current.key===key&&value.composeOpen,setComposeWasOpen:(open:boolean)=>update('composeOpen',open),ready,error}
}
