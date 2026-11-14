/** Open a persisted talent profile through the authorized browser runtime. */
import { toast } from 'sonner'
import { browserError } from './browser-session'
import { invitationRuntime } from './runtime'
import type { CollectedTalent } from './types'

export async function openTalentProfile(talent: Pick<CollectedTalent, 'platform' | 'id' | 'uid'>) {
  try {
    await invitationRuntime.openTalentProfile(talent)
  } catch (error) {
    toast.error(`打开达人主页失败：${browserError(error)}`)
  }
}
