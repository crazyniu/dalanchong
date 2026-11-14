import type { ReactNode } from 'react'
import { LoaderCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

export function LoadingState({
  label,
  className,
  children,
}: {
  label: string
  className?: string
  children?: ReactNode
}) {
  return (
    <div
      role='status'
      aria-live='polite'
      className={cn(
        'flex min-h-40 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground',
        className
      )}
    >
      <LoaderCircle
        aria-hidden='true'
        className='size-6 shrink-0 motion-safe:animate-spin'
      />
      <span>{label}</span>
      {children}
    </div>
  )
}
