import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import {
  ArrowLeft,
  Search,
  Plus,
  CreditCard,
  Calendar,
  CheckCircle,
  AlertTriangle,
} from 'lucide-react'
import stripePromise from '../lib/stripe'
import { createSetupIntent, confirmSetup, searchCustomers } from '../api/stripe-endpoints'
import type { StripeCustomer, ConfirmSetupResponse } from '../api/stripe-types'
import { listAllPatients, createPatient, createAppointment } from '../api/endpoints'
import type { Patient, CreatePatientRequest } from '../api/types'
import { Card } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { useToast } from '../components/ui/Toast'

// ── Card Form (rendered inside <Elements>) ──

interface CardFormProps {
  clientSecret: string
  customerId: string
  customerName: string
  onSuccess: (result: ConfirmSetupResponse) => void
  onError: (msg: string) => void
}

function CardForm({ clientSecret, customerId, customerName, onSuccess, onError }: CardFormProps) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return

    setSubmitting(true)
    try {
      const cardElement = elements.getElement(CardElement)
      if (!cardElement) throw new Error('Card element not found')

      const { error, setupIntent } = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      })

      if (error) {
        onError(error.message || 'Card setup failed')
        return
      }

      if (!setupIntent?.payment_method) {
        onError('No payment method returned')
        return
      }

      const pmId = typeof setupIntent.payment_method === 'string'
        ? setupIntent.payment_method
        : setupIntent.payment_method.id

      const result = await confirmSetup({ customerId, paymentMethodId: pmId })
      onSuccess(result)
    } catch (err) {
      onError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <h3 className="font-semibold text-charcoal dark:text-white mb-1">Card Details</h3>
      <p className="text-sm text-warm-gray dark:text-gray-300 mb-4">
        Saving card for {customerName}. The card will not be charged now.
      </p>
      <div className="p-4 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700">
        <CardElement
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#1a1a2e',
                '::placeholder': { color: '#8c8c9e' },
              },
            },
          }}
        />
      </div>
      <Button
        type="submit"
        className="w-full"
        size="lg"
        icon={<CreditCard size={20} />}
        loading={submitting}
        disabled={!stripe || submitting}
      >
        Save Card & Continue
      </Button>
    </form>
  )
}

// ── Appointment Type Options ──

const APPOINTMENT_TYPES = ['New Patient', 'Returning Patient']

const DURATION_OPTIONS = [
  { label: '15 min', value: 15 },
  { label: '30 min', value: 30 },
  { label: '45 min', value: 45 },
  { label: '60 min', value: 60 },
]

// ── Main Page ──

