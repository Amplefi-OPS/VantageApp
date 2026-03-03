import { useState, useEffect } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import { UserX, CheckCircle, ArrowLeft, Search } from 'lucide-react'
import { chargeNoShow, searchCustomers } from '../../api/stripe-endpoints'
import type { StripeCustomer } from '../../api/stripe-types'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { TextArea } from '../../components/ui/Input'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/Toast'

export default function NoShowFee() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const { toast } = useToast()

  const preselectedId = searchParams.get('customerId') || ''
  const preselectedName = searchParams.get('name') || ''

  const [customerId, setCustomerId] = useState(preselectedId)
  const [customerName, setCustomerName] = useState(preselectedName)
  const [reason, setReason] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<StripeCustomer[]>([])
  const [searching, setSearching] = useState(false)
  const [autoSearching, setAutoSearching] = useState(!!preselectedName && !preselectedId)

  // Auto-search Stripe by name when arriving from a todo
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

  const noShowMutation = useMutation({
    mutationFn: () =>
      chargeNoShow({
        customerId,
        reason: reason.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast('success', `$30.00 no-show fee charged to ${customerName}`)
    },
    onError: (err) => {
      toast('error', `No-show charge failed: ${(err as Error).message}`)
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

  if (noShowMutation.isSuccess) {
    return (
      <div>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="inline-flex p-4 rounded-full bg-green-50 text-green-600 mb-4">
            <CheckCircle size={48} />
          </div>
          <h2 className="text-2xl font-bold text-charcoal mb-2">No-Show Fee Charged</h2>
          <p className="text-warm-gray mb-1">$30.00 charged to {customerName}</p>
          <p className="text-sm text-warm-gray mb-6">
            Payment ID: {noShowMutation.data.id}
          </p>
          <div className="flex gap-3">
            <Button variant="ghost" onClick={() => navigate('/billing')}>
              Back to Billing
            </Button>
            <Button onClick={() => {
              noShowMutation.reset()
              setReason('')
              setCustomerId('')
              setCustomerName('')
            }}>
              Charge Another
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
        <h1 className="text-2xl font-bold text-charcoal">No-Show Fee</h1>
      </div>

      <div className="max-w-lg space-y-6">
        {/* Customer selection */}
        <Card>
          <h3 className="font-semibold text-charcoal mb-3">Patient</h3>
          {autoSearching ? (
            <div className="flex items-center gap-3 py-2">
              <LoadingSpinner />
              <span className="text-sm text-warm-gray">Finding patient...</span>
            </div>
          ) : customerId ? (
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

        {/* Reason */}
        <Card>
          <TextArea
            label="Reason (optional)"
            placeholder="e.g., Patient did not show up for scheduled appointment..."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Card>

        {/* Charge card */}
        <Card className="bg-red-50/50 border-red-200">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="inline-flex p-2.5 rounded-xl bg-red-100 text-red-600">
                <UserX size={24} />
              </div>
              <div>
                <p className="font-semibold text-charcoal">No-Show Fee</p>
                <p className="text-sm text-warm-gray">Flat rate charge</p>
              </div>
            </div>
            <span className="text-2xl font-bold text-charcoal">$30.00</span>
          </div>
          <Button
            className="w-full"
            size="lg"
            variant="danger"
            icon={<UserX size={20} />}
            loading={noShowMutation.isPending}
            disabled={!customerId || noShowMutation.isPending}
            onClick={() => noShowMutation.mutate()}
          >
            Charge $30.00 No-Show Fee
          </Button>
          {noShowMutation.isError && (
            <p className="text-sm text-red-500 mt-3">
              {(noShowMutation.error as Error).message}
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
