/**
 * Render the account-scoped collected-talent table and explicit actions.
 * The authorized background owns paged IndexedDB queries, exports and mutations.
 * Selection survives pagination; invitation preparation excludes every recorded talent.
 * Applied filters are saved per platform/account, while search and page size are local.
 * Platform sales columns retain their disclosed ranges and use ten-thousand-yuan labels.
 * Missing avatars leave no slot; profile navigation preserves this dialog and tasks.
 */
import { memo, useDeferredValue, useMemo, useState } from 'react'
import {
  Copy,
  Download,
  ListFilter,
  Send,
  UsersRound,
} from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { LoadingState } from '@/components/ui/loading-state'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ClearDataButton } from './clear-data-button'
import {
  activeTalentFilterCount,
  emptyTalentFilters,
  talentValue,
} from './collection-filter-state'
import { CollectionFilterDialog } from './collection-filters'
import { invitationRuntime } from './runtime'
import { useDataQuery, type TalentsPage, type TalentScope } from './data-query'
import { formatTime } from './format'
import { Pagination, ResultBadge, SearchInput } from './shared'
import { useCommerce } from './store'
import { formatSalesAmount, talentDeliveryLabel, type SalesMetric } from './talent-commerce'
import type { CollectedTalent, InviteRecord, Platform } from './types'

type TalentColumn = { key: SalesMetric; label: string }

const platformColumns: Record<Platform, TalentColumn[]> = {
  kuaishou: [
    { key: 'sales30d', label: '近30日合作销售额' },
    { key: 'sales7d', label: '近7日合作销售额' },
    { key: 'avgLiveSales30d', label: '近30日直播场均销售额' },
    { key: 'avgLiveSales7d', label: '近7日直播场均销售额' },
    { key: 'videoSales30d', label: '近30日短视频销售额' },
    { key: 'videoSales7d', label: '近7日短视频销售额' },
  ],
  douyin: [
    { key: 'sales30d', label: '近30日销售额' },
    { key: 'settlement30d', label: '近30日结算额' },
    { key: 'liveSales30d', label: '近30日直播销售额' },
    { key: 'videoSales30d', label: '近30日短视频销售额' },
  ],
}

