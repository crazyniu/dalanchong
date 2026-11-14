/** Observable account-scoped view state; durable operations belong to the authorized background. */
import {create} from 'zustand'
import {bindInvitationSession,invitationRequest,invitationRuntime} from './runtime'
import {clearGuestSessions,updateGuestSession} from './browser-session'
import type {Account,CollectedTalent,DiagnosticLog,InviteConfig,InviteRecord,Platform,Task} from './types'
export const defaults:InviteConfig={products:'',message:'',phone:'',wechat:'',interval:5000,maxInvites:null}
type State={accounts:Account[];talents:CollectedTalent[];records:InviteRecord[];logs:DiagnosticLog[];tasks:Record<string,Task>;configs:Record<string,InviteConfig>;dataRevision:number;saveConfig:(id:string,config:InviteConfig)=>void;clearTalents:(platform:Platform,id:string,ids?:string[])=>Promise<void>;clearRecords:(ids:string[])=>Promise<void>;clearLogs:(platform?:Platform|'all',accountId?:string)=>Promise<void>;resolveRecord:(id:string,sent:boolean)=>Promise<void>}
let current:{sessionId:string;platform:Platform;accountId:string}|null=null
let generation=0
let dataFingerprint='', editRevision=0
export const useCommerce=create<State>((set)=>({accounts:[],talents:[],records:[],logs:[],tasks:{},configs:{},dataRevision:0,
 saveConfig(id,config){if(current?.accountId!==id)throw Error('当前账号不匹配');editRevision++;set(state=>({configs:{...state.configs,[id]:{...config}}}))},
 async clearTalents(platform,id,ids){await invitationRuntime.deleteData({kind:'talents',platform,accountId:id,ids});bump()},
 async clearRecords(ids){await invitationRuntime.deleteData({kind:'records',ids});bump()},
 async clearLogs(platform,accountId){await invitationRuntime.deleteData({kind:'logs',platform,accountId});bump()},
 async resolveRecord(id,sent){await invitationRuntime.resolveRecord(id,sent);bump()},
}))
function bump(){useCommerce.setState(s=>({dataRevision:s.dataRevision+1}))}
export function clearInvitationWorkspace(){generation++;dataFingerprint='';current=null;bindInvitationSession(null);clearGuestSessions();useCommerce.setState({accounts:[],talents:[],records:[],logs:[],tasks:{},configs:{},dataRevision:useCommerce.getState().dataRevision+1})}
export function updateInvitationWorkspace(input:{sessionId:string;platform:Platform;accountId:string;observation:any;tasks?:any[]}) {
 const next={sessionId:input.sessionId,platform:input.platform,accountId:input.accountId}
 if(current?.platform!==next.platform||current?.accountId!==next.accountId){clearInvitationWorkspace();current=next;bindInvitationSession(next)}
 else if(current.sessionId!==next.sessionId){generation++;current=next;bindInvitationSession(next)}
 const a=input.observation?.account
 if(a?.status!=='online'||String(a.shopId)!==input.accountId){clearInvitationWorkspace();return}
 const account:Account={id:input.accountId,platform:input.platform,name:a.shopName||a.name||'当前账号',shopId:input.accountId,sessionId:input.sessionId,status:'online',savedAt:'',quota:null,limit:null}
 useCommerce.setState({accounts:[account]});updateGuestSession(input.accountId,input.observation)
 if(input.tasks) applyTasks(input.tasks)
}
function applyTasks(rows:any[],logs:any[]=[]){if(!current)return;const tasks:Record<string,Task>={};for(const row of rows){if(row.platform&&row.platform!==current.platform||row.platformAccountId&&row.platformAccountId!==current.accountId)continue;const kind=row.kind;if(!['invite','collect'].includes(kind))continue;const key=current.accountId+':'+kind;if(tasks[key])continue;tasks[key]={accountId:current.accountId,kind,status:row.status==='running'?'running':row.status==='completed'?'done':'stopped',total:row.total||0,collected:row.success||0,processed:row.processed||0,success:row.success||0,failed:row.failed||0,skipped:row.skipped||0,review:row.review||0,current:row.current||row.detail||'',retryAt:row.retryAt,startedAt:row.createdAt,filters:{keyword:'',category:'',fans:'',level:''},activity:logs.filter(log=>log.taskId===row.id).reverse().map(log=>({time:log.createdAt,message:log.message,level:log.status==='failed'?'error':log.status==='success'?'success':'info'}))}}useCommerce.setState({tasks})}
export async function refreshInvitationWorkspace(){
 if(!current)return
 const rev=generation
 try {
  const [state,logs]=await Promise.all([invitationRequest('INVITE_STATUS'),invitationRequest('INVITE_LOGS',{offset:0,limit:200})])
  if(rev!==generation)return
  if(!state.license?.valid){clearInvitationWorkspace();return}
  applyTasks(state.tasks||[],logs.rows||[]);const nextFingerprint=JSON.stringify([(state.tasks||[]).map((t:any)=>[t.id,t.status,t.processed,t.success,t.failed,t.skipped,t.review]),(logs.rows||[]).map((l:any)=>l.id)]);if(nextFingerprint!==dataFingerprint){dataFingerprint=nextFingerprint;bump()}
 } catch(error) { if(rev===generation)clearInvitationWorkspace();throw error }
}
export async function loadInvitationConfig(){if(!current)return;const rev=generation,edits=editRevision,id=current.accountId;const {config}=await invitationRequest('INVITE_CONFIG_GET');if(rev===generation&&edits===editRevision&&!useCommerce.getState().configs[id]&&config)useCommerce.setState(s=>({configs:{...s.configs,[id]:config}}))}
export async function persistInvitationConfig(){if(!current)return;const config=useCommerce.getState().configs[current.accountId];if(config)await invitationRequest('INVITE_CONFIG_SAVE',{config})}
