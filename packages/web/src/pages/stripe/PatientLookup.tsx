import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Search, CreditCard, UserX, User } from 'lucide-react'
import { searchCustomers } from '../../api/stripe-endpoints'
import { Input } from '../../components/ui/Input'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { EmptyState } from '../../components/ui/EmptyState'

export default function PatientLookup() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['stripe-customers', query],
    queryFn: () => searchCustomers(query),
    enabled: query.length >= 2,
  })

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setQuery(search.trim())
  }

  const customers = data?.customers || []

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal dark:text-white mb-6">Patient Lookup</h1>

      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <div className="flex-1">
          <Input
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" icon={<Search size={18} />} loading={isFetching}>
          Search
        </Button>
      </form>

      {isLoading && query ? (
        <LoadingSpinner />
      ) : customers.length > 0 ? (
        <div className="space-y-3">
          {customers.map((customer) => (
            <Card key={customer.id} className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-charcoal dark:text-white">{customer.name || 'No Name'}</p>
                <p className="text-sm text-warm-gray dark:text-gray-300">{customer.email}</p>
                {customer.phone && (
                  <p className="text-sm text-warm-gray dark:text-gray-300">{customer.phone}</p>
                )}
                {customer.defaultPaymentMethod && (
                  <p className="text-sm text-warm-gray dark:text-gray-300 mt-1">
                    {customer.defaultPaymentMethod.brand.toUpperCase()} ****
                    {customer.defaultPaymentMethod.last4} &middot; Exp{' '}
                    {customer.defaultPaymentMethod.expMonth}/{customer.defaultPaymentMethod.expYear}
                  </p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm"
                  icon={<CreditCard size={16} />}
                  onClick={() => navigate(`/billing?search=${encodeURIComponent(customer.name || customer.email || '')}`)}
                >
                  Charge
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  icon={<UserX size={16} />}
                  onClick={() => navigate(`/billing?search=${encodeURIComponent(customer.name || customer.email || '')}`)}
                >
                  No-Show
                </Button>
              </div>
            </Card>
          ))}
        </div>
      ) : query.length >= 2 && !isLoading ? (
        <EmptyState
          icon={<User size={48} />}
          title="No customers found"
          description={`No results for "${query}". Try a different name or email.`}
        />
      ) : (
        <EmptyState
          icon={<Search size={48} />}
          title="Search for a patient"
          description="Enter a name or email to find their Stripe billing profile."
        />
      )}
    </div>
  )
}
