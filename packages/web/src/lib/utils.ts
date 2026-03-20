/** Merge classnames, filtering out falsy values */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

/** Format a date string as "Jan 15, 2025 at 2:30 PM" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }) + ' at ' + d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** Format a date string as "Jan 15, 2025" */
export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Format seconds as "1:23" */
export function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format a phone number for display */
export function formatPhone(phone: string): string {
  // Already formatted
  if (phone.startsWith('(')) return phone
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

/** Check if a date string is before today */
export function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false
  return new Date(dateStr).toISOString().slice(0, 10) < new Date().toISOString().slice(0, 10)
}

/** Check if a date string is today */
export function isToday(dateStr?: string): boolean {
  if (!dateStr) return false
  return new Date(dateStr).toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
}

/** Get time-ago string */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'Just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return formatDate(iso)
}
