import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { Elements, CardElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { CreditCard, CheckCircle, ArrowLeft, Search, Plus } from 'lucide-react'
import stripePromise from '../../lib/stripe'
import { createSetupIntent, confirmSetup, searchCustomers } from '../../api/stripe-endpoints'
import type { StripeCustomer, ConfirmSetupResponse } from '../../api/stripe-types'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/Toast'

function formatCardBrand(brand: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'Amex',
    discover: 'Discover',
  }
  return brands[brand.toLowerCase()] || brand
}

// ── Card Form (rendered inside <Elements>) ──────────────

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
      <Card>
        <h3 className="font-semibold text-charcoal dark:text-white mb-1">Card Details</h3>
        <p className="text-sm text-warm-gray dark:text-gray-300 mb-4">
          Saving card for {customerName}. The card will not be charged.
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
      </Card>
      <Button
        type="submit"
        className="w-full"
        size="lg"
        icon={<CreditCard size={20} />}
        loading={submitting}
        disabled={!stripe || submitting}
      >
        Save Card
      </Button>
    </form>
  )
}

// ── Main AddCard Page ───────────────────────────────────

export default function AddCard() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()

  const preselectedId = searchParams.get('customerId') || ''
  const preselectedName = searchParams.get('name') || ''

  // Stage 1: Customer selection
  const [customerId, setCustomerId] = useState(preselectedId)
  const [customerName, setCustomerName] = useState(preselectedName)
  const [customerSearch, setCustomerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<StripeCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const [autoSearching, setAutoSearching] = useState(!!preselectedName && !preselectedId)

  // New patient fields
  const [showNewPatient, setShowNewPatient] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPhone, setNewPhone] = useState('')

  // Stage 2: Card collection
  const [clientSecret, setClientSecret] = useState('')
  const [creatingIntent, setCreatingIntent] = useState(false)

  // Stage 3: Success
  const [savedCard, setSavedCard] = useState<ConfirmSetupResponse | null>(null)

  // Auto-search when arriving with name param
  useEffect(() => {
    if (!preselectedName || preselectedId) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await searchCustomers(preselectedName)
        if (cancelled) return
        if (res.customers && res.customers.length > 0) {
          const match = res.customers[0]
          setCustomerId(match.id)
          setCustomerName(match.name || match.email)
        } else {
          setCustomerSearch(preselectedName)
        }
      } catch {
        if (!cancelled) setCustomerSearch(preselectedName)
      } finally {
        if (!cancelled) setAutoSearching(false)
      }
    })()
    return () => { cancelled = true }
  }, [preselectedName, preselectedId])

  const handleCustomerSearch = async () => {
    if (customerSearch.trim().length < 2) return
    setSearching(true)
    try {
      const res = await searchCustomers(customerSearch.trim())
      setSearchResults(res.customers || [])
    } catch {
      toast('error', 'Customer search failed')
    } finally {
      setSearching(false)
    }
  }

  const selectCustomer = (c: StripeCustomer) => {
    setCustomerId(c.id)
    setCustomerName(c.name || c.email)
    setSearchResults([])
    setCustomerSearch('')
  }

  const handleStartSetup = async (existingCustomerId?: string) => {
    setCreatingIntent(true)
    try {
      if (existingCustomerId) {
        const res = await createSetupIntent({ customerId: existingCustomerId })
        setCustomerId(res.customerId)
        setClientSecret(res.clientSecret)
      } else {
        // Creating new customer
        if (!newName.trim()) {
          toast('error', 'Patient name is required')
          setCreatingIntent(false)
          return
        }
        const res = await createSetupIntent({
          name: newName.trim(),
          email: newEmail.trim() || undefined,
          phone: newPhone.trim() || undefined,
        })
        setCustomerId(res.customerId)
        setCustomerName(newName.trim())
        setClientSecret(res.clientSecret)
      }
    } catch (err) {
      toast('error', `Setup failed: ${(err as Error).message}`)
    } finally {
      setCreatingIntent(false)
    }
  }

  const handleSuccess = (result: ConfirmSetupResponse) => {
    setSavedCard(result)
    toast('success', 'Card saved successfully!')
  }

  const handleCardError = (msg: string) => {
    toast('error', msg)
  }

  const resetAll = () => {
    setCustomerId('')
    setCustomerName('')
    setClientSecret('')
    setSavedCard(null)
    setShowNewPatient(false)
    setNewName('')
    setNewEmail('')
    setNewPhone('')
  }

  // ── Stage 3: Success ──
  if (savedCard) {
    const pm = savedCard.paymentMethod
    return (
      <div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="inline-flex p-4 rounded-full bg-green-50 text-green-600 mb-4">
            <CheckCircle size={48} />
          </div>
          <h2 className="text-2xl font-bold text-charcoal dark:text-white mb-2">Card Saved Successfully</h2>
          <p className="text-warm-gray dark:text-gray-300 mb-1">
            {formatCardBrand(pm.brand)} ending in {pm.last4}
          </p>
          <p className="text-sm text-warm-gray dark:text-gray-300 mb-6">
            Expires {String(pm.expMonth).padStart(2, '0')}/{pm.expYear} &middot; {customerName}
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate('/billing')}>
              Back to Billing
            </Button>
            <Button onClick={resetAll}>
              Add Another Card
            </Button>
          </div>
        </div>
      </div>
    )
  }

  // ── Stage 2: Collect card ──
  if (clientSecret) {
    return (
      <div>
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => { setClientSecret('') }} className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors">
            <ArrowLeft size={20} className="text-warm-gray" />
          </button>
          <h1 className="text-2xl font-bold text-charcoal dark:text-white">Add Card on File</h1>
        </div>
        <div className="max-w-lg">
          <Elements stripe={stripePromise} options={{ clientSecret }}>
            <CardForm
              clientSecret={clientSecret}
              customerId={customerId}
              customerName={customerName}
              onSuccess={handleSuccess}
              onError={handleCardError}
            />
          </Elements>
        </div>
      </div>
    )
  }

  // ── Stage 1: Select or create customer ──
  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/billing')} className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors">
          <ArrowLeft size={20} className="text-warm-gray" />
        </button>
        <h1 className="text-2xl font-bold text-charcoal dark:text-white">Add Card on File</h1>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Existing customer search */}
        <Card>
          <h3 className="font-semibold text-charcoal dark:text-white mb-3">Find Existing Patient</h3>
          {autoSearching ? (
            <div className="flex items-center gap-3 py-2">
              <LoadingSpinner />
              <span className="text-sm text-warm-gray dark:text-gray-300">Finding patient...</span>
            </div>
          ) : customerId ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-charcoal dark:text-white">{customerName}</p>
                <p className="text-sm text-warm-gray dark:text-gray-300">{customerId}</p>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setCustomerId(''); setCustomerName('') }}
                >
                  Change
                </Button>
                <Button
                  size="sm"
                  icon={<CreditCard size={16} />}
                  loading={creatingIntent}
                  onClick={() => handleStartSetup(customerId)}
                >
                  Continue
                </Button>
              </div>
            </div>
          ) : (
            <div>
              <div className="flex gap-2 mb-3">
                <div className="flex-1">
                  <Input
                    placeholder="Search by name or email..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), handleCustomerSearch())}
                  />
                </div>
                <Button
                  size="sm"
                  icon={<Search size={16} />}
                  loading={searching}
                  onClick={handleCustomerSearch}
                >
                  Find
                </Button>
              </div>
              {searchResults.length > 0 && (
                <div className="space-y-2">
                  {searchResults.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => selectCustomer(c)}
                      className="w-full text-left p-3 rounded-lg border border-light-gray dark:border-gray-600 hover:bg-light-gray dark:hover:bg-gray-700 transition-colors"
                    >
                      <p className="font-medium text-charcoal dark:text-white">{c.name || 'No Name'}</p>
                      <p className="text-sm text-warm-gray dark:text-gray-300">{c.email}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* New patient */}
        {!customerId && (
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
                  label="Name"
                  placeholder="Jane Doe"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <Input
                  label="Email"
                  type="email"
                  placeholder="jane@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                />
                <Input
                  label="Phone (optional)"
                  type="tel"
                  placeholder="+1 555-123-4567"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                />
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowNewPatient(false)}
                  >
                    Cancel
                  </Button>
                  <Button
                    size="sm"
                    icon={<CreditCard size={16} />}
                    loading={creatingIntent}
                    onClick={() => handleStartSetup()}
                  >
                    Continue
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