export const CollectionList = memo(function CollectionList({
  platform,
  accountId,
  selected,
  onSelect,
  onInvite,
  onCollect,
  onView,
}: {
  platform: Platform
  accountId: string
  selected: string[]
  onSelect: (ids: string[]) => void
  onInvite: (ids: string[]) => void
  onCollect: () => void
  onView: (talent: CollectedTalent) => void
}) {
  const savedFilters = useCommerce((s) => s.collectionFilters[`${platform}:${accountId}`] || emptyTalentFilters)
  const filters = useMemo(() => platform === 'douyin'
    ? savedFilters
    : { ...savedFilters, choices: { gender: savedFilters.choices.gender } }, [platform, savedFilters])
  const saveCollectionFilters = useCommerce((s) => s.saveCollectionFilters)
  const running = useCommerce((s) => s.tasks[`${accountId}:collect`]?.status === 'running' ||
    s.tasks[`${accountId}:invite`]?.status === 'running')
  const copyLabel = platform === 'kuaishou' ? '快手号' : '昵称'
  const [query, setQuery] = useState('')
  const [filterOpen, setFilterOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [exporting, setExporting] = useState(false)
  const [preparingInvite, setPreparingInvite] = useState(false)
  const filterCount = activeTalentFilterCount(filters)
  const keyword = query.trim().toLowerCase()
  const deferredKeyword = useDeferredValue(keyword)
  const scope: TalentScope = { platform, accountId, query: deferredKeyword, filters }
  const queryResult = useDataQuery<TalentsPage>({ kind: 'talents', ...scope, page, pageSize })
  const filtering = deferredKeyword !== keyword || queryResult.loading
  const latestRecords = useMemo(() => {
    const latest = new Map<string, InviteRecord>()
    for (const record of queryResult.data?.latestRecords || []) {
      if (record.platform === platform && record.accountId === accountId &&
          !latest.has(record.talentId)) latest.set(record.talentId, record)
    }
    return latest
  }, [platform, accountId, queryResult.data])
  const result = (id: string) => latestRecords.get(id)
  const selectedIds = useMemo(() => new Set(selected), [selected])
  const hasSelection = selected.length > 0
  const total = queryResult.data?.total || 0
  const accountTotal = queryResult.data?.accountTotal || 0
  const actionCount = hasSelection ? selected.length : total
  const pages = Math.ceil(total / pageSize)
  const current = queryResult.data?.page || page
  const displayed = queryResult.data?.rows || []
  const columns = useMemo(() => platformColumns[platform].filter(({ key }) =>
    queryResult.data?.columns.includes(key)
  ), [platform, queryResult.data])
  const actionScope = hasSelection ? { platform, accountId, ids: selected } : scope
  const allSelected =
    displayed.length > 0 && displayed.every((t) => selectedIds.has(t.id))
  const anySelected = displayed.some((t) => selectedIds.has(t.id))
  const choosePage = (checked: boolean) => {
    const pageIds = new Set(displayed.map((talent) => talent.id))
    onSelect(
      checked
        ? [...new Set([...selected, ...pageIds])]
        : selected.filter((id) => !pageIds.has(id))
    )
  }
  async function prepareInvite() {
    setPreparingInvite(true)
    try {
      const ids = await invitationRuntime.queryData<string[]>({ kind: 'invite_ids', ...actionScope })
      if (!ids.length) {
        toast.info('没有无邀约记录的达人')
        return
      }
      onInvite(ids)
    } catch (error) {
      toast.error(`读取达人失败：${String(error)}`)
    } finally {
      setPreparingInvite(false)
    }
  }
  async function exportCSV() {
    setExporting(true)
    try {
      const { saved, count } = await invitationRuntime.exportData({ kind: 'talents', ...actionScope })
      if (saved) toast.success(`已导出 ${count} 位达人`)
    } catch (e) {
      toast.error(`导出失败：${(e as Error).message}`)
    } finally {
      setExporting(false)
    }
  }
  return (
    <div className='space-y-4 p-6'>
      <div className='flex flex-wrap items-center gap-2'>
        <SearchInput
          value={query}
          onChange={(v) => {
            setQuery(v)
            setPage(1)
          }}
          placeholder={
            platform === 'kuaishou'
              ? '搜索达人、快手号、店铺名称'
              : '搜索达人、ID、来源'
          }
          className='min-w-40 flex-1'
        />
        <Button variant='outline' onClick={() => setFilterOpen(true)}>
          <ListFilter />
          筛选{filterCount > 0 && `（${filterCount}）`}
        </Button>
        <div className='ml-auto flex shrink-0 items-center gap-2'>
          <Button
            onClick={prepareInvite}
            disabled={!actionCount || preparingInvite || (!hasSelection && filtering)}
          >
            <Send />
            {preparingInvite ? '正在读取' : hasSelection ? '邀约所选' : '批量邀约'}
          </Button>
          <Button
            variant='outline'
            disabled={!actionCount || exporting || (!hasSelection && filtering)}
            onClick={exportCSV}
          >
            <Download />
            {exporting ? '正在导出' : hasSelection ? '导出所选' : '全部导出'}
          </Button>
          <ClearDataButton
            label={hasSelection ? '删除所选' : '全部删除'}
            actionLabel='删除'
            description={
              hasSelection
                ? `删除已勾选的 ${selected.length} 位达人，包含其他页和筛选外的已选达人，无法恢复。`
                : `删除当前账号全部 ${accountTotal} 位已采集达人，包含筛选外的数据，无法恢复。`
            }
            disabled={!accountTotal || running}
            onClear={async () => {
              await invitationRuntime.deleteData({
                kind: 'talents', platform, accountId,
                ...(hasSelection ? { ids: selected } : {}),
              })
              onSelect([])
              setPage(1)
            }}
          />
        </div>
      </div>
      {filterOpen && (
        <CollectionFilterDialog
          platform={platform}
          open={filterOpen}
          onOpenChange={setFilterOpen}
          filters={filters}
          onApply={(next) => {
            saveCollectionFilters(platform, accountId, next)
            setPage(1)
            setFilterOpen(false)
          }}
        />
      )}
      {hasSelection && (
        <div className='flex items-center gap-2'>
          <Badge variant='secondary'>已选 {selected.length} 位</Badge>
          <Button size='sm' variant='ghost' onClick={() => onSelect([])}>
            取消选择
          </Button>
        </div>
      )}
      <div className='rounded-lg border bg-background [&>[data-slot=table-container]]:max-h-[50vh]'>
        {queryResult.loading ? <LoadingState label='正在加载达人' /> : queryResult.error ? (
          <div role='alert' className='grid min-h-40 place-items-center p-6 text-sm text-destructive'>{queryResult.error}</div>
        ) : <Table>
          <TableHeader>
            <TableRow>
              <TableHead className='sticky left-0 z-20 w-12 min-w-12 bg-background pl-4'>
                <Checkbox
                  aria-label='全选当前页达人'
                  checked={
                    allSelected ? true : anySelected ? 'indeterminate' : false
                  }
                  onCheckedChange={(v) => choosePage(v === true)}
                  disabled={!displayed.length || filtering}
                />
              </TableHead>
              <TableHead className='sticky left-12 z-20 min-w-64 bg-background'>
                达人
              </TableHead>
              <TableHead>最近邀约</TableHead>
              <TableHead>性别</TableHead>
              {platform === 'douyin' && <TableHead>带货类型</TableHead>}
              <TableHead>粉丝数</TableHead>
              {columns.map(({ key, label }) => (
                <TableHead key={key}>{label}</TableHead>
              ))}
              <TableHead>采集来源</TableHead>
              <TableHead>采集时间</TableHead>
              <TableHead className='sticky right-0 z-20 bg-background pr-4'>
                操作
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map((t) => {
              const record = result(t.id)
              const fans = talentValue(t.fans)
              return (
                <TableRow
                  key={t.id}
                  className='group'
                  data-state={selectedIds.has(t.id) ? 'selected' : undefined}
                >
                  <TableCell className='sticky left-0 z-10 bg-background pl-4 group-hover:bg-muted group-data-[state=selected]:bg-muted'>
                    <Checkbox
                      aria-label={`选择${t.name}`}
                      checked={selectedIds.has(t.id)}
                      onCheckedChange={(v) =>
                        onSelect(
                          v
                            ? [...selected, t.id]
                            : selected.filter((id) => id !== t.id)
                        )
                      }
                    />
                  </TableCell>
                  <TableCell className='sticky left-12 z-10 bg-background group-hover:bg-muted group-data-[state=selected]:bg-muted'>
                    <div className='flex items-center gap-3'>
                      {t.avatarUrl && (
                        <Avatar className='size-10 empty:hidden'>
                          <AvatarImage src={t.avatarUrl} alt={`${t.name}的头像`} />
                        </Avatar>
                      )}
                      <div
                        className={
                          platform === 'douyin'
                            ? 'flex min-w-0 items-center gap-1'
                            : 'min-w-0'
                        }
                      >
                        <div
                          className='max-w-64 truncate font-medium'
                          title={t.name}
                        >
                          {t.name}
                        </div>
                        <div
                          className={
                            platform === 'kuaishou'
                              ? 'mt-1 flex items-center gap-1 text-sm text-muted-foreground'
                              : 'flex shrink-0 text-muted-foreground'
                          }
                        >
                          {platform === 'kuaishou' && (
                            <span
                              className='max-w-56 truncate select-all'
                              title={t.id}
                            >
                              {t.id}
                            </span>
                          )}
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            className='size-6 shrink-0'
                            aria-label={`复制${t.name}的${copyLabel}`}
                            title={`复制${copyLabel}`}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(
                                  platform === 'douyin' ? t.name : t.id
                                )
                                toast.success(`${copyLabel}已复制`)
                              } catch {
                                toast.error('复制失败')
                              }
                            }}
                          >
                            <Copy className='size-3.5' />
                          </Button>
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    {record ? (
                      <ResultBadge status={record.status} />
                    ) : (
                      <Badge
                        variant='outline'
                        className='font-normal text-muted-foreground'
                      >
                        未邀约
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{t.gender === '男' || t.gender === '女' ? t.gender : '—'}</TableCell>
                  {platform === 'douyin' && (
                    <TableCell className='whitespace-nowrap'>{talentDeliveryLabel(t) || '—'}</TableCell>
                  )}
                  <TableCell className='tabular-nums'>
                    {typeof fans !== 'number'
                      ? '—'
                      : fans >= 10000
                        ? `${(fans / 10000).toFixed(1)} 万`
                        : fans.toLocaleString()}
                  </TableCell>
                  {columns.map(({ key }) => {
                    const value = formatSalesAmount(t[key])
                    return (
                      <TableCell key={key} className='tabular-nums'>
                        <span
                          className='block max-w-60 truncate'
                          title={String(value)}
                        >
                          {value || '—'}
                        </span>
                      </TableCell>
                    )
                  })}
                  <TableCell>
                    <span
                      className='block max-w-64 truncate'
                      title={t.source}
                    >
                      {t.source}
                    </span>
                  </TableCell>
                  <TableCell className='text-muted-foreground tabular-nums'>
                    {formatTime(t.collectedAt)}
                  </TableCell>
                  <TableCell className='sticky right-0 z-10 bg-background pr-4 group-hover:bg-muted group-data-[state=selected]:bg-muted'>
                    <Button
                      type='button'
                      variant='outline'
                      size='sm'
                      aria-label={`查看${t.name}的主页`}
                      disabled={platform === 'douyin' && !t.uid}
                      onClick={() => onView(t)}
                    >
                      查看
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>}
        {!queryResult.loading && !queryResult.error && !total && (
          <div className='grid place-content-center justify-items-center gap-4 py-24 text-muted-foreground'>
            {accountTotal ? (
              <ListFilter className='size-9' />
            ) : (
              <UsersRound className='size-9' />
            )}
            <p>{accountTotal ? '没有符合条件的达人' : '还没有采集达人'}</p>
            {!accountTotal && (
              <Button variant='outline' onClick={onCollect}>
                去采集
              </Button>
            )}
          </div>
        )}
      </div>
      <Pagination
        page={current}
        pages={pages}
        total={total}
        pageSize={pageSize}
        onChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size)
          setPage(1)
        }}
      />
    </div>
  )
})
