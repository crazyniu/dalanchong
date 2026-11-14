import {useEffect,useState,useRef} from 'react'
import {createRoot} from 'react-dom/client'
import {Toaster,toast} from 'sonner'
import css from './ui.css?inline'
import {invitationLayout} from './layout.js'
import {CollectionToolbar,type ToolbarAction} from './collection-toolbar'
import {CollectionList} from './collection-list'
import {InviteCompose} from './invite-compose'
import {InviteProgress} from './invite-progress'
import {CollectionLog} from './collection-log'
import {RecordsDialog} from './records'
import {TaskLogsDialog} from './task-logs'
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog'
import {useCommerce,updateInvitationWorkspace,refreshInvitationWorkspace,clearInvitationWorkspace,loadInvitationConfig} from './store'
import {invitationRuntime,invitationRequest} from './runtime'
import {openTalentProfile} from './talent-profile'
import {useWorkspaceMemory} from './workspace-memory'
import type {Platform} from './types'

async function request(type:string,payload:Record<string,unknown>={}) {
 const result=await chrome.runtime.sendMessage({type,...payload})
 if(!result?.ok) throw Error(result?.error || '插件后台未响应')
 return result
}
function Workspace(){
 const [context,setContext]=useState<{platform:Platform;tabId:number;sourceOrigin:string}|null>(null)
 const [session,setSession]=useState(''),[accountId,setAccountId]=useState(''),[status,setStatus]=useState<any>({})
 const [listOpen,setListOpen]=useState(false),[composeOpen,setComposeOpen]=useState(false),[logsOpen,setLogsOpen]=useState(false),[recordsOpen,setRecordsOpen]=useState(false)
 const [principalId,setPrincipalId]=useState(''),[pending,setPending]=useState(false),[busy,setBusy]=useState(false)
 const memory=useWorkspaceMemory(principalId&&accountId&&context?{principalId,platform:context.platform,accountId}:null)
 const {selected,setSelected,inviteIds,setInviteIds}=memory
 const [position,setPosition]=useState({x:0,y:0})
 const tasks=useCommerce(s=>s.tasks),accounts=useCommerce(s=>s.accounts)
 const binding=useRef(''),parentOrigin=useRef(''),lastError=useRef('')
 useEffect(()=>{let live=true;let polling=false
 const refresh=async()=>{if(polling)return;polling=true
 try{
 const host=await request('INVITE_HOST_CONTEXT'); if(!live)return;setContext(host);parentOrigin.current=host.sourceOrigin
 const state=await request('INVITE_TOOLBAR_STATUS'); if(!live)return;setStatus(state)
 const auth=await request('INVITE_STATUS');if(!live)return
 if(!auth.license?.valid||!auth.license?.principalId)throw Error('授权已失效')
 const prepared=await request('INVITE_PREPARE');if(!live)return
 const id=prepared.observation?.account?.shopId
 if(!id)throw Error('请在当前网页登录后重新准备')
 const key=`${auth.license.principalId}:${host.platform}:${id}`
 const changed=binding.current!==key
 if(changed){binding.current=key;setComposeOpen(false);setListOpen(false);setLogsOpen(false);setRecordsOpen(false);clearInvitationWorkspace()}
 setPrincipalId(auth.license.principalId);setSession(prepared.sessionId);setAccountId(id)
 updateInvitationWorkspace({sessionId:prepared.sessionId,platform:host.platform,accountId:id,observation:prepared.observation})
 await refreshInvitationWorkspace();lastError.current=''
 }catch(error){if(live){setStatus({});clearInvitationWorkspace();setAccountId('');setPrincipalId('');binding.current='';setSession('');setComposeOpen(false);setListOpen(false);setLogsOpen(false);setRecordsOpen(false);const detail=error instanceof Error?error.message:'无法连接当前页面';if(lastError.current!==detail){lastError.current=detail;toast.error(detail)}}}finally{polling=false}}
 void refresh();const timer=setInterval(refresh,2000)
 return()=>{live=false;clearInterval(timer);clearInvitationWorkspace()}
 },[])
 useEffect(()=>{
 const send=()=>{
 const toolbar=document.querySelector('.floating-toolbar')?.getBoundingClientRect()
 const clearance=`${toolbar ? innerHeight-toolbar.top+12 : 100}px`
 if(document.documentElement.style.getPropertyValue('--invitation-toolbar-clearance')!==clearance)document.documentElement.style.setProperty('--invitation-toolbar-clearance',clearance)
 if(parentOrigin.current)parent.postMessage(invitationLayout(document),parentOrigin.current)}
 const observer=new MutationObserver(send);observer.observe(document.body,{subtree:true,childList:true,attributes:true});window.addEventListener('resize',send);const timer=setInterval(send,250);send()
 return()=>{observer.disconnect();clearInterval(timer);window.removeEventListener('resize',send)}
 },[])
 useEffect(()=>{if(memory.ready&&accountId)void loadInvitationConfig().catch(e=>toast.error(String(e)))},[memory.ready,accountId])
 useEffect(()=>{if(memory.error)toast.error(memory.error)},[memory.error])
 const closeCompose=(open:boolean)=>{setComposeOpen(open);memory.setComposeWasOpen(open)}
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);try{await fn()}catch(e){toast.error(e instanceof Error?e.message:'操作失败')}finally{setBusy(false)}}
 const action=(event:ToolbarAction)=>{
 if(event.type==='view'){setListOpen(event.view==='list');return}
 if(event.type==='logs'){setLogsOpen(true);return}if(event.type==='records'){setRecordsOpen(true);return}
 if(event.type==='return'){void run(async()=>{const observed=await invitationRequest('INVITE_OBSERVE');if(observed.observation?.account?.status!=='online'||observed.observation?.account?.shopId!==accountId)throw Error('请先完成当前账号登录');const ids=await invitationRuntime.queryData<string[]>({kind:'invite_ids',platform:context?.platform,accountId,ids:inviteIds});if(!ids.length)throw Error('没有无邀约记录的达人');setInviteIds(ids);setListOpen(true);closeCompose(true);setPending(false)});return}
 void run(()=>request(event.type==='collect'?'INVITE_TOOLBAR_COLLECT':event.type==='stop'?'INVITE_TOOLBAR_STOP':'INVITE_TOOLBAR_NAV',{action:event.type}))
 }
 const platform=context?.platform || 'douyin', collectTask=tasks[`${accountId}:collect`],inviteTask=tasks[`${accountId}:invite`]
 const openInvite=(ids:string[])=>{const store=useCommerce.getState();const config=store.configs[accountId]||{products:'',message:'',phone:'',wechat:'',interval:platform==='kuaishou'?2000:5000,maxInvites:null};store.saveConfig(accountId,{...config,interval:Math.max(platform==='kuaishou'?2000:5000,config.interval),maxInvites:null});setInviteIds(ids);closeCompose(true)}
 return <>
 <div data-layout-region className='floating-toolbar' style={{marginLeft:position.x,marginBottom:position.y}}>
 <CollectionToolbar state={{accountId,view:'collect',count:status.total||0,collecting:!!status.collecting,inviting:!!status.inviting,pendingInvite:pending||memory.composeWasOpen,returning:false,navigationDisabled:busy||!status.readiness||status.collecting||status.inviting,disabled:!status.collecting&&(busy||!status.readiness),label:status.collecting?'停止采集':busy?'正在启动':!status.loggedIn?'网页未就绪':!status.readiness?'等待网页筛选':'开始采集'}} onAction={action} onMove={(x,y)=>setPosition(p=>({x:Math.max(-innerWidth/3,Math.min(innerWidth/3,p.x+x)),y:Math.max(0,Math.min(innerHeight-100,p.y-y))}))}/>
 </div>
 <Dialog open={listOpen} onOpenChange={setListOpen}>
 <DialogContent className='flex max-h-[85vh] flex-col gap-0 p-0 sm:max-w-[1180px]'>
 <DialogHeader className='flex-row items-center justify-between border-b px-6 py-5 pr-12'><DialogTitle>采集列表 · {status.total||0}</DialogTitle><DialogDescription className='sr-only'>查看已采集达人并选择邀约</DialogDescription></DialogHeader>
 <div className='min-h-0 flex-1 overflow-y-auto'>{listOpen&&accountId&&<CollectionList key={accountId} platform={platform} accountId={accountId} selected={selected} onSelect={setSelected} onInvite={openInvite} onCollect={()=>setListOpen(false)} onView={openTalentProfile}/>}</div>
 </DialogContent></Dialog>
 {composeOpen&&accountId&&<InviteCompose open onOpenChange={closeCompose} platform={platform} accountId={accountId} selectedIds={inviteIds} onLogin={()=>{setPending(true);memory.setComposeWasOpen(true);setComposeOpen(false);setListOpen(false);toast.info('请在当前网页完成登录，然后返回邀约')}} onStarted={()=>{closeCompose(false);setPending(false);setListOpen(true)}}/>}
 {logsOpen&&accountId&&<TaskLogsDialog open onOpenChange={setLogsOpen} platform={platform} accountId={accountId}/>}
 {recordsOpen&&accountId&&<RecordsDialog open onOpenChange={setRecordsOpen} records={[]} scope={{platform,accountId}}/>}
 {inviteTask?.status==='running'&&<div className='task-overlay-layer'><InviteProgress state={{tasks:[{name:accounts[0]?.name||'',platform,task:inviteTask}]}} onAction={()=>void run(()=>request('INVITE_STOP',{sessionId:session,kind:'invite'}))}/></div>}
 {collectTask&&!status.inviting&&<div className='task-overlay-layer collection-log-layer'><CollectionLog task={collectTask}/></div>}
 <Toaster/>
 </>
}
async function boot(){
 if(window===window.top||new URL(location.href).searchParams.get('embedded')!=='1')return
 await request('INVITE_HOST_CONTEXT')
 const style=document.createElement('style');style.textContent=css;document.head.append(style)
 const root=createRoot(document.getElementById('root')!);root.render(<Workspace/>);window.addEventListener('pagehide',()=>root.unmount(),{once:true})
}
void boot().catch(()=>{document.body.replaceChildren()})
