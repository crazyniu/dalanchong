import { useRef, useState, type PointerEvent } from 'react'
import {
  GripVertical,
  History,
  Play,
  ScrollText,
  Square,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'

export type ToolbarAction =
  | { type: 'view'; view: string }
  | {
      type:
        | 'collect'
        | 'stop'
        | 'return'
        | 'logs'
        | 'records'
    }

export type ToolbarState = {
  kind?: 'invite'
  accountId: string
  view: string
  count: number
  collecting: boolean
  pendingInvite: boolean
  returning: boolean
  disabled: boolean
  label: string
}

export function CollectionToolbar({
  state,
  onAction,
  onMove,
}: {
  state: ToolbarState
  onAction: (action: ToolbarAction) => void
  onMove: (deltaX: number, deltaY: number) => void
}) {
  const pointer = useRef<{ id: number; x: number; y: number } | null>(null)
  const [dragging, setDragging] = useState(false)
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const previous = pointer.current
    if (!previous || previous.id !== event.pointerId) return
    // Client coordinates move with the native child; screen coordinates stay stable.
    const deltaX = event.screenX - previous.x
    const deltaY = event.screenY - previous.y
    pointer.current = { id: event.pointerId, x: event.screenX, y: event.screenY }
    if (deltaX || deltaY) onMove(deltaX, deltaY)
  }
  const endDrag = () => {
    pointer.current = null
    setDragging(false)
  }
  return (
    <div className='collection-toolbar' data-testid='collection-toolbar'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='toolbar-drag-handle size-8 text-muted-foreground'
        aria-label='拖动工具栏'
        title='拖动工具栏'
        data-dragging={dragging}
        onPointerDown={(event) => {
          if (event.button !== 0 || !event.isPrimary) return
          event.preventDefault()
          event.currentTarget.setPointerCapture(event.pointerId)
          pointer.current = { id: event.pointerId, x: event.screenX, y: event.screenY }
          setDragging(true)
        }}
        onPointerMove={move}
        onPointerUp={(event) => {
          if (pointer.current?.id !== event.pointerId) return
          move(event)
          event.currentTarget.releasePointerCapture(event.pointerId)
          endDrag()
        }}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <GripVertical className='size-5' />
      </Button>
      <Tabs
        value={state.view}
        onValueChange={(view) => onAction({ type: 'view', view })}
      >
        <TabsList>
          <TabsTrigger value='collect'>采集达人</TabsTrigger>
          <TabsTrigger value='list'>
            邀约达人 <span className='ml-1 tabular-nums'>{state.count}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>
      {state.view === 'collect' && (
        <div className='flex min-w-0 items-center gap-2'>
          {state.pendingInvite ? (
            <Button
              size='sm'
              disabled={state.returning}
              onClick={() => onAction({ type: 'return' })}
            >
              {state.returning ? '正在打开' : '返回邀约'}
            </Button>
          ) : (
            state.accountId && (
              <Button
                size='sm'
                disabled={state.disabled}
                onClick={() =>
                  onAction({
                    type: state.collecting ? 'stop' : 'collect',
                  })
                }
              >
                {state.collecting ? (
                  <Square className='size-3 fill-current' />
                ) : (
                  <Play className='size-3 fill-current' />
                )}
                {state.label}
              </Button>
            )
          )}
        </div>
      )}
      <Button
        variant='ghost'
        size='sm'
        className='text-muted-foreground'
        onClick={() => onAction({ type: 'logs' })}
        aria-label='错误日志'
        title='错误日志'
      >
        <ScrollText />
        <span className='toolbar-secondary-label'>错误日志</span>
      </Button>
      <Button
        variant='ghost'
        size='sm'
        className='text-muted-foreground'
        onClick={() => onAction({ type: 'records' })}
        aria-label='邀约记录'
        title='邀约记录'
      >
        <History />
        <span className='toolbar-secondary-label'>邀约记录</span>
      </Button>
    </div>
  )
}