export default function ScheduleAppointment() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()

  // Step tracking
  const [step, setStep] = useState<'patient' | 'card' | 'details'>('patient')

  // Patient selection
  const [patientSearch, setPatientSearch] = useState('')
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null)
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [newFirstName, setNewFirstName] = useState('')
  const [newLastName, setNewLastName] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [creatingPatient, setCreatingPatient] = useState(false)

  // Load patients for search
  const { data: patients = [], isLoading: patientsLoading } = useQuery({
    queryKey: ['patients'],
    queryFn: listAllPatients,
    staleTime: 60_000,
  })

  const filteredPatients = patientSearch.trim().length >= 2
    ? patients.filter((p) => {
        const q = patientSearch.toLowerCase()
        const name = `${p.firstName} ${p.lastName}`.toLowerCase()
        return name.includes(q) || p.phone.includes(q) || (p.email || '').toLowerCase().includes(q)
      })
    : []

  // Stripe card collection
  const [stripeCustomerId, setStripeCustomerId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [creatingIntent, setCreatingIntent] = useState(false)
  const [savedCard, setSavedCard] = useState<ConfirmSetupResponse | null>(null)

  // Appointment details
  const [apptType, setApptType] = useState('New Patient')
  const [apptDate, setApptDate] = useState('')
  const [apptTime, setApptTime] = useState('09:00')
  const [apptDuration, setApptDuration] = useState(30)
  const [apptNotes, setApptNotes] = useState('')
  const [noShowAcknowledged, setNoShowAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  // Set default date to tomorrow
  useEffect(() => {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    setApptDate(tomorrow.toISOString().slice(0, 10))
  }, [])

  // ── Patient Actions ──

  const handleSelectPatient = (p: Patient) => {
    setSelectedPatient(p)
    setPatientSearch('')
  }

  const handleCreatePatient = async () => {
    if (!newFirstName.trim() || !newLastName.trim() || !newPhone.trim()) {
      toast('error', 'First name, last name, and phone are required')
      return
    }
    setCreatingPatient(true)
    try {
      const req: CreatePatientRequest = {
        firstName: newFirstName.trim(),
        lastName: newLastName.trim(),
        phone: newPhone.trim(),
        email: newEmail.trim() || undefined,
      }
      const patient = await createPatient(req)
      setSelectedPatient(patient)
      setShowNewPatient(false)
      queryClient.invalidateQueries({ queryKey: ['patients'] })
      toast('success', `Patient ${patient.firstName} ${patient.lastName} created`)
    } catch (err) {
      toast('error', `Failed to create patient: ${(err as Error).message}`)
    } finally {
      setCreatingPatient(false)
    }
  }

  const handlePatientContinue = () => {
    if (!selectedPatient) {
      toast('error', 'Please select or create a patient first')
      return
    }
    setStep('card')
    // Try to find existing Stripe customer
    startStripeSearch()
  }

  // ── Stripe Card Actions ──

  const [stripeSearching, setStripeSearching] = useState(false)
  const [stripeResults, setStripeResults] = useState<StripeCustomer[]>([])
  const [stripeSearchDone, setStripeSearchDone] = useState(false)

  const startStripeSearch = async () => {
    if (!selectedPatient) return
    setStripeSearching(true)
    setStripeSearchDone(false)
    try {
      const name = `${selectedPatient.firstName} ${selectedPatient.lastName}`
      const res = await searchCustomers(name)
      setStripeResults(res.customers || [])
      if (res.customers?.length === 1) {
        const c = res.customers[0]
        if (c.defaultPaymentMethod) {
          // Already has a card — skip card collection
          setStripeCustomerId(c.id)
          setSavedCard({
            customerId: c.id,
            paymentMethod: c.defaultPaymentMethod,
          })
          setStep('details')
          setStripeSearchDone(true)
          return
        }
      }
    } catch {
      // Ignore — will show manual options
    } finally {
      setStripeSearching(false)
      setStripeSearchDone(true)
    }
  }

  const handleStartSetup = async (existingCustomerId?: string) => {
    if (!selectedPatient) return
    setCreatingIntent(true)
    try {
      if (existingCustomerId) {
        const res = await createSetupIntent({ customerId: existingCustomerId })
        setStripeCustomerId(res.customerId)
        setClientSecret(res.clientSecret)
      } else {
        const name = `${selectedPatient.firstName} ${selectedPatient.lastName}`
        const res = await createSetupIntent({
          name,
          email: selectedPatient.email || undefined,
          phone: selectedPatient.phone || undefined,
        })
        setStripeCustomerId(res.customerId)
        setClientSecret(res.clientSecret)
      }
    } catch (err) {
      toast('error', `Setup failed: ${(err as Error).message}`)
    } finally {
      setCreatingIntent(false)
    }
  }

  const handleCardSuccess = (result: ConfirmSetupResponse) => {
    setSavedCard(result)
    toast('success', 'Card saved successfully!')
    setStep('details')
  }

  const handleCardSkip = () => {
    // Allow proceeding without card if desired
    setStep('details')
  }

  // ── Submit Appointment ──

  const handleSubmitAppointment = async () => {
    if (!selectedPatient) return
    if (!apptDate || !apptTime) {
      toast('error', 'Please select a date and time')
      return
    }
    if (!noShowAcknowledged) {
      toast('error', 'Please confirm you told the patient about the $30 no-show fee')
      return
    }

    setSubmitting(true)
    try {
      const startTime = `${apptDate}T${apptTime}:00-05:00`
      const endDate = new Date(`${apptDate}T${apptTime}:00`)
      endDate.setMinutes(endDate.getMinutes() + apptDuration)
      const endHours = String(endDate.getHours()).padStart(2, '0')
      const endMins = String(endDate.getMinutes()).padStart(2, '0')
      const endTime = `${apptDate}T${endHours}:${endMins}:00-05:00`

      await createAppointment({
        patientName: `${selectedPatient.firstName} ${selectedPatient.lastName}`,
        patientPhone: selectedPatient.phone,
        patientEmail: selectedPatient.email || undefined,
        type: apptType,
        startTime,
        endTime,
        notes: apptNotes || undefined,
      })

      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['appointments-upcoming'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Appointment scheduled successfully!')
      navigate('/appointments')
    } catch (err) {
      toast('error', `Failed to schedule: ${(err as Error).message}`)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Render ──

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/appointments')}
          className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors"
        >
          <ArrowLeft size={20} className="text-warm-gray" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-charcoal dark:text-white">Schedule Appointment</h1>
          <p className="text-warm-gray dark:text-gray-300 text-sm mt-1">
            {step === 'patient' && 'Step 1: Select or create patient'}
            {step === 'card' && 'Step 2: Collect credit card'}
            {step === 'details' && 'Step 3: Appointment details'}
          </p>
        </div>
      </div>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-6">
        {['patient', 'card', 'details'].map((s, i) => (
          <div key={s} className="flex items-center gap-2">
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ${
                step === s
                  ? 'bg-slate-blue text-white'
                  : ['patient', 'card', 'details'].indexOf(step) > i
                    ? 'bg-green-500 text-white'
                    : 'bg-light-gray dark:bg-gray-600 text-warm-gray'
              }`}
            >
              {['patient', 'card', 'details'].indexOf(step) > i ? (
                <CheckCircle size={16} />
              ) : (
                i + 1
              )}
            </div>
            {i < 2 && <div className="w-8 h-px bg-light-gray dark:bg-gray-600" />}
          </div>
        ))}
      </div>

      <div className="max-w-lg">
        {/* ── Step 1: Patient Selection ── */}
        {step === 'patient' && (
          <div className="space-y-4">
            {selectedPatient ? (
              <Card>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-charcoal dark:text-white">
                      {selectedPatient.firstName} {selectedPatient.lastName}
                    </p>
                    <p className="text-sm text-warm-gray dark:text-gray-300">{selectedPatient.phone}</p>
                    {selectedPatient.email && (
                      <p className="text-sm text-warm-gray dark:text-gray-300">{selectedPatient.email}</p>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedPatient(null)}>
                      Change
                    </Button>
                    <Button size="sm" onClick={handlePatientContinue}>
                      Continue
                    </Button>
                  </div>
                </div>
              </Card>
            ) : (
              <>
                <Card>
                  <h3 className="font-semibold text-charcoal dark:text-white mb-3">Find Existing Patient</h3>
                  {patientsLoading ? (
                    <LoadingSpinner />
                  ) : (
                    <div>
                      <div className="flex gap-2 mb-3">
                        <div className="flex-1">
                          <Input
                            placeholder="Search by name, phone, or email..."
                            value={patientSearch}
                            onChange={(e) => setPatientSearch(e.target.value)}
                          />
                        </div>
                        <div className="flex items-end">
                          <Search size={20} className="text-warm-gray mb-2" />
                        </div>
                      </div>
                      {filteredPatients.length > 0 && (
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {filteredPatients.slice(0, 10).map((p) => (
                            <button
                              key={p.id}
                              onClick={() => handleSelectPatient(p)}
                              className="w-full text-left p-3 rounded-lg border border-light-gray dark:border-gray-600 hover:bg-light-gray dark:hover:bg-gray-700 transition-colors"
                            >
                              <p className="font-medium text-charcoal dark:text-white">
                                {p.firstName} {p.lastName}
                              </p>
                              <p className="text-sm text-warm-gray dark:text-gray-300">
                                {p.phone}
                                {p.email && ` · ${p.email}`}
                              </p>
                            </button>
                          ))}
                        </div>
                      )}
                      {patientSearch.trim().length >= 2 && filteredPatients.length === 0 && (
                        <p className="text-sm text-warm-gray dark:text-gray-400 py-2">
                          No patients found. Create a new patient below.
                        </p>
                      )}
                    </div>
                  )}
                </Card>

                <Card>
                  {!showNewPatient ? (
                    <button
                      onClick={() => setShowNewPatient(true)}
                      className="w-full flex items-center gap-2 text-slate-blue hover:text-slate-blue/80 font-medium transition-colors"
                    >
                      <Plus size={18} />
                      New Patient
                    </button>
                  ) : (
                    <div className="space-y-3">
                      <h3 className="font-semibold text-charcoal dark:text-white">New Patient</h3>
                      <Input
                        label="First Name"
                        placeholder="Jane"
                        value={newFirstName}
                        onChange={(e) => setNewFirstName(e.target.value)}
                      />
                      <Input
                        label="Last Name"
                        placeholder="Doe"
                        value={newLastName}
                        onChange={(e) => setNewLastName(e.target.value)}
                      />
                      <Input
                        label="Phone"
                        type="tel"
                        placeholder="+1 555-123-4567"
                        value={newPhone}
                        onChange={(e) => setNewPhone(e.target.value)}
                      />
                      <Input
                        label="Email (optional)"
                        type="email"
                        placeholder="jane@example.com"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                      />
                      <div className="flex gap-2 pt-1">
                        <Button size="sm" variant="ghost" onClick={() => setShowNewPatient(false)}>
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          icon={<Plus size={16} />}
                          loading={creatingPatient}
                          onClick={handleCreatePatient}
                        >
                          Create & Select
                        </Button>
                      </div>
                    </div>
                  )}
                </Card>
              </>
            )}
          </div>
        )}

        {/* ── Step 2: Credit Card Collection ── */}
        {step === 'card' && (
          <div className="space-y-4">
            {stripeSearching && (
              <Card>
                <div className="flex items-center gap-3 py-2">
                  <LoadingSpinner />
                  <span className="text-sm text-warm-gray dark:text-gray-300">Checking for existing card on file...</span>
                </div>
              </Card>
            )}

            {!stripeSearching && stripeSearchDone && !clientSecret && !savedCard && (
              <>
                {stripeResults.length > 0 ? (
                  <Card>
                    <h3 className="font-semibold text-charcoal dark:text-white mb-3">Existing Stripe Customers</h3>
                    <div className="space-y-2">
                      {stripeResults.map((c) => (
                        <div
                          key={c.id}
                          className="p-3 rounded-lg border border-light-gray dark:border-gray-600"
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-medium text-charcoal dark:text-white">{c.name || 'No Name'}</p>
                              <p className="text-sm text-warm-gray dark:text-gray-300">{c.email}</p>
                              {c.defaultPaymentMethod && (
                                <p className="text-xs text-green-600 mt-1">
                                  Card on file: ****{c.defaultPaymentMethod.last4}
                                </p>
                              )}
                            </div>
                            <Button
                              size="sm"
                              icon={<CreditCard size={14} />}
                              loading={creatingIntent}
                              onClick={() => {
                                if (c.defaultPaymentMethod) {
                                  setStripeCustomerId(c.id)
                                  setSavedCard({
                                    customerId: c.id,
                                    paymentMethod: c.defaultPaymentMethod,
                                  })
                                  setStep('details')
                                } else {
                                  handleStartSetup(c.id)
                                }
                              }}
                            >
                              {c.defaultPaymentMethod ? 'Use Card' : 'Add Card'}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </Card>
                ) : null}

                <Card>
                  <Button
                    className="w-full"
                    icon={<CreditCard size={18} />}
                    loading={creatingIntent}
                    onClick={() => handleStartSetup()}
                  >
                    {stripeResults.length > 0 ? 'Add New Card Instead' : 'Collect Credit Card'}
                  </Button>
                </Card>

                <Button
                  variant="ghost"
                  className="w-full"
                  onClick={handleCardSkip}
                >
                  Skip — No card on file
                </Button>
              </>
            )}

            {clientSecret && !savedCard && (
              <Card>
                <Elements stripe={stripePromise} options={{ clientSecret }}>
                  <CardForm
                    clientSecret={clientSecret}
                    customerId={stripeCustomerId}
                    customerName={
                      selectedPatient
                        ? `${selectedPatient.firstName} ${selectedPatient.lastName}`
                        : ''
                    }
                    onSuccess={handleCardSuccess}
                    onError={(msg) => toast('error', msg)}
                  />
                </Elements>
              </Card>
            )}

            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft size={14} />}
              onClick={() => {
                setStep('patient')
                setClientSecret('')
                setStripeResults([])
                setStripeSearchDone(false)
              }}
            >
              Back to patient
            </Button>
          </div>
        )}

        {/* ── Step 3: Appointment Details ── */}
        {step === 'details' && (
          <div className="space-y-4">
            {/* Card on file summary */}
            {savedCard && (
              <Card>
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-green-50 dark:bg-green-900/30 flex items-center justify-center">
                    <CreditCard className="w-5 h-5 text-green-600" />
                  </div>
                  <div>
                    <p className="font-medium text-charcoal dark:text-white">
                      Card on file: ****{savedCard.paymentMethod.last4}
                    </p>
                    <p className="text-sm text-warm-gray dark:text-gray-300">
                      {selectedPatient?.firstName} {selectedPatient?.lastName}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Appointment type */}
            <Card>
              <h3 className="font-semibold text-charcoal dark:text-white mb-3">Appointment Type</h3>
              <div className="flex gap-2">
                {APPOINTMENT_TYPES.map((t) => (
                  <button
                    key={t}
                    onClick={() => setApptType(t)}
                    className={`flex-1 py-2 px-3 rounded-lg border text-sm font-medium transition-colors ${
                      apptType === t
                        ? 'border-slate-blue bg-slate-blue/10 text-slate-blue'
                        : 'border-light-gray dark:border-gray-600 text-warm-gray hover:bg-light-gray dark:hover:bg-gray-700'
                    }`}
                  >
                    {t}
                  </button>
                ))}
              </div>
            </Card>

            {/* Date and time */}
            <Card>
              <h3 className="font-semibold text-charcoal dark:text-white mb-3">Date & Time</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-charcoal dark:text-gray-200 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={apptDate}
                    onChange={(e) => setApptDate(e.target.value)}
                    className="w-full px-3 py-2 border border-light-gray dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-charcoal dark:text-gray-200 mb-1">
                    Time
                  </label>
                  <input
                    type="time"
                    value={apptTime}
                    onChange={(e) => setApptTime(e.target.value)}
                    className="w-full px-3 py-2 border border-light-gray dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white"
                  />
                </div>
              </div>
              <div className="mt-3">
                <label className="block text-sm font-medium text-charcoal dark:text-gray-200 mb-1">
                  Duration
                </label>
                <div className="flex gap-2">
                  {DURATION_OPTIONS.map((d) => (
                    <button
                      key={d.value}
                      onClick={() => setApptDuration(d.value)}
                      className={`flex-1 py-2 px-2 rounded-lg border text-sm transition-colors ${
                        apptDuration === d.value
                          ? 'border-slate-blue bg-slate-blue/10 text-slate-blue font-medium'
                          : 'border-light-gray dark:border-gray-600 text-warm-gray hover:bg-light-gray dark:hover:bg-gray-700'
                      }`}
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            </Card>

            {/* Notes */}
            <Card>
              <h3 className="font-semibold text-charcoal dark:text-white mb-3">Notes (optional)</h3>
              <textarea
                value={apptNotes}
                onChange={(e) => setApptNotes(e.target.value)}
                placeholder="Any notes about this appointment..."
                className="w-full px-3 py-2 border border-light-gray dark:border-gray-600 rounded-lg text-sm bg-white dark:bg-gray-700 dark:text-white resize-none"
                rows={3}
              />
            </Card>

            {/* No-show fee acknowledgment */}
            <Card>
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={noShowAcknowledged}
                  onChange={(e) => setNoShowAcknowledged(e.target.checked)}
                  className="mt-1 w-5 h-5 rounded border-light-gray text-slate-blue focus:ring-slate-blue"
                />
                <div>
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={16} className="text-amber-500" />
                    <span className="font-semibold text-charcoal dark:text-white">No-Show Fee Acknowledgment</span>
                  </div>
                  <p className="text-sm text-warm-gray dark:text-gray-300 mt-1">
                    Did you tell the customer there is a <strong>$30 no-show fee</strong>?
                  </p>
                </div>
              </label>
            </Card>

            {/* Submit */}
            <Button
              className="w-full"
              size="lg"
              icon={<Calendar size={20} />}
              loading={submitting}
              disabled={!noShowAcknowledged || submitting}
              onClick={handleSubmitAppointment}
            >
              Schedule Appointment
            </Button>

            <Button
              variant="ghost"
              size="sm"
              icon={<ArrowLeft size={14} />}
              onClick={() => setStep('card')}
            >
              Back to card
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
