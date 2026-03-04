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
import { getDashboardCounts, listVoicemails } from '../api/endpoints'
import { Card } from '../components/ui/Card'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'

export default function Dashboard() {
  const navigate = useNavigate()
  const { data: counts, isLoading, isError } = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: getDashboardCounts,
    refetchInterval: 30000,
    retry: 1,
  })

  const { data: voicemails } = useQuery({
    queryKey: ['voicemails'],
    queryFn: listVoicemails,
    refetchInterval: 30000,
    retry: 1,
  })

  if (isLoading) return <LoadingSpinner />
  if (isError) return <div className="text-center py-12 text-warm-gray dark:text-gray-400">Failed to load dashboard. Please refresh.</div>

  const tiles = [
    {
      label: 'Voicemails',
      icon: Phone,
      count: voicemails?.filter((v) => v.status !== 'Reviewed' && v.status !== 'Archived').length,
      countLabel: 'new',
      color: 'bg-blue-50 text-blue-700 dark:bg-blue-500/20 dark:text-blue-300',
      path: '/voicemails',
    },
    {
      label: 'To-Do List',
      icon: ClipboardList,
      count: counts?.openTodos,
      countLabel: 'open',
      color: 'bg-amber-50 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300',
      path: '/todos',
    },
    {
      label: 'Patients',
      icon: Users,
      count: counts?.totalPatients,
      countLabel: 'total',
      color: 'bg-green-50 text-green-700 dark:bg-green-500/20 dark:text-green-300',
      path: '/patients',
    },
    {
      label: 'Fax',
      icon: Send,
      count: undefined,
      countLabel: '',
      color: 'bg-purple-50 text-purple-700 dark:bg-purple-500/20 dark:text-purple-300',
      path: '/fax',
    },
    {
      label: 'Settings',
      icon: Settings,
      count: undefined,
      countLabel: '',
      color: 'bg-gray-50 text-gray-600 dark:bg-gray-600/30 dark:text-gray-300',
      path: '/settings',
    },
  ]

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal dark:text-white mb-6">Good morning</h1>

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
              <h2 className="text-base font-semibold text-charcoal dark:text-white mb-1">{tile.label}</h2>
              {tile.count !== undefined && (
                <p className="text-2xl font-bold text-charcoal dark:text-white">
                  {tile.count}
                  <span className="text-sm font-normal text-warm-gray dark:text-gray-300 ml-1.5">
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
