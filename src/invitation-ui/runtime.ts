/** Account-bound extension message adapter. No platform credentials or simulated results. */
import {platformNames, statusNames, type CollectedTalent, type InviteConfig, type InviteRecord, type Platform} from './types'
import {exportRecords, exportText, formatTime} from './format'
import {formatSalesAmount, salesMetricOptions, talentDeliveryLabel} from './talent-commerce'
type Session = {sessionId:string; platform:Platform; accountId:string}
export type Query = {kind:string; [key:string]:unknown}
let binding: Session | null = null
let revision = 0
const mutationListeners=new Set<(session:Session)=>void>()
export function onInvitationMutation(listener:(session:Session)=>void) {
  mutationListeners.add(listener)
  return ()=>{mutationListeners.delete(listener)}
}
function notifyMutation(token:ReturnType<typeof snapshot>) {
  if(!binding||token.revision!==revision)return
  for(const listener of mutationListeners) {
    try { listener({...token.session}) } catch { /* Refresh subscribers cannot change an operation's result. */ }
  }
}
export function bindInvitationSession(value: Session | null) {
  if (JSON.stringify(binding) !== JSON.stringify(value)) { binding = value && {...value}; revision++ }
}
function snapshot(request?: {platform?:string;accountId?:string}) {
  if (!binding) throw Error('请先准备当前账号')
  if (request?.platform && request.platform !== 'all' && request.platform !== binding.platform || request?.accountId && request.accountId !== 'all' && request.accountId !== binding.accountId) throw Error('当前账号不匹配')
  return {session:{...binding}, revision}
}
function assertCurrent(token: ReturnType<typeof snapshot>) {
  if (!binding || token.revision !== revision) throw Error('当前账号已改变，请重试')
}
async function send(token:ReturnType<typeof snapshot>, type:string, payload:Record<string,unknown> = {}) {
  assertCurrent(token)
  const response = await chrome.runtime.sendMessage({...payload,type,sessionId:token.session.sessionId})
  assertCurrent(token)
  if (!response?.ok) throw Error(response?.error || '插件后台未响应')
  return response
}
export async function invitationRequest(type:string, payload:Record<string,unknown> = {}) { return send(snapshot(),type,payload) }
function filters(q:any) {
  if (q.kind === 'records') return {query:q.query || '',status:q.status || 'all',...(q.since ? {from:q.since}: {})}
  return {query:q.query || '',...q.filters}
}
function talent(row:any,s:Session):CollectedTalent { return {...row,platform:s.platform,sourceAccountId:s.accountId,name:row.name || '',source:row.source || '',collectedAt:row.collectedAt || row.updatedAt || '',gender:row.gender==='male'?'男':row.gender==='female'?'女':row.gender} }
export function storedResponse(value:unknown) {
  if(typeof value !== 'string') return value
  try {
    const parsed=JSON.parse(value)
    if(parsed && typeof parsed==='object' && !Array.isArray(parsed) && typeof parsed.path==='string' && 'body' in parsed) return parsed
  } catch { /* A truncated response remains readable exactly as stored. */ }
  return {path:'',body:value}
}
function record(row:any,s:Session):InviteRecord { return {...row,platform:s.platform,accountId:s.accountId,talentUid:row.uid,time:row.createdAt || row.updatedAt || '',...(row.response!==undefined?{response:storedResponse(row.response)}:{}),name:row.name || '',source:row.source || '',products:row.products ?? '未保存',message:row.message ?? '未保存',note:row.note || ''} }
function page(rows:any[],q:any) {
  const size=Number.isSafeInteger(q.pageSize)&&q.pageSize>0?Math.min(q.pageSize,1000):20
  const current=Math.min(Math.max(1,Number.isSafeInteger(q.page)?q.page:1),Math.max(1,Math.ceil(rows.length/size)))
  return {rows:rows.slice((current-1)*size,current*size),total:rows.length,page:current}
}
async function exported(token:ReturnType<typeof snapshot>,q:any):Promise<any[]> {
  const result=await send(token,'INVITE_EXPORT',{view:q.kind==='records'?'records':'talents',filters:filters(q),...(q.ids?{ids:q.ids}:{})})
  if(!Array.isArray(result.rows)) throw Error('数据响应无效')
  return q.kind==='records' ? result.rows.map((row:any)=>({...row,accountName:result.accountName || ''})) : result.rows as any[]
}
async function errorLogs(token:ReturnType<typeof snapshot>) {
  const rows:any[]=[]
  for(let offset=0;;offset+=1000) {
    const result=await send(token,'INVITE_LOGS',{offset,limit:1000})
    if(!Array.isArray(result.rows)) throw Error('日志响应无效')
    rows.push(...result.rows.filter((row:any)=>row.level==='error'||row.status==='failed'))
    if(result.rows.length<1000) break
  }
  return rows
}
function diagnosticLog(row:any,s:Session) {
  return {id:row.id,time:row.createdAt,accountId:s.accountId,platform:s.platform,taskId:row.taskId,level:'error',message:row.message,
    ...(row.response!==undefined?{response:storedResponse(row.response)}:{})}
}
export const invitationRuntime = {
  async queryData<T>(request:Query):Promise<T> {
    const q = request as any
    const token=snapshot(q), s=token.session
    if(q.kind==='invite_ids') {
      const result=await send(token,'INVITE_TALENT_IDS',{filters:q.ids?{}:filters(q),excludeInvited:true})
      const chosen=q.ids && new Set(q.ids)
      return (chosen?result.ids.filter((id:string)=>chosen.has(id)):result.ids) as T
    }
    if(['record','records','talents'].includes(q.kind)) {
      const result = await send(token,'INVITE_QUERY',{query:{kind:q.kind,id:q.id,filters:filters(q),page:q.page ?? 1,pageSize:q.pageSize ?? 20}})
      const data = result.data
      if (!data || typeof data !== 'object') throw Error('数据响应无效')
      if(q.kind==='record') return (data.record ? record(data.record,s) : null) as T
      if(!Array.isArray(data.rows)||!Number.isSafeInteger(data.total)) throw Error('分页响应无效')
      return {...data,rows:data.rows.map((row:any)=>q.kind==='records'?record(row,s):talent(row,s)),
        ...(q.kind==='talents'?{latestRecords:(data.latestRecords || []).map((row:any)=>record(row,s))}:{})} as T
    }
    if(q.kind==='logs') {
      return page((await errorLogs(token)).map(row=>diagnosticLog(row,s)),q) as T
    }
    throw Error('不支持的数据查询')
  },
  async exportData(q:any) {
    const token=snapshot(q)
    if(q.kind==='logs') {
      const rows=(await errorLogs(token)).map(row=>diagnosticLog(row,token.session)).reverse()
      assertCurrent(token)
      return {saved:rows.length>0&&exportText(rows.map(row=>JSON.stringify(row)).join('\n')+'\n','大懒虫-错误日志.ndjson','application/x-ndjson;charset=utf-8'),count:rows.length}
    }
    const stored=await exported(token,q)
    let rows:object[]
    if(q.kind==='records') rows=stored.map(value=>{
      const row=record(value,token.session)
      return {时间:formatTime(row.time),平台:platformNames[row.platform],账号:value.accountName,达人:row.name,达人ID:row.talentId,状态:statusNames[row.status],商品ID:row.products,话术:row.message,备注:row.note}
    })
    else {
      const [{data},history]=await Promise.all([
        send(token,'INVITE_QUERY',{query:{kind:'talents',filters:{},page:1,pageSize:1}}),
        exported(token,{kind:'records'}),
      ])
      const latest=new Map<string,any>()
      for(const row of history) if(!latest.has(row.talentId)) latest.set(row.talentId,row)
      const options=salesMetricOptions[token.session.platform]
      const columns=(data.columns as string[]).map(key=>options.find(option=>option.value===key)!)
      rows=stored.map(value=>{
        const row=talent(value,token.session), prior=latest.get(row.id)
        return {达人:row.name,达人ID:row.id,头像:row.avatarUrl || '',最近邀约:prior?statusNames[prior.status as InviteRecord['status']]:'未邀约',性别:row.gender==='男'||row.gender==='女'?row.gender:'',
          ...(row.platform==='douyin'?{带货类型:talentDeliveryLabel(row)}:{}),粉丝数:row.fans ?? '',
          ...Object.fromEntries(columns.map(({value,label})=>[label,formatSalesAmount(row[value])])),来源:row.source,采集时间:formatTime(row.collectedAt)}
      })
    }
    assertCurrent(token)
    const saved=await exportRecords(rows,q.kind==='records'?'邀约记录.csv':'采集达人.csv')
    return {saved,count:rows.length}
  },
  async deleteData(q:any) {
    const token=snapshot(q)
    const ids=q.kind==='logs' ? (await errorLogs(token)).map(row=>row.id) : q.ids || (await exported(token,q.kind==='records'?q:{kind:'talents'})).map(row=>row.id)
    if(!ids.length) return
    const type=q.kind==='logs'?'INVITE_DELETE_LOGS':q.kind==='records'?'INVITE_DELETE_RECORDS':'INVITE_DELETE_TALENTS'
    let deleted=0
    for(let offset=0;offset<ids.length;offset+=10000) {
      try {
        const result=await send(token,type,{ids:ids.slice(offset,offset+10000)})
        if(!Number.isSafeInteger(result.deleted)||result.deleted<0)throw Error('删除结果无效')
        deleted+=result.deleted
        notifyMutation(token)
      } catch(error) {
        notifyMutation(token)
        throw Error(`已确认清理 ${deleted} 条；其余结果未确认，请刷新列表核对。${error instanceof Error?error.message:String(error)}`)
      }
    }
    return {deleted}
  },
  async start(accountId:string,config:InviteConfig,ids:string[]) { const token=snapshot({accountId});await send(token,'INVITE_CONFIG_SAVE',{config});return send(token,'INVITE_SEND',{config,ids}) },
  async stop(accountId:string,kind:'collect'|'invite') { return send(snapshot({accountId}),'INVITE_STOP',{kind}) },
  async resolveRecord(id:string,sent:boolean) { const token=snapshot();try { const result=await send(token,'INVITE_REVIEW',{talentId:id,result:sent?'success':'not-sent'});notifyMutation(token);return result } catch(error) {notifyMutation(token);throw error} },
  async openTalentProfile(value:Pick<CollectedTalent,'platform'|'id'|'uid'>) {
    const token=snapshot({platform:value.platform})
    const rows=await exported(token,{kind:'talents',ids:[value.id]})
    const row=rows.find(row=>row.id===value.id)
    // History may outlive collected rows; recover only from this account's records.
    const stored=row || (await exported(token,{kind:'records',ids:[value.id]})).find(row=>row.talentId===value.id)
    if(!stored) throw Error('当前账号没有该达人记录')
    const uid=stored.uid
    if(value.platform==='douyin'&&!uid) throw Error('缺少达人 UID，请重新采集')
    const url=value.platform==='kuaishou'
      ? 'https://cps.kwaixiaodian.com/zone/daren-match/daren-detail?'+new URLSearchParams({promoterId:stored.talentId || stored.id})
      : 'https://buyin.jinritemai.com/dashboard/servicehall/daren-profile?'+new URLSearchParams({uid,enter_from:'1',scene:'1',author_type:'1'})
    assertCurrent(token); await chrome.tabs.create({url})
  },
}
