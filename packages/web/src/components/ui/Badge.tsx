import { cn } from '../../lib/utils'

type BadgeVariant = 'default' | 'blue' | 'green' | 'red' | 'yellow' | 'gray'

interface BadgeProps {
  children: React.ReactNode
  variant?: BadgeVariant
  className?: string
}

const variantStyles: Record<BadgeVariant, string> = {
  default: 'bg-light-gray dark:bg-gray-600 text-charcoal dark:text-white',
  blue: 'bg-blue-50 dark:bg-blue-500/25 text-blue-700 dark:text-blue-300',
  green: 'bg-green-50 dark:bg-green-500/25 text-green-700 dark:text-green-300',
  red: 'bg-red-50 dark:bg-red-500/25 text-red-700 dark:text-red-300',
  yellow: 'bg-amber-50 dark:bg-amber-500/25 text-amber-700 dark:text-amber-300',
  gray: 'bg-gray-100 dark:bg-gray-600 text-warm-gray dark:text-gray-300',
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium',
        variantStyles[variant],
        className,
      )}
    >
      {children}
    </span>
  )
}
