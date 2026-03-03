import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { EmptyState } from '../components/ui/EmptyState'
import { Tabs } from '../components/ui/Tabs'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { Calendar, Clock, CreditCard, CheckCircle, DollarSign, UserPlus, UserCheck, UserX, XCircle } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { listAppointments, cancelAppointment, markNoShow, createTodo } from '../api/endpoints'
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

function formatDateShort(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

/** Get the date N days from a given date string (YYYY-MM-DD) */
function daysFrom(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

export default function Appointments() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [selectedDate, setSelectedDate] = useState(today)
  const [filter, setFilter] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [noShowAppt, setNoShowAppt] = useState<Appointment | null>(null)

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelAppointment(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments-upcoming'] })
      queryClient.invalidateQueries({ queryKey: ['appointments-past'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Appointment cancelled')
      setCancellingId(null)
    },
    onError: (err) => {
      toast('error', `Failed to cancel: ${(err as Error).message}`)
      setCancellingId(null)
    },
  })

  const noShowMutation = useMutation({
    mutationFn: async (appt: Appointment) => {
      await markNoShow(appt.id)
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      await createTodo({
        type: 'General',
        title: `No-show fee — ${appt.patientName}`,
        status: 'Open',
        priority: 'High',
        patientId: appt.patientId || undefined,
        dueDate: tomorrow.toISOString(),
        notes: `Patient did not show for ${appt.type} appointment. Charge $30 no-show fee.`,
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments-upcoming'] })
      queryClient.invalidateQueries({ queryKey: ['appointments-past'] })
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Marked as no-show. To-do created for $30 fee.')
      setNoShowAppt(null)
    },
    onError: (err) => {
      toast('error', `Failed: ${(err as Error).message}`)
      setNoShowAppt(null)
    },
  })

  // Daily query — for "All" and "Cancelled" tabs
  const { data: dayAppointments = [], isLoading: dayLoading } = useQuery({
    queryKey: ['appointments', selectedDate],
    queryFn: () => listAppointments(selectedDate),
    staleTime: 30_000,
  })

  // 30-day query — for "Upcoming" tab (today + 30 days)
  const rangeEnd = useMemo(() => daysFrom(today, 30), [today])
  const { data: upcomingAppointments = [], isLoading: upcomingLoading } = useQuery({
    queryKey: ['appointments-upcoming', today, rangeEnd],
    queryFn: () => listAppointments(today, rangeEnd),
    staleTime: 60_000,
  })

  const upcomingScheduled = upcomingAppointments.filter((a) => a.status === 'scheduled')

  // 30-day back query — for "Past" tab (30 days ago through yesterday)
  const pastStart = useMemo(() => daysFrom(today, -30), [today])
  const pastEnd = useMemo(() => daysFrom(today, -1), [today])
  const { data: pastAppointments = [], isLoading: pastLoading } = useQuery({
    queryKey: ['appointments-past', pastStart, pastEnd],
    queryFn: () => listAppointments(pastStart, pastEnd),
    staleTime: 60_000,
  })

  // Pick the right source based on active tab
  const sourceList = filter === 'upcoming'
    ? upcomingScheduled
    : filter === 'past'
      ? pastAppointments
      : dayAppointments
  const isLoading = filter === 'upcoming'
    ? upcomingLoading
    : filter === 'past'
      ? pastLoading
      : dayLoading

  const filtered = sourceList.filter((a) => {
    if (filter === 'cancelled' && a.status !== 'cancelled') return false
    if (search) {
      const q = search.toLowerCase()
      if (!a.patientName.toLowerCase().includes(q) && !a.type.toLowerCase().includes(q)) return false
    }
    return true
  })

  const tabs = [
    { key: 'all', label: 'All', count: dayAppointments.length },
    { key: 'upcoming', label: 'Upcoming', count: upcomingScheduled.length },
    { key: 'past', label: 'Past', count: pastAppointments.length },
    { key: 'cancelled', label: 'Cancelled', count: dayAppointments.filter((a) => a.status === 'cancelled').length },
  ]

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Appointments</h1>
          <p className="text-warm-gray text-sm mt-1">
            {filter === 'upcoming'
              ? 'Next 30 days'
              : filter === 'past'
                ? 'Last 30 days'
                : new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, {
                    weekday: 'long',
                    month: 'long',
                    day: 'numeric',
                  })}
          </p>
        </div>
        {filter !== 'upcoming' && filter !== 'past' && (
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="px-3 py-2 border border-light-gray rounded-lg text-sm bg-white"
          />
        )}
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
              filter === 'upcoming'
                ? 'No upcoming appointments this month.'
                : filter === 'past'
                  ? 'No past appointments in the last 30 days.'
                  : filter === 'all'
                    ? 'No appointments scheduled for this date.'
                    : 'No appointments match your current filters.'
            }
          />
        ) : (
          filtered.map((appt) => {
            const TypeIcon = typeIcons[appt.type] || Calendar
            const isPast = new Date(appt.endTime) < new Date()
            const apptDate = appt.startTime.slice(0, 10)
            const isApptToday = apptDate === today
            return (
              <Card key={appt.id} className="hover:border-slate-blue/30 transition-colors">
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-blue/10 flex items-center justify-center">
                    <TypeIcon className="w-5 h-5 text-slate-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      {appt.patientId ? (
                        <button
                          onClick={() => navigate(`/patients/${appt.patientId}`)}
                          className="font-semibold text-slate-blue hover:underline text-left"
                        >
                          {appt.patientName}
                        </button>
                      ) : (
                        <h3 className="font-semibold text-charcoal">{appt.patientName}</h3>
                      )}
                      <Badge variant={statusVariants[appt.status] || 'gray'}>
                        {appt.status === 'no_show' ? 'No Show' : appt.status}
                      </Badge>
                    </div>
                    <p className="text-sm text-charcoal">{appt.type}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-warm-gray">
                      {(filter === 'upcoming' || filter === 'past') && (
                        <span className="font-medium text-charcoal">
                          {formatDateShort(appt.startTime)}
                        </span>
                      )}
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
                    {appt.status !== 'cancelled' && (
                      <div className="mt-3 flex gap-2 flex-wrap">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<CreditCard size={14} />}
                          onClick={() =>
                            navigate(`/billing/charge?name=${encodeURIComponent(appt.patientName)}`)
                          }
                        >
                          Collect Payment
                        </Button>
                        {/* Future (not today): Cancel */}
                        {appt.status === 'scheduled' && !isPast && !isApptToday && (
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<XCircle size={14} />}
                            onClick={() => setCancellingId(appt.id)}
                          >
                            Cancel
                          </Button>
                        )}
                        {/* Day-of: No Show + Complete */}
                        {appt.status === 'scheduled' && isApptToday && (
                          <>
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<UserX size={14} />}
                              onClick={() => setNoShowAppt(appt)}
                            >
                              No Show
                            </Button>
                            <Button
                              size="sm"
                              variant="primary"
                              icon={<CheckCircle size={14} />}
                              onClick={() => toast('success', `${appt.patientName}'s appointment marked complete`)}
                            >
                              Complete
                            </Button>
                          </>
                        )}
                        {/* Past (not today) + still scheduled: No Show + charge fee */}
                        {appt.status === 'scheduled' && isPast && !isApptToday && (
                          <>
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<UserX size={14} />}
                              onClick={() => setNoShowAppt(appt)}
                            >
                              No Show
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              icon={<DollarSign size={14} />}
                              onClick={() =>
                                navigate(`/billing/no-show?name=${encodeURIComponent(appt.patientName)}`)
                              }
                            >
                              Charge $30 No-Show Fee
                            </Button>
                          </>
                        )}
                        {/* Already marked no-show: charge fee */}
                        {appt.status === 'no_show' && (
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<DollarSign size={14} />}
                            onClick={() =>
                              navigate(`/billing/no-show?name=${encodeURIComponent(appt.patientName)}`)
                            }
                          >
                            Charge $30 No-Show Fee
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      <ConfirmDialog
        open={!!cancellingId}
        onClose={() => setCancellingId(null)}
        onConfirm={() => cancellingId && cancelMutation.mutate(cancellingId)}
        title="Cancel Appointment?"
        message="This will cancel the appointment in Acuity Scheduling. This action cannot be undone."
        confirmLabel="Cancel Appointment"
        danger
        loading={cancelMutation.isPending}
      />

      <ConfirmDialog
        open={!!noShowAppt}
        onClose={() => setNoShowAppt(null)}
        onConfirm={() => noShowAppt && noShowMutation.mutate(noShowAppt)}
        title="Mark as No-Show?"
        message="This will mark the appointment as a no-show in Acuity and create a to-do to charge the $30 no-show fee."
        confirmLabel="Mark No-Show"
        danger
        loading={noShowMutation.isPending}
      />
    </div>
  )
}
