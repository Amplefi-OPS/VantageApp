import type { ReactNode } from 'react'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: ReactNode
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="text-warm-gray mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-charcoal mb-1">{title}</h3>
      {description && <p className="text-warm-gray text-sm max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  )
}
