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
import { Calendar, Clock, CreditCard, CheckCircle, DollarSign, UserPlus, UserCheck, UserX, XCircle, RefreshCw, Plus, Edit3 } from 'lucide-react'
import { Button } from '../components/ui/Button'
import { listAppointments, cancelAppointment, markNoShow, completeAppointment, createTodo, rescheduleAppointment } from '../api/endpoints'
import type { Appointment } from '../api/types'

const statusVariants: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray'> = {
  scheduled: 'blue',
  completed: 'green',
  cancelled: 'gray',
  no_show: 'red',
}

const statusLabels: Record<string, string> = {
  scheduled: 'Scheduled',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No Show',
}

const typeIcons: Record<string, typeof Calendar> = {
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
  const [completingAppt, setCompletingAppt] = useState<Appointment | null>(null)
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null)
  const [rescheduleAppt, setRescheduleAppt] = useState<Appointment | null>(null)
  const [rescheduleDate, setRescheduleDate] = useState('')
  const [rescheduleTime, setRescheduleTime] = useState('')
  const [rescheduleDuration, setRescheduleDuration] = useState(30)
  const [rescheduling, setRescheduling] = useState(false)

  // Date ranges — defined before mutations so optimistic update closures work cleanly
  const rangeEnd = useMemo(() => daysFrom(today, 30), [today])
  const pastStart = useMemo(() => daysFrom(today, -30), [today])
  const pastEnd = useMemo(() => daysFrom(today, -1), [today])

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['appointments'] })
    queryClient.invalidateQueries({ queryKey: ['appointments-upcoming'] })
    queryClient.invalidateQueries({ queryKey: ['appointments-past'] })
    queryClient.invalidateQueries({ queryKey: ['todos'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
  }

  const openReschedule = (appt: Appointment) => {
    setRescheduleAppt(appt)
    setRescheduleDate(appt.startTime.slice(0, 10))
    const startDate = new Date(appt.startTime)
    setRescheduleTime(`${String(startDate.getHours()).padStart(2, '0')}:${String(startDate.getMinutes()).padStart(2, '0')}`)
    setRescheduleDuration(appt.duration || 30)
  }

  const handleReschedule = async () => {
    if (!rescheduleAppt || !rescheduleDate || !rescheduleTime) return
    setRescheduling(true)
    try {
      const startTime = `${rescheduleDate}T${rescheduleTime}:00-05:00`
      const endDate = new Date(`${rescheduleDate}T${rescheduleTime}:00`)
      endDate.setMinutes(endDate.getMinutes() + rescheduleDuration)
      const endHours = String(endDate.getHours()).padStart(2, '0')
      const endMins = String(endDate.getMinutes()).padStart(2, '0')
      const endTime = `${rescheduleDate}T${endHours}:${endMins}:00-05:00`
      await rescheduleAppointment(rescheduleAppt.id, { startTime, endTime })
      invalidateAll()
      toast('success', 'Appointment rescheduled')
      setRescheduleAppt(null)
    } catch (err) {
      toast('error', `Failed to reschedule: ${(err as Error).message}`)
    } finally {
      setRescheduling(false)
    }
  }

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelAppointment(id),
    onSuccess: () => {
      invalidateAll()
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
      try {
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
      } catch (err) {
        console.warn('Failed to create no-show todo:', err)
        // Surface to user — without this task the $30 fee won't be charged
        toast('error', `No-show recorded but failed to create billing task for ${appt.patientName}. Please add it manually.`)
      }
    },
    onMutate: async (appt) => {
      const keys = [['appointments', selectedDate], ['appointments-upcoming', today, rangeEnd], ['appointments-past', pastStart, pastEnd]]
      const previousData: Record<string, Appointment[] | undefined> = {}
      for (const key of keys) {
        await queryClient.cancelQueries({ queryKey: key })
        previousData[key.join(',')] = queryClient.getQueryData<Appointment[]>(key)
        queryClient.setQueryData<Appointment[]>(key, (old) =>
          old?.map((a) => a.id === appt.id ? { ...a, status: 'no_show' } : a)
        )
      }
      return { previousData }
    },
    onSuccess: () => {
      invalidateAll()
      toast('success', 'Marked as no-show. Collect $30 no-show fee.')
      setNoShowAppt(null)
    },
    onError: (err, _appt, context) => {
      if (context?.previousData) {
        const keys = [['appointments', selectedDate], ['appointments-upcoming', today, rangeEnd], ['appointments-past', pastStart, pastEnd]]
        for (const key of keys) {
          const prev = context.previousData[key.join(',')]
          if (prev) queryClient.setQueryData(key, prev)
        }
      }
      invalidateAll()
      toast('error', `Failed: ${(err as Error).message}`)
      setNoShowAppt(null)
    },
  })

  const completeMutation = useMutation({
    mutationFn: async (appt: Appointment) => {
      await completeAppointment(appt.id)
      try {
        await createTodo({
          type: 'General',
          title: `Doctor's notes — ${appt.patientName}`,
          status: 'Open',
          priority: 'Med',
          patientId: appt.patientId || undefined,
          dueDate: new Date().toISOString(),
          notes: `Complete doctor's notes for ${appt.type} appointment.`,
        })
      } catch (err) {
        console.warn('Failed to create notes todo:', err)
        toast('error', `Appointment completed but failed to create notes task for ${appt.patientName}. Please add it manually.`)
      }
    },
    onMutate: async (appt) => {
      const keys = [['appointments', selectedDate], ['appointments-upcoming', today, rangeEnd], ['appointments-past', pastStart, pastEnd]]
      const previousData: Record<string, Appointment[] | undefined> = {}
      for (const key of keys) {
        await queryClient.cancelQueries({ queryKey: key })
        previousData[key.join(',')] = queryClient.getQueryData<Appointment[]>(key)
        queryClient.setQueryData<Appointment[]>(key, (old) =>
          old?.map((a) => a.id === appt.id ? { ...a, status: 'completed' } : a)
        )
      }
      return { previousData }
    },
    onSuccess: (_data, appt) => {
      invalidateAll()
      toast('success', `${appt.patientName}'s appointment marked complete.`)
      setCompletingAppt(null)
    },
    onError: (err, _appt, context) => {
      if (context?.previousData) {
        const keys = [['appointments', selectedDate], ['appointments-upcoming', today, rangeEnd], ['appointments-past', pastStart, pastEnd]]
        for (const key of keys) {
          const prev = context.previousData[key.join(',')]
          if (prev) queryClient.setQueryData(key, prev)
        }
      }
      invalidateAll()
      toast('error', `Failed: ${(err as Error).message}`)
      setCompletingAppt(null)
    },
  })

  // Daily query — for "All" and "Cancelled" tabs
  const { data: dayAppointments = [], isLoading: dayLoading, isError: dayError, error: dayErrorDetail } = useQuery({
    queryKey: ['appointments', selectedDate],
    queryFn: () => listAppointments(selectedDate),
    staleTime: 30_000,
  })

  // 30-day query — for "Upcoming" tab
  const { data: upcomingAppointments = [], isLoading: upcomingLoading } = useQuery({
    queryKey: ['appointments-upcoming', today, rangeEnd],
    queryFn: () => listAppointments(today, rangeEnd),
    staleTime: 60_000,
  })

  const upcomingScheduled = upcomingAppointments.filter((a) => a.status === 'scheduled')

  // 30-day back query — for "Past" tab
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
  if (dayError) return (
    <div className="text-center py-12">
      <p className="text-warm-gray dark:text-gray-400 mb-2">Failed to load appointments.</p>
      <p className="text-xs text-red-400 font-mono mb-4">{dayErrorDetail instanceof Error ? dayErrorDetail.message : 'Unknown error'}</p>
      <button onClick={() => window.location.reload()} className="text-sm text-slate-blue underline">Refresh</button>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-charcoal dark:text-white">Appointments</h1>
          <p className="text-warm-gray dark:text-gray-300 text-sm mt-1">
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
        <div className="flex items-center gap-3">
          {filter !== 'upcoming' && filter !== 'past' && (
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="px-3 py-2 border border-light-gray dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
            />
          )}
          <Button
            icon={<Plus size={18} />}
            onClick={() => navigate('/appointments/new')}
          >
            Schedule Appointment
          </Button>
        </div>
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
                        <h3 className="font-semibold text-charcoal dark:text-white">{appt.patientName}</h3>
                      )}
                      <Badge variant={statusVariants[appt.status] || 'gray'}>
                        {statusLabels[appt.status] || appt.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-warm-gray dark:text-gray-300">
                      {(filter === 'upcoming' || filter === 'past') && (
                        <span className="font-medium text-charcoal dark:text-white">
                          {formatDateShort(appt.startTime)}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatTime(appt.startTime)} - {formatTime(appt.endTime)}
                      </span>
                      <span>{appt.duration} min</span>
                    </div>
                    <div className="mt-3 flex gap-2 flex-wrap">
                      {/* No-show: charge fee + change status */}
                      {appt.status === 'no_show' && (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<DollarSign size={14} />}
                            onClick={() =>
                              appt.patientId
                                ? navigate(`/patients/${appt.patientId}?tab=billing&action=noshow`)
                                : navigate(`/billing?search=${encodeURIComponent(appt.patientName)}`)
                            }
                          >
                            Charge $30 No-Show Fee
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<RefreshCw size={14} />}
                            onClick={() => setChangingStatusId(changingStatusId === appt.id ? null : appt.id)}
                          >
                            Change Status
                          </Button>
                          {changingStatusId === appt.id && (
                            <div className="w-full flex gap-2 mt-1">
                              <Button size="sm" variant="primary" icon={<CheckCircle size={14} />} onClick={() => { setChangingStatusId(null); setCompletingAppt(appt) }}>
                                Complete
                              </Button>
                              <Button size="sm" variant="danger" icon={<XCircle size={14} />} onClick={() => { setChangingStatusId(null); setCancellingId(appt.id) }}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                      {/* Completed: collect payment + change status */}
                      {appt.status === 'completed' && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<CreditCard size={14} />}
                            onClick={() =>
                              appt.patientId
                                ? navigate(`/patients/${appt.patientId}?tab=billing&action=charge`)
                                : navigate(`/billing?search=${encodeURIComponent(appt.patientName)}`)
                            }
                          >
                            Collect Payment
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<RefreshCw size={14} />}
                            onClick={() => setChangingStatusId(changingStatusId === appt.id ? null : appt.id)}
                          >
                            Change Status
                          </Button>
                          {changingStatusId === appt.id && (
                            <div className="w-full flex gap-2 mt-1">
                              <Button size="sm" variant="danger" icon={<UserX size={14} />} onClick={() => { setChangingStatusId(null); setNoShowAppt(appt) }}>
                                No Show
                              </Button>
                              <Button size="sm" variant="danger" icon={<XCircle size={14} />} onClick={() => { setChangingStatusId(null); setCancellingId(appt.id) }}>
                                Cancel
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                      {/* Future (not today): Reschedule + Cancel + Change Status */}
                      {appt.status === 'scheduled' && !isPast && !isApptToday && (
                        <>
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Edit3 size={14} />}
                            onClick={() => openReschedule(appt)}
                          >
                            Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            icon={<XCircle size={14} />}
                            onClick={() => setCancellingId(appt.id)}
                          >
                            Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<RefreshCw size={14} />}
                            onClick={() => setChangingStatusId(changingStatusId === appt.id ? null : appt.id)}
                          >
                            Change Status
                          </Button>
                          {changingStatusId === appt.id && (
                            <div className="w-full flex gap-2 mt-1">
                              <Button size="sm" variant="danger" icon={<UserX size={14} />} onClick={() => { setChangingStatusId(null); setNoShowAppt(appt) }}>
                                No Show
                              </Button>
                              <Button size="sm" variant="primary" icon={<CheckCircle size={14} />} onClick={() => { setChangingStatusId(null); setCompletingAppt(appt) }}>
                                Complete
                              </Button>
                            </div>
                          )}
                        </>
                      )}
                      {/* Day-of scheduled: No Show + Complete */}
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
                            onClick={() => setCompletingAppt(appt)}
                          >
                            Complete
                          </Button>
                        </>
                      )}
                      {/* Past (not today) + still scheduled: No Show + Complete */}
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
                            variant="primary"
                            icon={<CheckCircle size={14} />}
                            onClick={() => setCompletingAppt(appt)}
                          >
                            Complete
                          </Button>
                        </>
                      )}
                    </div>
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
        message="This will cancel the appointment in Google Calendar. This action cannot be undone."
        confirmLabel="Cancel Appointment"
        danger
        loading={cancelMutation.isPending}
      />

      <ConfirmDialog
        open={!!noShowAppt}
        onClose={() => setNoShowAppt(null)}
        onConfirm={() => noShowAppt && noShowMutation.mutate(noShowAppt)}
        title="Mark as No-Show?"
        message="This will mark the appointment as a no-show and create a to-do to charge the $30 no-show fee."
        confirmLabel="Mark No-Show"
        danger
        loading={noShowMutation.isPending}
      />

      <ConfirmDialog
        open={!!completingAppt}
        onClose={() => setCompletingAppt(null)}
        onConfirm={() => completingAppt && completeMutation.mutate(completingAppt)}
        title="Complete Appointment?"
        message="This will mark the appointment as completed and create a to-do for doctor's notes."
        confirmLabel="Complete"
        loading={completeMutation.isPending}
      />

      {/* Reschedule Modal */}
      {rescheduleAppt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-bold text-charcoal dark:text-white mb-1">Reschedule Appointment</h2>
            <p className="text-sm text-warm-gray dark:text-gray-300 mb-4">
              {rescheduleAppt.patientName} — {rescheduleAppt.type}
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-charcoal dark:text-gray-200 mb-1">New Date</label>
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="w-full px-3 py-2 border border-light-gray dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal dark:text-gray-200 mb-1">New Time</label>
                <input
                  type="time"
                  value={rescheduleTime}
                  onChange={(e) => setRescheduleTime(e.target.value)}
                  className="w-full px-3 py-2 border border-light-gray dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal dark:text-gray-200 mb-1">Duration</label>
                <div className="flex gap-2">
                  {[15, 30, 45, 60].map((d) => (
                    <button
                      key={d}
                      onClick={() => setRescheduleDuration(d)}
                      className={`flex-1 py-2 rounded-lg border text-sm transition-colors ${
                        rescheduleDuration === d
                          ? 'border-slate-blue bg-slate-blue/10 text-slate-blue font-medium'
                          : 'border-light-gray dark:border-gray-600 text-warm-gray hover:bg-light-gray dark:hover:bg-gray-700'
                      }`}
                    >
                      {d}m
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <Button variant="ghost" onClick={() => setRescheduleAppt(null)} disabled={rescheduling}>
                Cancel
              </Button>
              <Button
                icon={<Calendar size={16} />}
                loading={rescheduling}
                onClick={handleReschedule}
              >
                Reschedule
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
