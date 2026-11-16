/** Edit invitation status, gender, delivery type, sales and fan filters. */
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Choice } from './shared'
import { salesMetricOptions, type SalesMetric } from './talent-commerce'
import type { Platform } from './types'
import { emptyTalentFilters, type TalentFilters } from './collection-filter-state'

export function CollectionFilterDialog({
  open,
  onOpenChange,
  filters,
  onApply,
  platform,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: TalentFilters
  onApply: (filters: TalentFilters) => void
  platform: Platform
}) {
  const [draft, setDraft] = useState(filters)
  const fans = draft.ranges.fans || { min: '', max: '' }
  const gmv = draft.gmv || { metric: 'sales30d', min: '', max: '' }
  function setGmv(changes: Partial<NonNullable<TalentFilters['gmv']>>) {
    setDraft((current) => ({
      ...current,
      gmv: { metric: 'sales30d', min: '', max: '', ...current.gmv, ...changes },
    }))
  }
  function setFans(bound: 'min' | 'max', value: string) {
    setDraft((current) => ({
      ...current,
      ranges: {
        fans: { min: '', max: '', ...current.ranges.fans, [bound]: value },
      },
    }))
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className='max-h-[85vh] overflow-hidden p-0 sm:max-w-3xl'
      >
        <form
          className='flex max-h-[85vh] min-h-0 flex-col'
          onSubmit={(event) => {
            event.preventDefault()
            onApply(draft)
          }}
        >
          <DialogHeader className='px-6 pt-6 text-left'>
            <DialogTitle>筛选达人</DialogTitle>
          </DialogHeader>
          <div className='grid min-h-0 gap-4 overflow-y-auto p-6 sm:grid-cols-2'>
            <div className='space-y-2'>
              <div className='text-sm font-medium'>邀约状态</div>
              <Choice
                label='邀约状态'
                className='w-full'
                value={draft.status}
                onChange={(status) =>
                  setDraft((current) => ({
                    ...current,
                    status: status as TalentFilters['status'],
                  }))
                }
                options={[
                  { value: 'all', label: '全部' },
                  { value: 'pending', label: '未邀约' },
                  { value: 'success', label: '已邀约' },
                ]}
              />
            </div>
            <div className='space-y-2'>
              <div className='text-sm font-medium'>粉丝数</div>
              <div className='flex items-center gap-2'>
                <Input
                  type='number'
                  min={0}
                  max={fans.max || undefined}
                  step={1}
                  aria-label='粉丝数最小值'
                  placeholder='最小值'
                  value={fans.min}
                  onChange={(event) => setFans('min', event.target.value)}
                />
                <span className='text-muted-foreground'>至</span>
                <Input
                  type='number'
                  min={fans.min || 0}
                  step={1}
                  aria-label='粉丝数最大值'
                  placeholder='最大值'
                  value={fans.max}
                  onChange={(event) => setFans('max', event.target.value)}
                />
              </div>
            </div>
            <div className='space-y-2'>
              <div className='text-sm font-medium'>达人性别</div>
              <Choice
                label='达人性别'
                className='w-full'
                value={draft.choices.gender || '__all__'}
                onChange={(gender) =>
                  setDraft((current) => ({
                    ...current,
                    choices: {
                      ...current.choices,
                      gender: gender === '__all__'
                        ? undefined
                        : gender as TalentFilters['choices']['gender'],
                    },
                  }))
                }
                options={[
                  { value: '__all__', label: '全部' },
                  { value: '男', label: '男' },
                  { value: '女', label: '女' },
                ]}
              />
            </div>
            {platform === 'douyin' && <div className='space-y-2'>
              <div className='text-sm font-medium'>带货类型</div>
              <Choice
                label='带货类型'
                className='w-full'
                value={draft.choices.deliveryType || '__all__'}
                onChange={(deliveryType) => setDraft((current) => ({
                  ...current,
                  choices: {
                    ...current.choices,
                    deliveryType: deliveryType === '__all__'
                      ? undefined
                      : deliveryType as TalentFilters['choices']['deliveryType'],
                  },
                }))}
                options={[
                  { value: '__all__', label: '全部' },
                  { value: 'live', label: '直播带货' },
                  { value: 'video', label: '短视频带货' },
                ]}
              />
            </div>}
            <div className='space-y-2 sm:col-span-2'>
              <div className='text-sm font-medium'>
                {platform === 'kuaishou' ? '近期销售额' : '近期 GMV / 结算额'}
              </div>
              <div className='grid gap-2 sm:grid-cols-2'>
                <Choice
                  label='销售额口径'
                  className='w-full'
                  value={gmv.metric}
                  onChange={(metric) => setGmv({ metric: metric as SalesMetric })}
                  options={salesMetricOptions[platform]}
                />
                <div className='flex items-center gap-2'>
                  <Input
                    type='number'
                    min={0}
                    max={gmv.max || undefined}
                    step='0.01'
                    aria-label='金额最小值（元）'
                    placeholder='最小值（元）'
                    value={gmv.min}
                    onChange={(event) => setGmv({ min: event.target.value })}
                  />
                  <span className='text-muted-foreground'>至</span>
                  <Input
                    type='number'
                    min={gmv.min || 0}
                    step='0.01'
                    aria-label='金额最大值（元）'
                    placeholder='最大值（元）'
                    value={gmv.max}
                    onChange={(event) => setGmv({ max: event.target.value })}
                  />
                </div>
              </div>
              <p className='text-sm text-muted-foreground'>金额区间须完整落在所填范围内，缺失数据不匹配。</p>
            </div>
          </div>
          <DialogFooter className='border-t px-6 py-4'>
            <Button
              type='button'
              variant='ghost'
              className='sm:mr-auto'
              onClick={() => setDraft(emptyTalentFilters)}
            >
              重置
            </Button>
            <Button
              type='button'
              variant='outline'
              onClick={() => onOpenChange(false)}
            >
              取消
            </Button>
            <Button type='submit'>应用筛选</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
