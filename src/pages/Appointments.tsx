import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { EmptyState } from '../components/ui/EmptyState'
import { Tabs } from '../components/ui/Tabs'
import { Calendar, Clock, UserPlus, UserCheck } from 'lucide-react'
import { listAppointments } from '../api/endpoints'
import type { Appointment } from '../api/types'

const statusVariants: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray'> = {
  scheduled: 'blue',
  cancelled: 'gray',
  no_show: 'red',
}

const typeIcons: Record<string, typeof UserPlus> = {
  'New Patient': UserPlus,
  'Returning Patient': UserCheck,
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function Appointments() {
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', selectedDate],
    queryFn: () => listAppointments(selectedDate),
    staleTime: 30_000,
  })

  const filtered = appointments.filter((a) => {
    if (filter === 'upcoming' && a.status !== 'scheduled') return false
    if (filter === 'cancelled' && a.status !== 'cancelled') return false
    if (search) {
      const q = search.toLowerCase()
      if (!a.patientName.toLowerCase().includes(q) && !a.type.toLowerCase().includes(q)) return false
    }
    return true
  })

  const tabs = [
    { key: 'all', label: 'All', count: appointments.length },
    { key: 'upcoming', label: 'Upcoming', count: appointments.filter((a) => a.status === 'scheduled').length },
    { key: 'cancelled', label: 'Cancelled', count: appointments.filter((a) => a.status === 'cancelled').length },
  ]

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Appointments</h1>
          <p className="text-warm-gray text-sm mt-1">
            {new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
            })}
          </p>
        </div>
        <input
          type="date"
          value={selectedDate}
          onChange={(e) => setSelectedDate(e.target.value)}
          className="px-3 py-2 border border-light-gray rounded-lg text-sm bg-white"
        />
      </div>

      <div className="mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by patient or type..."
        />
      </div>

      <Tabs tabs={tabs} active={filter} onChange={setFilter} />

      <div className="mt-4 space-y-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-12 h-12" />}
            title="No appointments"
            description={
              filter === 'all'
                ? 'No appointments scheduled for this date.'
                : 'No appointments match your current filters.'
            }
          />
        ) : (
          filtered.map((appt) => {
            const TypeIcon = typeIcons[appt.type] || Calendar
            return (
              <Card key={appt.id} className="hover:border-slate-blue/30 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-blue/10 flex items-center justify-center">
                    <TypeIcon className="w-5 h-5 text-slate-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-charcoal">{appt.patientName}</h3>
                      <Badge variant={statusVariants[appt.status] || 'gray'}>
                        {appt.status === 'no_show' ? 'No Show' : appt.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-charcoal">{appt.type}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-warm-gray">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(appt.startTime)} - {formatTime(appt.endTime)}
                      </span>
                      <span>{appt.duration} min</span>
                    </div>
                    {appt.patientPhone && (
                      <p className="text-xs text-warm-gray mt-1">{appt.patientPhone}</p>
                    )}
                    {appt.notes && (
                      <p className="text-xs text-warm-gray mt-1 italic">{appt.notes}</p>
                    )}
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>
    </div>
  )
}
