/** Account-scoped filter types and pure matching/counting helpers. */
import { salesRange, talentDeliveryTypes, type SalesMetric } from './talent-commerce'
import type { CollectedTalent } from './types'

export type TalentFilters = {
  status: 'all' | 'pending' | 'success'
  choices: {
    gender?: '男' | '女'
    deliveryType?: 'live' | 'video'
  }
  ranges: { fans?: { min: string; max: string } }
  gmv?: { metric: SalesMetric; min: string; max: string }
}

export const emptyTalentFilters: TalentFilters = {
  status: 'all',
  choices: {},
  ranges: {},
}

export function talentValue(
  value: CollectedTalent[keyof CollectedTalent]
): string | number {
  if (Array.isArray(value)) return value.join(' / ')
  if (typeof value === 'number') return Number.isFinite(value) ? value : ''
  if (value == null) return ''
  const text = value.trim()
  return /^(?:[¥￥]\s*)?(?:[-—–]+|NaN)$/i.test(text) ? '' : text
}

export function matchesTalentFilters(
  talent: CollectedTalent,
  filters: TalentFilters,
  status: string
) {
  if (filters.status !== 'all' && filters.status !== status) return false
  if (filters.choices.gender && talent.gender !== filters.choices.gender) return false
  const deliveryType = filters.choices.deliveryType
  const deliveryTypes = talentDeliveryTypes(talent)
  if (deliveryType && !deliveryTypes.includes(deliveryType)) return false
  const { min, max } = filters.ranges.fans || { min: '', max: '' }
  if (min !== '' || max !== '') {
    const fans = talentValue(talent.fans)
    if (typeof fans !== 'number' ||
      (min !== '' && fans < Number(min)) ||
      (max !== '' && fans > Number(max))) return false
  }
  const gmv = filters.gmv
  if (gmv && (gmv.min !== '' || gmv.max !== '')) {
    const range = salesRange(talent[gmv.metric])
    if (!range ||
      (gmv.min !== '' && range.min < Number(gmv.min)) ||
      (gmv.max !== '' && (range.max == null || range.max > Number(gmv.max)))) return false
  }
  return true
}

export function activeTalentFilterCount(filters: TalentFilters) {
  const { min, max } = filters.ranges.fans || { min: '', max: '' }
  return (
    Number(filters.status !== 'all') +
    Number(Boolean(filters.choices.gender)) +
    Number(Boolean(filters.choices.deliveryType)) +
    Number(min !== '' || max !== '') +
    Number(Boolean(filters.gmv && (filters.gmv.min !== '' || filters.gmv.max !== '')))
  )
}

