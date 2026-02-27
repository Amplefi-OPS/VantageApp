import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { EmptyState } from '../components/ui/EmptyState'
import { Tabs } from '../components/ui/Tabs'
import { Calendar, Clock, MapPin, Video, Phone } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { getSettings } from '../lib/settings'
import { getAuthHeader } from '../auth/cognito'

interface Appointment {
  appointment_id: string
  provider_id: string
  patient_id: string
  patient_name: string
  type: 'in_office' | 'telehealth' | 'phone'
  start_time: string
  end_time: string
  status: 'scheduled' | 'checked_in' | 'completed' | 'cancelled' | 'no_show'
  reason: string
  notes: string
}

const statusVariants: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray'> = {
  scheduled: 'blue',
  checked_in: 'yellow',
  completed: 'green',
  cancelled: 'gray',
  no_show: 'red',
}

const typeIcons = {
  in_office: MapPin,
  telehealth: Video,
  phone: Phone,
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export default function Appointments() {
  const { user } = useAuth()
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10))
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')

  const { data: appointments = [], isLoading } = useQuery({
    queryKey: ['appointments', selectedDate, user?.providerId],
    queryFn: async () => {
      const res = await fetch(
        `${getSettings().apiBaseUrl}/appointments?provider_id=${user?.providerId}&date=${selectedDate}`,
        { headers: { Authorization: getAuthHeader() || '' } },
      )
      return res.json().then((d: { appointments: Appointment[] }) => d.appointments)
    },
  })

  const filtered = appointments.filter((a) => {
    if (filter !== 'all' && a.status !== filter) return false
    if (search && !a.patient_name.toLowerCase().includes(search.toLowerCase()) && !a.reason.toLowerCase().includes(search.toLowerCase())) return false
    return true
  })

  const tabs = [
    { key: 'all', label: `All (${appointments.length})` },
    { key: 'scheduled', label: `Upcoming (${appointments.filter((a) => a.status === 'scheduled').length})` },
    { key: 'checked_in', label: `Checked In (${appointments.filter((a) => a.status === 'checked_in').length})` },
    { key: 'completed', label: `Done (${appointments.filter((a) => a.status === 'completed').length})` },
  ]

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Appointments</h1>
          <p className="text-warm-gray text-sm mt-1">
            {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-light-gray rounded-lg text-sm bg-white"
          />
        </div>
      </div>

      <div className="mb-4">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by patient or reason..."
        />
      </div>

      <Tabs tabs={tabs} active={filter} onChange={setFilter} />

      <div className="mt-4 space-y-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Calendar className="w-12 h-12" />}
            title="No appointments"
            description="No appointments match your current filters."
          />
        ) : (
          filtered.map((appt) => {
            const TypeIcon = typeIcons[appt.type]
            return (
              <Card key={appt.appointment_id} className="hover:border-slate-blue/30 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-blue/10 flex items-center justify-center">
                    <TypeIcon className="w-5 h-5 text-slate-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-charcoal">{appt.patient_name}</h3>
                      <Badge variant={statusVariants[appt.status]}>{appt.status.replace('_', ' ')}</Badge>
                    </div>
                    <p className="text-sm text-charcoal">{appt.reason}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-warm-gray">
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(appt.start_time)} - {formatTime(appt.end_time)}
                      </span>
                      <span className="flex items-center gap-1">
                        <TypeIcon className="w-3 h-3" />
                        {appt.type === 'in_office' ? 'In-Office' : appt.type === 'telehealth' ? 'Telehealth' : 'Phone'}
                      </span>
                    </div>
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
