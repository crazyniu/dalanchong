/**
 * Interpret disclosed sales ranges and explicit delivery classifications.
 * Stored amounts remain unchanged; table and CSV values use ten-thousand-yuan units.
 * Only Douyin deliveryTypes or known main-sale labels classify a talent.
 */
import type { CollectedTalent, Platform } from './types'

export type SalesMetric =
  | 'sales30d'
  | 'sales7d'
  | 'avgLiveSales7d'
  | 'avgLiveSales30d'
  | 'liveSales30d'
  | 'videoSales7d'
  | 'videoSales30d'
  | 'settlement30d'

export const salesMetricOptions: Record<Platform, { value: SalesMetric; label: string }[]> = {
  kuaishou: [
    { value: 'sales30d', label: '近30日合作销售额' },
    { value: 'sales7d', label: '近7日合作销售额' },
    { value: 'avgLiveSales30d', label: '近30日直播场均销售额' },
    { value: 'avgLiveSales7d', label: '近7日直播场均销售额' },
    { value: 'videoSales30d', label: '近30日短视频销售额' },
    { value: 'videoSales7d', label: '近7日短视频销售额' },
  ],
  douyin: [
    { value: 'sales30d', label: '近30日销售额' },
    { value: 'liveSales30d', label: '近30日直播销售额' },
    { value: 'videoSales30d', label: '近30日短视频销售额' },
    { value: 'settlement30d', label: '近30日结算额' },
  ],
}

export function talentDeliveryTypes(talent: CollectedTalent): ('live' | 'video')[] {
  if (talent.platform !== 'douyin') return []
  if (talent.deliveryTypes?.length) return talent.deliveryTypes
  switch (talent.salesMode) {
    case '纯直播':
    case '直播为主': return ['live']
    case '纯短视频':
    case '短视频为主': return ['video']
    default: return []
  }
}

export function talentDeliveryLabel(talent: CollectedTalent) {
  if (talent.platform !== 'douyin') return ''
  return talent.salesMode || talentDeliveryTypes(talent)
    .map((type) => type === 'live' ? '直播带货' : '短视频带货').join(' / ')
}

export function salesRange(value: string | undefined): { min: number; max: number | null } | undefined {
  if (value == null) return undefined
  const text = value.trim().replace(/^[¥￥]/, '').replace(/[,，\s]/g, '')
  const match = text.match(/^(\d+(?:\.\d+)?)([万亿]?)(?:[-~～至–—](\d+(?:\.\d+)?)([万亿]?))?(\+)?$/)
  if (!match || (match[3] != null && match[5])) return undefined
  const multiplier = (unit: string) => unit === '亿' ? 100_000_000 : unit === '万' ? 10_000 : 1
  const lower = Number(match[1])
  const upper = match[3] == null ? lower : Number(match[3])
  // Kuaishou omits the shared unit in 1-2.5万; cross-unit 5000-1万 keeps
  // the lower endpoint in yuan. Compare the disclosed endpoint numerals first.
  const lowerUnit = match[2] || (match[4] && lower <= upper ? match[4] : '')
  const min = lower * multiplier(lowerUnit)
  const max = match[5] ? null : upper * multiplier(match[3] == null ? lowerUnit : match[4])
  if (!Number.isFinite(min) || (max != null && (!Number.isFinite(max) || min > max))) return undefined
  return { min, max }
}

const salesAmountFormat = new Intl.NumberFormat('zh-CN', {
  maximumFractionDigits: 6,
  useGrouping: false,
})

export function formatSalesAmount(value: string | undefined): string {
  const range = salesRange(value)
  if (!range) return ''
  const minimum = salesAmountFormat.format(range.min / 10_000)
  if (range.max === null) return `${minimum}万+`
  if (range.min === range.max) return `${minimum}万`
  return `${minimum}–${salesAmountFormat.format(range.max / 10_000)}万`
}
