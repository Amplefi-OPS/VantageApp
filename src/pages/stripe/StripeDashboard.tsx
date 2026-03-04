import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  DollarSign,
  CheckCircle,
  XCircle,
  UserX,
  Search,
  CreditCard,
} from 'lucide-react'
import { listTransactions } from '../../api/stripe-endpoints'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { EmptyState } from '../../components/ui/EmptyState'

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`
}

function formatDate(unix: number): string {
  return new Date(unix * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

const statusBadge: Record<string, { label: string; variant: 'green' | 'red' | 'yellow' | 'gray' }> = {
  succeeded: { label: 'Succeeded', variant: 'green' },
  failed: { label: 'Failed', variant: 'red' },
  requires_payment_method: { label: 'Needs Payment', variant: 'yellow' },
  canceled: { label: 'Canceled', variant: 'gray' },
}

export default function StripeDashboard() {
  const navigate = useNavigate()
  const { data, isLoading } = useQuery({
    queryKey: ['stripe-transactions'],
    queryFn: listTransactions,
    refetchInterval: 30000,
  })

  if (isLoading) return <LoadingSpinner />

  const transactions = data?.transactions || []
  const succeeded = transactions.filter((t) => t.status === 'succeeded')
  const failed = transactions.filter((t) => t.status === 'failed')
  const noShows = transactions.filter((t) => t.metadata?.type === 'no-show')

  const totalRevenue = succeeded.reduce((sum, t) => sum + t.amount, 0)

  const tiles = [
    {
      label: 'Total Revenue',
      value: formatCents(totalRevenue),
      icon: DollarSign,
      color: 'bg-green-50 text-green-700',
    },
    {
      label: 'Successful',
      value: String(succeeded.length),
      icon: CheckCircle,
      color: 'bg-blue-50 text-blue-700',
    },
    {
      label: 'Failed',
      value: String(failed.length),
      icon: XCircle,
      color: 'bg-red-50 text-red-700',
    },
    {
      label: 'No-Shows',
      value: String(noShows.length),
      icon: UserX,
      color: 'bg-amber-50 text-amber-700',
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-charcoal dark:text-gray-100">Billing</h1>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={<Search size={18} />}
            onClick={() => navigate('/billing/lookup')}
          >
            Lookup
          </Button>
          <Button
            size="sm"
            icon={<CreditCard size={18} />}
            onClick={() => navigate('/billing/charge')}
          >
            Charge
          </Button>
        </div>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
        {tiles.map((tile) => (
          <Card key={tile.label}>
            <div className={`inline-flex p-2.5 rounded-xl ${tile.color} mb-3`}>
              <tile.icon size={22} />
            </div>
            <p className="text-sm text-warm-gray dark:text-gray-400 mb-1">{tile.label}</p>
            <p className="text-xl font-bold text-charcoal dark:text-gray-100">{tile.value}</p>
          </Card>
        ))}
      </div>

      {/* Recent Transactions */}
      <h2 className="text-lg font-semibold text-charcoal dark:text-gray-100 mb-4">Recent Transactions</h2>

      {transactions.length === 0 ? (
        <EmptyState
          icon={<DollarSign size={48} />}
          title="No transactions yet"
          description="Charges will appear here once you process payments."
        />
      ) : (
        <div className="space-y-3">
          {transactions.slice(0, 50).map((tx) => {
            const badge = statusBadge[tx.status] || { label: tx.status, variant: 'gray' as const }
            return (
              <Card key={tx.id} className="flex items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-charcoal dark:text-gray-100 truncate">
                    {tx.customerName || tx.customerEmail || 'Unknown'}
                  </p>
                  <p className="text-sm text-warm-gray dark:text-gray-400 truncate">
                    {tx.description || 'Payment'} &middot; {formatDate(tx.created)}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  <span className="text-base font-semibold text-charcoal dark:text-gray-100">
                    {formatCents(tx.amount)}
                  </span>
                </div>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
