import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeft,
  Phone,
  Calendar,
  Mic,
  FileText,
  ClipboardList,
  Pill,
  User,
  Mail,
  MapPin,
  Heart,
  Shield,
  Languages,
  Stethoscope,
  AlertTriangle,
  StickyNote,
  CreditCard,
  XCircle,
  DollarSign,
  UserX,
  CheckCircle,
  Send,
  Upload,
  Clock,
  AlertCircle,
  RefreshCw,
} from 'lucide-react'
import {
  getPatient,
  listTodos,
  listNotes,
  listVoicemails,
  listPatientAppointments,
  listFaxes,
  sendFax,
  uploadToS3,
  cancelAppointment,
  markNoShow,
  completeAppointment,
  createTodo,
} from '../api/endpoints'
import type { Appointment, SendFaxRequest } from '../api/types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Tabs } from '../components/ui/Tabs'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { formatDate, formatDateTime, formatDuration, timeAgo, isOverdue } from '../lib/utils'
import DictationMode from './DictationMode'

export default function PatientProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('overview')
  const [dictating, setDictating] = useState(false)
  const [cancellingApptId, setCancellingApptId] = useState<string | null>(null)
  const [noShowAppt, setNoShowAppt] = useState<Appointment | null>(null)
  const [completingAppt, setCompletingAppt] = useState<Appointment | null>(null)
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null)
  const [showRxModal, setShowRxModal] = useState(false)
  const [rxForm, setRxForm] = useState<SendFaxRequest>({
    pharmacyName: '',
    pharmacyFax: '',
    pharmacyPhone: '',
    rxDetails: { medication: '', dosage: '', directions: '', quantity: '', refills: '', prescriberName: '' },
  })
  const [rxFile, setRxFile] = useState<File | null>(null)
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const cancelMutation = useMutation({
    mutationFn: (apptId: string) => cancelAppointment(apptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Appointment cancelled')
      setCancellingApptId(null)
    },
    onError: (err) => {
      toast('error', `Failed to cancel: ${(err as Error).message}`)
      setCancellingApptId(null)
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
      queryClient.invalidateQueries({ queryKey: ['patient-appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
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

  const completeMutation = useMutation({
    mutationFn: async (appt: Appointment) => {
      await completeAppointment(appt.id)
      await createTodo({
        type: 'General',
        title: `Doctor's notes — ${appt.patientName}`,
        status: 'Open',
        priority: 'Med',
        patientId: appt.patientId || undefined,
        dueDate: new Date().toISOString(),
        notes: `Complete doctor's notes for ${appt.type} appointment.`,
      })
    },
    onSuccess: (_data, appt) => {
      queryClient.invalidateQueries({ queryKey: ['patient-appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', `${appt.patientName}'s appointment marked complete. To-do created for doctor's notes.`)
      setCompletingAppt(null)
    },
    onError: (err) => {
      toast('error', `Failed: ${(err as Error).message}`)
      setCompletingAppt(null)
    },
  })

  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
  })

  const { data: allVoicemails } = useQuery({
    queryKey: ['voicemails'],
    queryFn: listVoicemails,
    enabled: tab === 'voicemails',
  })

  // Filter voicemails by matching patient phone number (normalize to digits for comparison)
  const normalizeDigits = (phone: string) => phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  const voicemails = allVoicemails?.filter((vm) => {
    if (!patient?.phone) return false
    const patientDigits = normalizeDigits(patient.phone)
    const callerDigits = normalizeDigits(vm.callerNumber)
    return patientDigits === callerDigits
  })

  const { data: allTodos } = useQuery({
    queryKey: ['todos'],
    queryFn: listTodos,
    enabled: tab === 'todos',
  })

  const todos = allTodos?.filter((t) => t.patientId === id)

  const { data: notes, refetch: refetchNotes } = useQuery({
    queryKey: ['patient-notes', id],
    queryFn: () => listNotes(id!),
    enabled: !!id && (tab === 'notes' || dictating),
  })

  const { data: appointments } = useQuery({
    queryKey: ['patient-appointments', patient?.phone],
    queryFn: () => listPatientAppointments(patient!.phone),
    enabled: !!patient?.phone && tab === 'appointments',
  })

  const { data: allFaxes } = useQuery({
    queryKey: ['faxes'],
    queryFn: listFaxes,
    enabled: tab === 'prescriptions',
  })

  const patientFaxes = allFaxes?.filter((f) => f.patientId === id)

  const rxSendMutation = useMutation({
    mutationFn: async () => {
      let attachmentUrl: string | undefined
      if (rxFile) {
        const result = await uploadToS3(rxFile, 'fax-attachments')
        attachmentUrl = result.url
      }
      return sendFax({ ...rxForm, patientId: id, attachmentUrl })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxes'] })
      toast('success', 'Prescription faxed successfully!')
      setShowRxModal(false)
      setRxForm({
        pharmacyName: '',
        pharmacyFax: '',
        pharmacyPhone: '',
        rxDetails: { medication: '', dosage: '', directions: '', quantity: '', refills: '', prescriberName: '' },
      })
      setRxFile(null)
    },
    onError: () => toast('error', 'Failed to send fax. Please try again.'),
  })

  const updateRx = (field: string, value: string) => {
    setRxForm({ ...rxForm, rxDetails: { ...rxForm.rxDetails, [field]: value } })
  }

  if (isLoading) return <LoadingSpinner />
  if (!patient) {
    return (
      <EmptyState
        icon={<User size={48} />}
        title="Patient not found"
        action={<Button onClick={() => navigate('/patients')}>Back to Patients</Button>}
      />
    )
  }

  if (dictating) {
    return (
      <DictationMode
        patientId={id!}
        patientName={`${patient.firstName} ${patient.lastName}`}
        onClose={() => {
          setDictating(false)
          refetchNotes()
        }}
      />
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/patients')}
          className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors"
          aria-label="Back to patients"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-charcoal dark:text-white">
            {patient.firstName} {patient.lastName}
          </h1>
          <p className="text-sm text-warm-gray dark:text-gray-300">{patient.phone}</p>
        </div>
        <Button
          onClick={() => setDictating(true)}
          icon={<Mic size={18} />}
          size="lg"
        >
          Dictate Note
        </Button>
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'appointments', label: 'Appointments' },
          { key: 'voicemails', label: 'Voicemails' },
          { key: 'todos', label: 'To-Dos' },
          { key: 'notes', label: 'Notes' },
          { key: 'prescriptions', label: 'Prescriptions' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {/* Overview Tab */}
        {tab === 'overview' && (
          <Card>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-slate-blue/10 text-slate-blue flex items-center justify-center text-2xl font-semibold">
                  {patient.firstName[0]}
                  {patient.lastName[0]}
                </div>
                <div>
                  <h2 className="text-xl font-semibold dark:text-white">
                    {patient.firstName} {patient.lastName}
                  </h2>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-light-gray dark:border-gray-700">
                <div className="flex items-center gap-3">
                  <Phone size={18} className="text-warm-gray" />
                  <div>
                    <p className="text-xs text-warm-gray dark:text-gray-300">Phone</p>
                    <p className="font-medium">{patient.phone}</p>
                  </div>
                </div>
                {patient.dob && (
                  <div className="flex items-center gap-3">
                    <Calendar size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Date of Birth</p>
                      <p className="font-medium">{formatDate(patient.dob)}</p>
                    </div>
                  </div>
                )}
                {patient.email && (
                  <div className="flex items-center gap-3">
                    <Mail size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Email</p>
                      <p className="font-medium">{patient.email}</p>
                    </div>
                  </div>
                )}
                {patient.gender && (
                  <div className="flex items-center gap-3">
                    <User size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Gender</p>
                      <p className="font-medium">{patient.gender}</p>
                    </div>
                  </div>
                )}
                {patient.preferredLanguage && (
                  <div className="flex items-center gap-3">
                    <Languages size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Preferred Language</p>
                      <p className="font-medium">{patient.preferredLanguage}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <User size={18} className="text-warm-gray" />
                  <div>
                    <p className="text-xs text-warm-gray dark:text-gray-300">Patient Since</p>
                    <p className="font-medium">{formatDate(patient.createdAt)}</p>
                  </div>
                </div>
              </div>

              {/* Address */}
              {(patient.addressStreet || patient.addressCity) && (
                <div className="pt-4 border-t border-light-gray dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <MapPin size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Address</p>
                      <p className="font-medium">
                        {[patient.addressStreet, patient.addressCity, patient.addressState, patient.addressZip]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Emergency Contact */}
              {patient.emergencyContactName && (
                <div className="pt-4 border-t border-light-gray dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <Heart size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Emergency Contact</p>
                      <p className="font-medium">
                        {patient.emergencyContactName}
                        {patient.emergencyContactRelationship && ` (${patient.emergencyContactRelationship})`}
                      </p>
                      {patient.emergencyContactPhone && (
                        <p className="text-sm text-warm-gray dark:text-gray-300">{patient.emergencyContactPhone}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Medical */}
              {(patient.primaryCareProvider || patient.allergies) && (
                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-light-gray dark:border-gray-700">
                  {patient.primaryCareProvider && (
                    <div className="flex items-center gap-3">
                      <Stethoscope size={18} className="text-warm-gray" />
                      <div>
                        <p className="text-xs text-warm-gray dark:text-gray-300">Primary Care Provider</p>
                        <p className="font-medium">{patient.primaryCareProvider}</p>
                      </div>
                    </div>
                  )}
                  {patient.allergies && (
                    <div className="flex items-center gap-3">
                      <AlertTriangle size={18} className="text-warm-gray" />
                      <div>
                        <p className="text-xs text-warm-gray dark:text-gray-300">Allergies</p>
                        <p className="font-medium">{patient.allergies}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Insurance */}
              {patient.insuranceProvider && (
                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-light-gray dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <Shield size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Insurance</p>
                      <p className="font-medium">{patient.insuranceProvider}</p>
                      {patient.insuranceId && (
                        <p className="text-sm text-warm-gray dark:text-gray-300">ID: {patient.insuranceId}</p>
                      )}
                    </div>
                  </div>
                  {patient.insuranceGroupNumber && (
                    <div className="flex items-center gap-3">
                      <Shield size={18} className="text-warm-gray" />
                      <div>
                        <p className="text-xs text-warm-gray dark:text-gray-300">Group / Policy Holder</p>
                        <p className="font-medium">{patient.insuranceGroupNumber}</p>
                        {patient.insurancePolicyHolder && (
                          <p className="text-sm text-warm-gray dark:text-gray-300">{patient.insurancePolicyHolder}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {patient.notes && (
                <div className="pt-4 border-t border-light-gray dark:border-gray-700">
                  <div className="flex items-start gap-3">
                    <StickyNote size={18} className="text-warm-gray mt-0.5" />
                    <div>
                      <p className="text-xs text-warm-gray dark:text-gray-300">Notes</p>
                      <p className="font-medium whitespace-pre-wrap">{patient.notes}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Appointments Tab */}
        {tab === 'appointments' && (
          <>
            {!appointments || appointments.length === 0 ? (
              <EmptyState
                icon={<Calendar size={48} />}
                title="No appointments"
                description="No appointments found for this patient in Acuity Scheduling."
              />
            ) : (
              <div className="space-y-3">
                {appointments.map((appt: Appointment) => {
                  const isPast = new Date(appt.startTime) < new Date()
                  return (
                    <Card key={appt.id}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={
                            appt.status === 'cancelled'
                              ? 'gray'
                              : appt.status === 'no_show'
                                ? 'red'
                                : appt.status === 'completed'
                                  ? 'green'
                                  : 'blue'
                          }
                        >
                          {appt.status === 'cancelled'
                            ? 'Cancelled'
                            : appt.status === 'no_show'
                              ? 'No Show'
                              : appt.status === 'completed'
                                ? 'Completed'
                                : 'Scheduled'}
                        </Badge>
                        <Badge variant="gray">{appt.type}</Badge>
                      </div>
                      <p className="font-medium">
                        {new Date(appt.startTime).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="text-sm text-warm-gray dark:text-gray-300">
                        {new Date(appt.startTime).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        -{' '}
                        {new Date(appt.endTime).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        ({appt.duration} min)
                      </p>
                      {appt.notes && (
                        <p className="text-sm text-warm-gray dark:text-gray-300 mt-1 italic">{appt.notes}</p>
                      )}
                      {(() => {
                        const apptDate = appt.startTime.slice(0, 10)
                        const isApptToday = apptDate === todayStr
                        return (
                          <div className="mt-3 flex gap-2 flex-wrap">
                            {/* No-show: charge fee + change status */}
                            {appt.status === 'no_show' && (
                              <>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  icon={<DollarSign size={14} />}
                                  onClick={() =>
                                    navigate(
                                      `/billing/no-show?name=${encodeURIComponent(appt.patientName)}`
                                    )
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
                                    <Button size="sm" variant="danger" icon={<XCircle size={14} />} onClick={() => { setChangingStatusId(null); setCancellingApptId(appt.id) }}>
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
                                    navigate(
                                      `/billing/charge?name=${encodeURIComponent(appt.patientName)}`
                                    )
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
                                    <Button size="sm" variant="danger" icon={<XCircle size={14} />} onClick={() => { setChangingStatusId(null); setCancellingApptId(appt.id) }}>
                                      Cancel
                                    </Button>
                                  </div>
                                )}
                              </>
                            )}
                            {/* Future (not today): Cancel + Change Status */}
                            {appt.status === 'scheduled' && !isPast && !isApptToday && (
                              <>
                                <Button
                                  size="sm"
                                  variant="danger"
                                  icon={<XCircle size={14} />}
                                  onClick={() => setCancellingApptId(appt.id)}
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
                        )
                      })()}
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Voicemails Tab */}
        {tab === 'voicemails' && (
          <>
            {!voicemails || voicemails.length === 0 ? (
              <EmptyState
                icon={<Phone size={48} />}
                title="No voicemails"
                description="No voicemails have been linked to this patient."
              />
            ) : (
              <div className="space-y-3">
                {voicemails.map((vm) => (
                  <Card key={vm.id}>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          vm.category === 'Scheduling'
                            ? 'blue'
                            : vm.category === 'Refills'
                              ? 'green'
                              : vm.category === 'Basic Questions'
                                ? 'yellow'
                                : 'gray'
                        }
                      >
                        {vm.category}
                      </Badge>
                      <span className="text-sm text-warm-gray dark:text-gray-300">{timeAgo(vm.receivedAt)}</span>
                      <span className="text-sm text-warm-gray dark:text-gray-300">
                        {formatDuration(vm.durationSeconds)}
                      </span>
                    </div>
                    <audio
                      controls
                      src={vm.audioUrl}
                      className="mt-2 w-full h-10"
                      preload="none"
                    />
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Todos Tab */}
        {tab === 'todos' && (
          <>
            {!todos || todos.length === 0 ? (
              <EmptyState
                icon={<ClipboardList size={48} />}
                title="No to-dos"
                description="No to-dos are linked to this patient."
              />
            ) : (
              <div className="space-y-3">
                {todos.map((t) => (
                  <Card key={t.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={t.status === 'Done' ? 'green' : 'yellow'}
                      >
                        {t.status}
                      </Badge>
                      <Badge variant={t.priority === 'High' ? 'red' : t.priority === 'Med' ? 'yellow' : 'gray'}>
                        {t.priority}
                      </Badge>
                    </div>
                    <p className="font-medium">{t.title}</p>
                    {t.notes && <p className="text-sm text-warm-gray dark:text-gray-300 mt-1">{t.notes}</p>}
                    <p className="text-xs text-warm-gray dark:text-gray-300 mt-1">{formatDateTime(t.createdAt)}</p>
                    {t.status === 'Open' && t.dueDate && isOverdue(t.dueDate) && (
                      <div className="mt-2">
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<DollarSign size={14} />}
                          onClick={() =>
                            navigate(
                              `/billing/no-show?name=${encodeURIComponent(`${patient.firstName} ${patient.lastName}`)}`
                            )
                          }
                        >
                          Charge $30 No-Show Fee
                        </Button>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Notes Tab */}
        {tab === 'notes' && (
          <>
            <div className="mb-4">
              <Button
                onClick={() => setDictating(true)}
                icon={<Mic size={18} />}
              >
                Dictate New Note
              </Button>
            </div>
            {!notes || notes.length === 0 ? (
              <EmptyState
                icon={<FileText size={48} />}
                title="No notes yet"
                description="Use the Dictate button to create appointment notes."
                action={
                  <Button onClick={() => setDictating(true)} icon={<Mic size={18} />}>
                    Dictate Note
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <Card key={note.id}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-charcoal">{note.title}</h3>
                      <span className="text-xs text-warm-gray dark:text-gray-300">{formatDate(note.createdAt)}</span>
                    </div>
                    <pre className="text-sm text-charcoal whitespace-pre-wrap font-sans leading-relaxed">
                      {note.body}
                    </pre>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Prescriptions Tab */}
        {tab === 'prescriptions' && (
          <>
            <div className="mb-4">
              <Button
                onClick={() => setShowRxModal(true)}
                icon={<Send size={18} />}
              >
                Fax Prescription
              </Button>
            </div>
            {!patientFaxes || patientFaxes.length === 0 ? (
              <EmptyState
                icon={<Pill size={48} />}
                title="No prescriptions"
                description="Faxed prescriptions for this patient will appear here."
                action={
                  <Button onClick={() => setShowRxModal(true)} icon={<Send size={18} />}>
                    Fax Prescription
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {patientFaxes.map((fax) => {
                  const statusIcon = fax.status === 'Sent' ? CheckCircle : fax.status === 'Failed' ? AlertCircle : Clock
                  const StatusIcon = statusIcon
                  return (
                    <Card key={fax.id}>
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <Badge
                          variant={
                            fax.status === 'Sent' ? 'green' : fax.status === 'Failed' ? 'red' : 'yellow'
                          }
                        >
                          <StatusIcon size={12} className="mr-1" />
                          {fax.status}
                        </Badge>
                        <span className="text-sm text-warm-gray dark:text-gray-300 dark:text-gray-300">
                          {fax.pharmacyName}
                        </span>
                      </div>
                      {fax.rxDetails && (
                        <p className="font-medium text-charcoal dark:text-white">
                          {fax.rxDetails.medication} {fax.rxDetails.dosage}
                        </p>
                      )}
                      <p className="text-sm text-warm-gray dark:text-gray-300 dark:text-gray-300">
                        Fax: {fax.pharmacyFax}
                      </p>
                      <p className="text-xs text-warm-gray dark:text-gray-300 dark:text-gray-500 mt-1">
                        {formatDateTime(fax.createdAt)}
                      </p>
                    </Card>
                  )
                })}
              </div>
            )}

            {/* Fax Prescription Modal */}
            <Modal
              open={showRxModal}
              onClose={() => setShowRxModal(false)}
              title="Fax Prescription"
              size="lg"
            >
              <div className="space-y-4">
                <div className="border-b border-light-gray dark:border-gray-700 dark:border-gray-700 pb-4">
                  <h3 className="font-semibold text-charcoal dark:text-white mb-3">Pharmacy</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Input
                      label="Pharmacy Name"
                      placeholder="e.g. CVS Pharmacy"
                      value={rxForm.pharmacyName}
                      onChange={(e) => setRxForm({ ...rxForm, pharmacyName: e.target.value })}
                    />
                    <Input
                      label="Fax Number"
                      placeholder="(555) 000-0000"
                      value={rxForm.pharmacyFax}
                      onChange={(e) => setRxForm({ ...rxForm, pharmacyFax: e.target.value })}
                      type="tel"
                    />
                  </div>
                </div>

                <div className="border-b border-light-gray dark:border-gray-700 dark:border-gray-700 pb-4">
                  <h3 className="font-semibold text-charcoal dark:text-white mb-3">Prescription</h3>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <Input
                      label="Medication"
                      placeholder="e.g. Lisinopril"
                      value={rxForm.rxDetails.medication}
                      onChange={(e) => updateRx('medication', e.target.value)}
                    />
                    <Input
                      label="Dosage"
                      placeholder="e.g. 10mg"
                      value={rxForm.rxDetails.dosage}
                      onChange={(e) => updateRx('dosage', e.target.value)}
                    />
                    <div className="sm:col-span-2">
                      <Input
                        label="Directions"
                        placeholder="e.g. Take one tablet daily"
                        value={rxForm.rxDetails.directions}
                        onChange={(e) => updateRx('directions', e.target.value)}
                      />
                    </div>
                    <Input
                      label="Quantity"
                      placeholder="e.g. 30"
                      value={rxForm.rxDetails.quantity}
                      onChange={(e) => updateRx('quantity', e.target.value)}
                    />
                    <Input
                      label="Refills"
                      placeholder="e.g. 5"
                      value={rxForm.rxDetails.refills}
                      onChange={(e) => updateRx('refills', e.target.value)}
                    />
                    <div className="sm:col-span-2">
                      <Input
                        label="Prescriber Name"
                        placeholder="e.g. Dr. Sarah Chen"
                        value={rxForm.rxDetails.prescriberName}
                        onChange={(e) => updateRx('prescriberName', e.target.value)}
                      />
                    </div>
                  </div>
                </div>

                <div className="border-b border-light-gray dark:border-gray-700 dark:border-gray-700 pb-4">
                  <h3 className="font-semibold text-charcoal dark:text-white mb-3">Attachment (optional)</h3>
                  <label className="flex items-center gap-3 p-4 border-2 border-dashed border-light-gray dark:border-gray-600 rounded-lg cursor-pointer hover:border-slate-blue hover:bg-slate-blue/5 transition-colors min-h-[64px]">
                    <Upload size={22} className="text-warm-gray" />
                    <div>
                      {rxFile ? (
                        <span className="font-medium text-charcoal dark:text-white">{rxFile.name}</span>
                      ) : (
                        <>
                          <span className="font-medium text-charcoal dark:text-white">Upload PDF or image</span>
                          <p className="text-xs text-warm-gray dark:text-gray-300 dark:text-gray-300">Click to choose a file</p>
                        </>
                      )}
                    </div>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png"
                      className="hidden"
                      onChange={(e) => setRxFile(e.target.files?.[0] || null)}
                    />
                  </label>
                </div>

                <div className="flex gap-3 justify-end pt-4">
                  <Button variant="ghost" onClick={() => setShowRxModal(false)}>
                    Cancel
                  </Button>
                  <Button
                    onClick={() => rxSendMutation.mutate()}
                    loading={rxSendMutation.isPending}
                    icon={<Send size={18} />}
                    disabled={!rxForm.pharmacyName || !rxForm.pharmacyFax || !rxForm.rxDetails.medication}
                  >
                    Send Fax
                  </Button>
                </div>
              </div>
            </Modal>
          </>
        )}
      </div>

      <ConfirmDialog
        open={!!cancellingApptId}
        onClose={() => setCancellingApptId(null)}
        onConfirm={() => cancellingApptId && cancelMutation.mutate(cancellingApptId)}
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

      <ConfirmDialog
        open={!!completingAppt}
        onClose={() => setCompletingAppt(null)}
        onConfirm={() => completingAppt && completeMutation.mutate(completingAppt)}
        title="Complete Appointment?"
        message="This will mark the appointment as completed and create a to-do for doctor's notes."
        confirmLabel="Complete"
        loading={completeMutation.isPending}
      />
    </div>
  )
}
