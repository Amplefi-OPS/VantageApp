import { useQuery } from '@tanstack/react-query'
import { getPulse } from '../api/endpoints'

interface Pill {
  label: string
  value: string
  tone: 'green' | 'amber' | 'red' | 'neutral'
}

const TONE_CLASSES: Record<Pill['tone'], string> = {
  green: 'bg-green-50 text-green-700 dark:bg-green-500/20 dark:text-green-300',
  amber: 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
  red: 'bg-red-50 text-red-700 dark:bg-red-500/20 dark:text-red-300',
  neutral: 'bg-gray-50 text-gray-700 dark:bg-gray-600/30 dark:text-gray-200',
}

// Thresholds — tune after a week of real data.
function remainingTone(remaining: number): Pill['tone'] {
  if (remaining >= 15) return 'red'
  if (remaining >= 8) return 'amber'
  return 'green'
}

function newPatientTone(percent: number): Pill['tone'] {
  if (percent >= 40) return 'red'
  if (percent >= 20) return 'amber'
  return 'green'
}

export function PulseStrip() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['pulse'],
    queryFn: getPulse,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  if (isLoading || isError || !data) return null

  const pills: Pill[] = [
    { label: 'Done this week', value: String(data.done), tone: 'neutral' },
    { label: 'Remaining', value: String(data.remaining), tone: remainingTone(data.remaining) },
    { label: 'New patients', value: `${data.newPatientPercent}%`, tone: newPatientTone(data.newPatientPercent) },
  ]

  return (
    <div className="mb-6 flex flex-wrap gap-2" role="status" aria-label="Weekly workload pulse">
      {pills.map((p) => (
        <div
          key={p.label}
          className={`inline-flex items-baseline gap-2 rounded-full px-3 py-1.5 text-sm ${TONE_CLASSES[p.tone]}`}
        >
          <span className="font-semibold">{p.value}</span>
          <span className="text-xs opacity-80">{p.label}</span>
        </div>
      ))}
    </div>
  )
}
