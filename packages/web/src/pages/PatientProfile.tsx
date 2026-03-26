import { useState, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
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
  Loader2,
  Trash2,
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
  listDictations,
  lookupPatient,
  chargePatient,
  chargeNoShow,
  createPaymentIntentForCharge,
  deleteNote,
} from '../api/endpoints'
import type { DictationRecord, BillingPatient } from '../api/endpoints'
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
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import stripePromise from '../lib/stripe'
import DictationMode from './DictationMode'
import type { Voicemail } from '../api/types'

function VoicemailTranscript({ vm }: { vm: Voicemail }) {
  const [expanded, setExpanded] = useState(false)

  if (vm.transcriptStatus === 'Pending') {
    return (
      <div className="mt-2 flex items-center gap-2 text-sm text-warm-gray dark:text-gray-400">
        <Loader2 size={14} className="animate-spin" />
        <span>Queued for transcription...</span>
      </div>
    )
  }

  if (vm.transcriptStatus === 'Transcribing') {
    return (
      <div className="mt-2 flex items-center gap-2 text-sm text-warm-gray dark:text-gray-400">
        <Loader2 size={14} className="animate-spin" />
        <span>Transcribing...</span>
      </div>
    )
  }

  if (vm.transcriptStatus === 'Failed') {
    return (
      <div className="mt-2 text-sm text-red-500">
        Transcription failed
      </div>
    )
  }

  if (!vm.transcript) return null

  const truncated = vm.transcript.length > 200
  const displayText = expanded ? vm.transcript : vm.transcript.slice(0, 200)

  return (
    <div className="mt-2">
      <div className="flex items-start gap-1.5">
        <FileText size={14} className="text-warm-gray dark:text-gray-400 mt-0.5 shrink-0" />
        <p className="text-sm text-charcoal dark:text-gray-200">
          {displayText}
          {truncated && !expanded && '...'}
        </p>
      </div>
      {truncated && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-slate-blue hover:underline mt-1 ml-5"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}

// Inner form for new-card charge — must be inside <Elements> provider
function NewCardChargeForm({
  customerId,
  amountCents,
  description,
  saveCard,
  onSuccess,
  onError,
}: {
  customerId: string
  amountCents: number
  description: string
  saveCard: boolean
  onSuccess: (result: { paymentIntentId: string; amount: number }) => void
  onError: (msg: string) => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [processing, setProcessing] = useState(false)

  const handleSubmit = async () => {
    if (!stripe || !elements) return
    const cardElement = elements.getElement(CardElement)
    if (!cardElement) return

    setProcessing(true)
    try {
      const { clientSecret, paymentIntentId } = await createPaymentIntentForCharge(
        customerId,
        amountCents,
        description || undefined,
        saveCard,
      )
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: { card: cardElement },
      })
      if (error) {
        onError(error.message || 'Card payment failed.')
      } else if (paymentIntent?.status === 'succeeded') {
        onSuccess({ paymentIntentId, amount: amountCents })
      } else {
        onError('Payment requires additional action. Please try again.')
      }
    } catch (err: any) {
      onError(err?.message || 'Payment failed.')
    } finally {
      setProcessing(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="p-3 border border-light-gray dark:border-gray-600 rounded-lg">
        <CardElement options={{
          style: {
            base: {
              fontSize: '16px',
              color: '#2D3748',
              '::placeholder': { color: '#A0AEC0' },
            },
          },
        }} />
      </div>
      <Button
        onClick={handleSubmit}
        loading={processing}
        disabled={!stripe || amountCents <= 0}
        icon={<DollarSign size={16} />}
        className="w-full"
      >
        Charge ${(amountCents / 100).toFixed(2)}
      </Button>
    </div>
  )
}

export default function PatientProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState(() => searchParams.get('tab') || 'overview')
  const [dictating, setDictating] = useState(false)
  const [cancellingApptId, setCancellingApptId] = useState<string | null>(null)
  const [noShowAppt, setNoShowAppt] = useState<Appointment | null>(null)
  const [completingAppt, setCompletingAppt] = useState<Appointment | null>(null)
  const [changingStatusId, setChangingStatusId] = useState<string | null>(null)
  const [showRxModal, setShowRxModal] = useState(false)
  // Billing modals
  const [showChargeModal, setShowChargeModal] = useState(false)
  const [showNoShowModal, setShowNoShowModal] = useState(false)
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeDesc, setChargeDesc] = useState('')
  const [charging, setCharging] = useState(false)
  const [chargeResult, setChargeResult] = useState<{ paymentIntentId: string; amount: number } | null>(null)
  const [chargeError, setChargeError] = useState('')
  const [chargeStep, setChargeStep] = useState<'amount' | 'newcard'>('amount')
  const [saveNewCard, setSaveNewCard] = useState(false)
  const [noShowLoading, setNoShowLoading] = useState(false)
  const [noShowResult, setNoShowResult] = useState(false)
  const [noShowError, setNoShowError] = useState('')
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
      } catch {
        console.warn('Failed to create no-show todo — appointment was still marked no-show')
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Marked as no-show. Collect $30 no-show fee.')
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
      } catch {
        console.warn('Failed to create notes todo — appointment was still marked complete')
      }
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

  const { data: patient, isLoading, isError } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
  })

  const { data: allVoicemails } = useQuery({
    queryKey: ['voicemails'],
    queryFn: listVoicemails,
    enabled: tab === 'voicemails',
  })

  // Filter voicemails: match by patientId attachment OR phone number
  const normalizeDigits = (phone: string) => phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  const voicemails = allVoicemails?.filter((vm) => {
    // Match by patientId (attached via Lambda auto-match or manual attach)
    if (vm.attachedTo?.patientId === id) return true
    // Match by phone number
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

  const { data: dictations } = useQuery({
    queryKey: ['patient-dictations', id],
    queryFn: () => listDictations(id!),
    enabled: !!id && (tab === 'notes' || dictating),
    refetchInterval: (query) => {
      const data = query.state.data
      const hasPending = data?.some((d) => d.status === 'Uploading' || d.status === 'Transcribing')
      return hasPending ? 10000 : false
    },
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

  // Billing lookup — runs when billing tab is active or a billing modal is open
  const { data: billing, isLoading: billingLoading, error: billingError } = useQuery<BillingPatient>({
    queryKey: ['billing', patient?.email, patient?.phone],
    queryFn: () => lookupPatient(patient!.email || patient!.phone),
    enabled: !!patient && (tab === 'billing' || showChargeModal || showNoShowModal),
    retry: false,
  })

  // Billing handlers
  const handleCharge = async () => {
    if (!billing?.paymentMethod || !billing?.customerId) return
    const dollars = parseFloat(chargeAmount)
    if (isNaN(dollars) || dollars <= 0) return
    const cents = Math.round(dollars * 100)
    setCharging(true)
    setChargeError('')
    try {
      const result = await chargePatient(billing.customerId, billing.paymentMethod.id, cents, chargeDesc || undefined)
      setChargeResult({ paymentIntentId: result.paymentIntentId, amount: cents })
    } catch (err: unknown) {
      setChargeError((err as Error)?.message || 'Payment failed. Please try again.')
    } finally {
      setCharging(false)
    }
  }

  const handleNoShowCharge = async () => {
    if (!billing?.paymentMethod || !billing?.customerId) return
    setNoShowLoading(true)
    setNoShowError('')
    try {
      await chargeNoShow(billing.customerId, billing.paymentMethod.id)
      setNoShowResult(true)
    } catch (err: unknown) {
      setNoShowError((err as Error)?.message || 'Failed to charge no-show fee.')
    } finally {
      setNoShowLoading(false)
    }
  }

  const resetChargeModal = () => {
    setShowChargeModal(false)
    setChargeAmount('')
    setChargeDesc('')
    setChargeResult(null)
    setChargeError('')
    setCharging(false)
    setChargeStep('amount')
    setSaveNewCard(false)
  }

  const resetNoShowModal = () => {
    setShowNoShowModal(false)
    setNoShowResult(false)
    setNoShowError('')
    setNoShowLoading(false)
  }

  const openChargeModal = () => { setShowChargeModal(true) }
  const openNoShowModal = () => { setShowNoShowModal(true) }

  const deleteNoteMutation = useMutation({
    mutationFn: (noteId: string) => deleteNote(id!, noteId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-notes'] })
      toast('success', 'Note deleted.')
    },
    onError: () => toast('error', 'Failed to delete note.'),
  })

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
  if (isError) return <div className="text-center py-12 text-warm-gray dark:text-gray-400">Failed to load patient. Please refresh.</div>
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
          setTab('notes')
          refetchNotes()
          queryClient.invalidateQueries({ queryKey: ['patient-dictations'] })
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
          { key: 'billing', label: 'Billing' },
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
                description="No appointments found for this patient."
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
                                  onClick={openNoShowModal}
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
                                  onClick={openChargeModal}
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
                    <div className="flex items-center gap-2 flex-wrap">
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
                      <Badge
                        variant={
                          vm.status === 'Attached' || vm.status === 'Reviewed'
                            ? 'green'
                            : vm.status === 'Archived'
                              ? 'gray'
                              : 'red'
                        }
                      >
                        {vm.status}
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
                    <VoicemailTranscript vm={vm} />
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
                          onClick={openNoShowModal}
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
            {/* Pending dictations */}
            {dictations && dictations.filter((d) => d.status === 'Uploading' || d.status === 'Transcribing').length > 0 && (
              <div className="space-y-2 mb-4">
                {dictations
                  .filter((d) => d.status === 'Uploading' || d.status === 'Transcribing')
                  .map((d) => (
                    <Card key={d.dictation_id} className="border-l-4 border-l-yellow-400">
                      <div className="flex items-center gap-3">
                        <Loader2 size={18} className="text-yellow-500 animate-spin shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-charcoal dark:text-white">
                            {d.status === 'Uploading' ? 'Uploading dictation...' : 'Transcribing dictation...'}
                          </p>
                          <p className="text-xs text-warm-gray dark:text-gray-400">
                            {new Date(d.created_at).toLocaleString()}
                          </p>
                        </div>
                      </div>
                    </Card>
                  ))}
              </div>
            )}

            {/* Completed dictations with audio + transcript */}
            {dictations && dictations.filter((d) => d.status === 'DraftReady' || d.status === 'TranscriptionFailed').length > 0 && (
              <div className="space-y-3 mb-4">
                {dictations
                  .filter((d) => d.status === 'DraftReady' || d.status === 'TranscriptionFailed')
                  .map((d) => (
                    <Card key={d.dictation_id}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Mic size={16} className="text-slate-blue shrink-0" />
                          <h3 className="font-semibold text-charcoal dark:text-white text-sm">
                            Dictation — {new Date(d.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} at {new Date(d.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                          </h3>
                        </div>
                        {d.confidence !== null && (
                          <Badge variant="green">{(d.confidence * 100).toFixed(0)}%</Badge>
                        )}
                        {d.status === 'TranscriptionFailed' && (
                          <Badge variant="red">Failed</Badge>
                        )}
                      </div>
                      {d.audio_url && (
                        <audio
                          controls
                          preload="none"
                          className="w-full h-10 mb-2"
                          src={d.audio_url}
                        />
                      )}
                      {d.transcript_text ? (
                        <pre className="text-sm text-charcoal dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                          {d.transcript_text}
                        </pre>
                      ) : d.status === 'TranscriptionFailed' ? (
                        <p className="text-sm text-red-500">Transcription failed. Audio is still available for playback above.</p>
                      ) : null}
                    </Card>
                  ))}
              </div>
            )}

            {/* Notes (with audio player when available) */}
            {notes && notes.length > 0 && (
              <div className="space-y-3">
                {notes.map((note) => (
                  <Card key={note.id}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {note.audioUrl && <Mic size={16} className="text-slate-blue shrink-0" />}
                        <h3 className="font-semibold text-charcoal dark:text-white">{note.title}</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-warm-gray dark:text-gray-300">{formatDate(note.createdAt)}</span>
                        <button
                          onClick={() => deleteNoteMutation.mutate(note.id)}
                          disabled={deleteNoteMutation.isPending}
                          className="p-1.5 rounded-md text-warm-gray hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                          aria-label="Delete note"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                    {note.audioUrl && (
                      <audio
                        controls
                        preload="none"
                        className="w-full h-10 mb-2"
                        src={note.audioUrl}
                      />
                    )}
                    <pre className="text-sm text-charcoal dark:text-gray-200 whitespace-pre-wrap font-sans leading-relaxed">
                      {note.body}
                    </pre>
                  </Card>
                ))}
              </div>
            )}

            {/* Empty state */}
            {(!notes || notes.filter((n) => !n.title.startsWith('Dictation —')).length === 0) && (!dictations || dictations.length === 0) && (
              <EmptyState
                icon={<Mic size={48} />}
                title="No dictations yet"
                description="Use the Dictate Note button to record and transcribe appointment notes."
              />
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

        {/* Billing Tab */}
        {tab === 'billing' && (
          <div className="space-y-4">
            {billingLoading && (
              <div className="flex items-center justify-center py-12">
                <LoadingSpinner />
              </div>
            )}

            {!billingLoading && billingError && (
              <Card>
                <div className="flex items-start gap-3 text-warm-gray dark:text-gray-400">
                  <AlertCircle size={20} className="shrink-0 mt-0.5 text-amber-500" />
                  <div>
                    <p className="font-medium text-charcoal dark:text-white">No payment info found</p>
                    <p className="text-sm mt-1">
                      This patient hasn't completed the booking form at vantagerefinery.com, or their card hasn't been saved yet.
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {!billingLoading && billing && (
              <Card>
                <div className="space-y-4">
                  <div>
                    <h3 className="font-semibold text-charcoal dark:text-white">
                      {billing.firstName} {billing.lastName}
                    </h3>
                    <div className="mt-1 space-y-0.5 text-sm text-warm-gray dark:text-gray-300">
                      {billing.email && <p>{billing.email}</p>}
                      {billing.phone && <p>{billing.phone}</p>}
                    </div>
                  </div>

                  {billing.paymentMethod ? (
                    <div className="flex items-center gap-2 p-3 bg-light-gray dark:bg-gray-700 rounded-lg">
                      <CreditCard size={18} className="text-slate-blue" />
                      <span className="text-sm font-medium text-charcoal dark:text-white capitalize">
                        {billing.paymentMethod.brand} ending in {billing.paymentMethod.last4}
                      </span>
                      <span className="text-xs text-warm-gray dark:text-gray-400 ml-1">
                        (exp {billing.paymentMethod.expMonth}/{billing.paymentMethod.expYear})
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-700 dark:text-yellow-300">
                      <AlertCircle size={16} />
                      No card on file
                    </div>
                  )}

                  <div className="flex gap-3 pt-1">
                    <Button
                      onClick={openChargeModal}
                      icon={<DollarSign size={18} />}
                    >
                      Charge Patient
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={openNoShowModal}
                      disabled={!billing.paymentMethod}
                    >
                      No-Show ($30)
                    </Button>
                  </div>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>

      {/* Charge Patient Modal */}
      <Modal open={showChargeModal} onClose={resetChargeModal} title="Charge Patient" size="sm">
        {chargeResult ? (
          <div className="text-center py-4">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-charcoal dark:text-white">
              ${(chargeResult.amount / 100).toFixed(2)} charged successfully
            </p>
            <p className="text-xs text-warm-gray dark:text-gray-400 mt-2">{chargeResult.paymentIntentId}</p>
            <Button className="mt-4" onClick={resetChargeModal}>Done</Button>
          </div>
        ) : chargeStep === 'amount' ? (
          <div className="space-y-4">
            {billingLoading && <div className="flex justify-center py-4"><LoadingSpinner /></div>}
            {billing?.paymentMethod && (
              <div className="flex items-center gap-2 p-3 bg-light-gray dark:bg-gray-700 rounded-lg text-sm">
                <CreditCard size={16} className="text-slate-blue" />
                <span className="text-charcoal dark:text-white capitalize">
                  {billing.paymentMethod.brand} {'\u2022\u2022\u2022\u2022'} {billing.paymentMethod.last4}
                </span>
              </div>
            )}
            <Input
              label="Amount ($)"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={chargeAmount}
              onChange={(e) => setChargeAmount(e.target.value)}
            />
            <Input
              label="Description (optional)"
              placeholder="e.g. Initial Consultation, Follow-up Visit"
              value={chargeDesc}
              onChange={(e) => setChargeDesc(e.target.value)}
            />
            {chargeError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{chargeError}</p>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={resetChargeModal} disabled={charging}>Cancel</Button>
              {billing?.paymentMethod && (
                <Button
                  onClick={handleCharge}
                  loading={charging}
                  disabled={!chargeAmount || parseFloat(chargeAmount) <= 0}
                  icon={<DollarSign size={16} />}
                >
                  Charge this card
                </Button>
              )}
              <Button
                variant={billing?.paymentMethod ? 'ghost' : 'primary'}
                onClick={() => setChargeStep('newcard')}
                disabled={!chargeAmount || parseFloat(chargeAmount) <= 0}
                icon={<CreditCard size={16} />}
              >
                {billing?.paymentMethod ? 'Use a different card' : 'Enter card'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-warm-gray dark:text-gray-300">
              Charging <strong className="text-charcoal dark:text-white">${parseFloat(chargeAmount).toFixed(2)}</strong> to a new card
              {chargeDesc && <> for <em>{chargeDesc}</em></>}
            </p>
            <Elements stripe={stripePromise}>
              <NewCardChargeForm
                customerId={billing?.customerId || ''}
                amountCents={Math.round(parseFloat(chargeAmount) * 100)}
                description={chargeDesc}
                saveCard={saveNewCard}
                onSuccess={(result) => setChargeResult(result)}
                onError={(msg) => setChargeError(msg)}
              />
            </Elements>
            <label className="flex items-center gap-2 text-sm text-charcoal dark:text-gray-300 cursor-pointer">
              <input
                type="checkbox"
                checked={saveNewCard}
                onChange={(e) => setSaveNewCard(e.target.checked)}
                className="rounded border-light-gray text-slate-blue focus:ring-slate-blue"
              />
              Save this card on file for future use
            </label>
            {chargeError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{chargeError}</p>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={() => { setChargeStep('amount'); setChargeError('') }}>Back</Button>
              <Button variant="ghost" onClick={resetChargeModal}>Cancel</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* No-Show Fee Modal */}
      <Modal open={showNoShowModal} onClose={resetNoShowModal} title="Charge No-Show Fee" size="sm">
        {noShowResult ? (
          <div className="text-center py-4">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-charcoal dark:text-white">
              $30 no-show fee charged to {patient?.firstName} {patient?.lastName}.
            </p>
            <Button className="mt-4" onClick={resetNoShowModal}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            {billingLoading && <div className="flex justify-center py-4"><LoadingSpinner /></div>}
            <p className="text-sm text-warm-gray dark:text-gray-300">
              A <strong className="text-charcoal dark:text-white">$30 no-show fee</strong> will be charged to{' '}
              <strong className="text-charcoal dark:text-white">{patient?.firstName} {patient?.lastName}</strong>'s card on file.
            </p>
            {billing?.paymentMethod && (
              <div className="flex items-center gap-2 p-3 bg-light-gray dark:bg-gray-700 rounded-lg text-sm">
                <CreditCard size={16} className="text-slate-blue" />
                <span className="text-charcoal dark:text-white capitalize">
                  {billing.paymentMethod.brand} •••• {billing.paymentMethod.last4}
                </span>
              </div>
            )}
            {noShowError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{noShowError}</p>
            )}
            <div className="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={resetNoShowModal} disabled={noShowLoading}>Cancel</Button>
              <Button
                variant="danger"
                onClick={handleNoShowCharge}
                loading={noShowLoading}
                disabled={!billing?.paymentMethod}
              >
                Charge $30
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!cancellingApptId}
        onClose={() => setCancellingApptId(null)}
        onConfirm={() => cancellingApptId && cancelMutation.mutate(cancellingApptId)}
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
    </div>
  )
}
