import { useEffect, useRef, useCallback, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  size?: 'sm' | 'md' | 'lg'
}

const sizeMap = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
}

export function Modal({ open, onClose, title, children, size = 'md' }: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  // Focus modal on open; use ref for onClose to avoid re-running on every parent render
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current()
    }
    document.addEventListener('keydown', handleKey)
    contentRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKey)
  }, [open])

  if (!open) return null

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/40 p-4"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={contentRef}
        tabIndex={-1}
        className={cn(
          'bg-white dark:bg-gray-800 rounded-xl shadow-lg w-full outline-none',
          'max-h-[90vh] overflow-y-auto',
          sizeMap[size],
        )}
      >
        <div className="flex items-center justify-between p-5 border-b border-light-gray dark:border-gray-700">
          <h2 className="text-xl font-semibold text-charcoal dark:text-white">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors text-charcoal dark:text-gray-300"
            aria-label="Close"
          >
            <X size={20} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
