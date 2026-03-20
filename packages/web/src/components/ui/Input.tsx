import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-charcoal dark:text-white">
            {label}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-4 py-3 rounded-lg border text-base transition-colors',
            'bg-white dark:bg-gray-700 text-charcoal dark:text-white placeholder:text-warm-gray dark:placeholder:text-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-slate-blue focus:border-transparent',
            error ? 'border-red-400' : 'border-light-gray dark:border-gray-600',
            'min-h-[48px]',
            className,
          )}
          {...props}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    )
  },
)

Input.displayName = 'Input'

interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
  ({ label, error, className, id, ...props }, ref) => {
    const inputId = id || label?.toLowerCase().replace(/\s+/g, '-')
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-sm font-medium text-charcoal dark:text-white">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full px-4 py-3 rounded-lg border text-base transition-colors resize-y',
            'bg-white dark:bg-gray-700 text-charcoal dark:text-white placeholder:text-warm-gray dark:placeholder:text-gray-500',
            'focus:outline-none focus:ring-2 focus:ring-slate-blue focus:border-transparent',
            error ? 'border-red-400' : 'border-light-gray dark:border-gray-600',
            className,
          )}
          rows={4}
          {...props}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    )
  },
)

TextArea.displayName = 'TextArea'
