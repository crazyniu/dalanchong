/** Current platform readiness, observed through the authorized extension session. */
import {create} from 'zustand'
import {invitationRequest} from './runtime'
type Guest = {status:'ready'|'loading'|'error';error?:string}
export const useGuestState=create<{sessions:Record<string,Guest>}>(()=>({sessions:{}}))
export function updateGuestSession(accountId:string, observation:any) {
  useGuestState.setState({sessions:{[accountId]:{status:observation?.account?.status==='online'&&observation?.readiness?'ready':'error',error:observation?.account?.status==='online'?'请在来源页面搜索或重新应用筛选，等待列表加载。':'请先在来源页面登录。'}}})
}
export function clearGuestSessions(){useGuestState.setState({sessions:{}})}
export const browserError=(error:unknown)=>error instanceof Error?error.message:String(error)
export async function retryGuest(accountId:string) {
  if(!useGuestState.getState().sessions[accountId]) throw Error('当前账号已改变')
  const pending:Guest={status:'loading'}
  useGuestState.setState({sessions:{[accountId]:pending}})
  try { const result=await invitationRequest('INVITE_OBSERVE');if(useGuestState.getState().sessions[accountId]===pending)updateGuestSession(accountId,result.observation) }
  catch(error){if(useGuestState.getState().sessions[accountId]===pending)useGuestState.setState({sessions:{[accountId]:{status:'error',error:browserError(error)}}})}
}
