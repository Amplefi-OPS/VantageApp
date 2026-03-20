import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { CreditCard, CheckCircle, ArrowLeft, Search } from 'lucide-react'
import { createPaymentIntent, searchCustomers } from '../../api/stripe-endpoints'
import { SERVICE_PACKAGES } from '../../api/stripe-types'
import type { StripeCustomer } from '../../api/stripe-types'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Select } from '../../components/ui/Select'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/Toast'

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatCardBrand(brand: string): string {
  const brands: Record<string, string> = {
    visa: 'Visa',
    mastercard: 'Mastercard',
    amex: 'Amex',
    discover: 'Discover',
  }
  return brands[brand.toLowerCase()] || brand
}

export default function ChargePatient() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()

  const preselectedId = searchParams.get('customerId') || ''
  const preselectedName = searchParams.get('name') || ''

  const [customerId, setCustomerId] = useState(preselectedId)
  const [customerName, setCustomerName] = useState(preselectedName)
  const [customer, setCustomer] = useState<StripeCustomer | null>(null)
  const [selectedPackage, setSelectedPackage] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<StripeCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const [autoSearching, setAutoSearching] = useState(!!preselectedName && !preselectedId)

  // Auto-search Stripe by name when arriving from an appointment
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
          setCustomer(match)
        } else {
          // No match — pre-fill manual search with name
          setCustomerSearch(preselectedName)
        }
      } catch {
        // Auto-search failed — pre-fill manual search with name
        if (!cancelled) setCustomerSearch(preselectedName)
      } finally {
        if (!cancelled) setAutoSearching(false)
      }
    })()
    return () => { cancelled = true }
  }, [preselectedName, preselectedId])

  const packageOptions = [
    { value: '', label: 'Select a service...' },
    ...SERVICE_PACKAGES.map((p) => ({
      value: p.id,
      label: p.price > 0 ? `${p.name} — ${formatCents(p.price)}` : `${p.name} — Custom`,
    })),
    { value: 'custom', label: 'Custom Amount' },
  ]

  const selectedPkg = SERVICE_PACKAGES.find((p) => p.id === selectedPackage)
  const needsCustomAmount = selectedPackage === 'custom' || (selectedPkg && selectedPkg.price === 0)
  const amount = needsCustomAmount
    ? Math.round(parseFloat(customAmount || '0') * 100)
    : selectedPkg?.price || 0
  const description =
    selectedPackage === 'custom'
      ? 'Custom Charge'
      : selectedPkg?.name || ''

  const chargeMutation = useMutation({
    mutationFn: () =>
      createPaymentIntent({
        customerId,
        amount,
        description,
      }),
    onSuccess: (result) => {
      toast('success', `Payment of ${formatCents(result.amount)} processed successfully!`)
    },
    onError: (err) => {
      toast('error', `Charge failed: ${(err as Error).message}`)
    },
  })

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
    setCustomer(c)
    setSearchResults([])
    setCustomerSearch('')
  }

  const canCharge = customerId && amount > 0 && !chargeMutation.isPending

  if (chargeMutation.isSuccess) {
    return (
      <div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="inline-flex p-4 rounded-full bg-green-50 text-green-600 mb-4">
            <CheckCircle size={48} />
          </div>
          <h2 className="text-2xl font-bold text-charcoal dark:text-white mb-2">Payment Successful</h2>
          <p className="text-warm-gray mb-1">
            {formatCents(chargeMutation.data.amount)} charged to {customerName}
          </p>
          <p className="text-sm text-warm-gray dark:text-gray-300 mb-6">
            Payment ID: {chargeMutation.data.id}
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate('/billing')}>
              Back to Billing
            </Button>
            <Button onClick={() => {
              chargeMutation.reset()
              setSelectedPackage('')
              setCustomAmount('')
            }}>
              Charge Again
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/billing')} className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors">
          <ArrowLeft size={20} className="text-warm-gray" />
        </button>
        <h1 className="text-2xl font-bold text-charcoal dark:text-white">Charge Patient</h1>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Customer selection */}
        <Card>
          <h3 className="font-semibold text-charcoal dark:text-white mb-3">Patient</h3>
          {autoSearching ? (
            <div className="flex items-center gap-3 py-2">
              <LoadingSpinner />
              <span className="text-sm text-warm-gray dark:text-gray-300">Finding patient...</span>
            </div>
          ) : customerId ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-charcoal dark:text-white">{customerName}</p>
                {customer?.defaultPaymentMethod ? (
                  <p className="text-sm text-warm-gray dark:text-gray-300">
                    {formatCardBrand(customer.defaultPaymentMethod.brand)} ending in {customer.defaultPaymentMethod.last4}
                    {' '}&middot;{' '}
                    {String(customer.defaultPaymentMethod.expMonth).padStart(2, '0')}/{customer.defaultPaymentMethod.expYear}
                  </p>
                ) : (
                  <p className="text-sm text-warm-gray dark:text-gray-300">No card on file</p>
                )}
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCustomerId('')
                  setCustomerName('')
                  setCustomer(null)
                }}
              >
                Change
              </Button>
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
                      className="w-full text-left p-3 rounded-lg border border-light-gray dark:border-gray-600 hover:bg-light-gray dark:hover:bg-gray-700 dark:hover:bg-gray-700 transition-colors"
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

        {/* Service selection */}
        <Card>
          <h3 className="font-semibold text-charcoal dark:text-white mb-3">Service</h3>
          <Select
            options={packageOptions}
            value={selectedPackage}
            onChange={(e) => setSelectedPackage(e.target.value)}
          />
          {needsCustomAmount && (
            <div className="mt-3">
              <Input
                label="Amount ($)"
                type="number"
                min="0.50"
                step="0.01"
                placeholder="0.00"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
              />
            </div>
          )}
        </Card>

        {/* Charge summary */}
        {amount > 0 && (
          <Card className="bg-slate-blue/5 border-slate-blue/20">
            <div className="flex items-center justify-between mb-4">
              <span className="text-warm-gray">Amount</span>
              <span className="text-2xl font-bold text-charcoal dark:text-white">{formatCents(amount)}</span>
            </div>
            {customer?.defaultPaymentMethod && (
              <p className="text-sm text-warm-gray dark:text-gray-300 mb-3">
                Charging {formatCardBrand(customer.defaultPaymentMethod.brand)} ending in {customer.defaultPaymentMethod.last4}
              </p>
            )}
            <Button
              className="w-full"
              size="lg"
              icon={<CreditCard size={20} />}
              loading={chargeMutation.isPending}
              disabled={!canCharge}
              onClick={() => chargeMutation.mutate()}
            >
              Charge {formatCents(amount)}
            </Button>
            {chargeMutation.isError && (
              <p className="text-sm text-red-500 mt-3">
                {(chargeMutation.error as Error).message}
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
