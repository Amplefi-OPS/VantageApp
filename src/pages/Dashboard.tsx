import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Phone,
  ClipboardList,
  Users,
  Send,
  Settings,
  AlertTriangle,
} from 'lucide-react'
import { getDashboardCounts } from '../api/endpoints'
import { Card } from '../components/ui/Card'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: counts, isLoading } = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: getDashboardCounts,
    refetchInterval: 30000,
  })

  if (isLoading) return <LoadingSpinner />

  const tiles = [
    {
      label: 'Voicemails',
      icon: Phone,
      count: counts?.unattachedVoicemails,
      countLabel: 'unattached',
      color: 'bg-blue-50 text-blue-700',
      path: '/voicemails',
    },
    {
      label: 'To-Do List',
      icon: ClipboardList,
      count: counts?.openTodos,
      countLabel: 'open',
      color: 'bg-amber-50 text-amber-700',
      path: '/todos',
    },
    {
      label: 'Patients',
      icon: Users,
      count: counts?.totalPatients,
      countLabel: 'total',
      color: 'bg-green-50 text-green-700',
      path: '/patients',
    },
    {
      label: 'Fax',
      icon: Send,
      count: undefined,
      countLabel: '',
      color: 'bg-purple-50 text-purple-700',
      path: '/fax',
    },
    {
      label: 'Settings',
      icon: Settings,
      count: undefined,
      countLabel: '',
      color: 'bg-gray-50 text-gray-600',
      path: '/settings',
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal mb-6">Good morning</h1>

      {/* Alert: overdue todos */}
      {counts && counts.overdueTodos > 0 && (
        <Card
          className="mb-6 border-amber-200 bg-amber-50 cursor-pointer hover:bg-amber-100 transition-colors"
          onClick={() => navigate('/todos')}
        >
          <div className="flex items-center gap-3">
            <AlertTriangle size={24} className="text-amber-600 shrink-0" />
            <div>
              <p className="font-semibold text-amber-800">
                {counts.overdueTodos} overdue to-do{counts.overdueTodos > 1 ? 's' : ''}
              </p>
              <p className="text-sm text-amber-700">Tap to review and update</p>
            </div>
          </div>
        </Card>
      )}

      {/* Dashboard tiles */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <button
            key={tile.label}
            onClick={() => navigate(tile.path)}
            className="text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-blue rounded-xl"
          >
            <Card className="h-full hover:shadow-md transition-shadow">
              <div className={`inline-flex p-3 rounded-xl ${tile.color} mb-3`}>
                <tile.icon size={28} />
              </div>
              <h2 className="text-base font-semibold text-charcoal mb-1">{tile.label}</h2>
              {tile.count !== undefined && (
                <p className="text-2xl font-bold text-charcoal">
                  {tile.count}
                  <span className="text-sm font-normal text-warm-gray ml-1.5">
                    {tile.countLabel}
                  </span>
                </p>
              )}
            </Card>
          </button>
        ))}
      </div>
    </div>
  )
}
