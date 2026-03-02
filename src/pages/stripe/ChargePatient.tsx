import { useState } from 'react'
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
import { useToast } from '../../components/ui/Toast'

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

export default function ChargePatient() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()

  const preselectedId = searchParams.get('customerId') || ''
  const preselectedName = searchParams.get('name') || ''

  const [customerId, setCustomerId] = useState(preselectedId)
  const [customerName, setCustomerName] = useState(preselectedName)
  const [selectedPackage, setSelectedPackage] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<StripeCustomer[]>([])
  const [searching, setSearching] = useState(false)

  const packageOptions = [
    { value: '', label: 'Select a service...' },
    ...SERVICE_PACKAGES.map((p) => ({
      value: p.id,
      label: `${p.name} — ${formatCents(p.price)}`,
    })),
    { value: 'custom', label: 'Custom Amount' },
  ]

  const selectedPkg = SERVICE_PACKAGES.find((p) => p.id === selectedPackage)
  const amount =
    selectedPackage === 'custom'
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
          <h2 className="text-2xl font-bold text-charcoal mb-2">Payment Successful</h2>
          <p className="text-warm-gray mb-1">
            {formatCents(chargeMutation.data.amount)} charged to {customerName}
          </p>
          <p className="text-sm text-warm-gray mb-6">
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
        <button onClick={() => navigate('/billing')} className="p-2 rounded-lg hover:bg-light-gray transition-colors">
          <ArrowLeft size={20} className="text-warm-gray" />
        </button>
        <h1 className="text-2xl font-bold text-charcoal">Charge Patient</h1>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Customer selection */}
        <Card>
          <h3 className="font-semibold text-charcoal mb-3">Patient</h3>
          {customerId ? (
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-charcoal">{customerName}</p>
                <p className="text-sm text-warm-gray">{customerId}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setCustomerId('')
                  setCustomerName('')
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
                      className="w-full text-left p-3 rounded-lg border border-light-gray hover:bg-light-gray transition-colors"
                    >
                      <p className="font-medium text-charcoal">{c.name || 'No Name'}</p>
                      <p className="text-sm text-warm-gray">{c.email}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Service selection */}
        <Card>
          <h3 className="font-semibold text-charcoal mb-3">Service</h3>
          <Select
            options={packageOptions}
            value={selectedPackage}
            onChange={(e) => setSelectedPackage(e.target.value)}
          />
          {selectedPackage === 'custom' && (
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
              <span className="text-2xl font-bold text-charcoal">{formatCents(amount)}</span>
            </div>
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
