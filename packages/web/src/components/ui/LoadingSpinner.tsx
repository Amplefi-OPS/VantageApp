import { cn } from '../../lib/utils'

export function LoadingSpinner({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center justify-center py-16', className)}>
      <div className="h-8 w-8 animate-spin rounded-full border-3 border-slate-blue border-t-transparent" role="status">
        <span className="sr-only">Loading...</span>
      </div>
    </div>
  )
}
