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
      <div className="text-warm-gray dark:text-gray-500 mb-4">{icon}</div>
      <h3 className="text-lg font-semibold text-charcoal dark:text-gray-100 mb-1">{title}</h3>
      {description && <p className="text-warm-gray dark:text-gray-400 text-sm max-w-sm mb-4">{description}</p>}
      {action}
    </div>
  )
}
