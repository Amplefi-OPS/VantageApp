import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Phone,
  ClipboardList,
  Users,
  Send,
  Settings,
  AlertTriangle,
  Mail,
} from 'lucide-react'
import { getDashboardCounts, listVoicemails, listEmails } from '../api/endpoints'
import type { Email } from '../api/types'
import { Card } from '../components/ui/Card'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { PulseStrip } from '../components/PulseStrip'
import { EmailAttachModal } from '../components/EmailAttachModal'

export default function Dashboard() {
  const navigate = useNavigate()
  const [attachEmail, setAttachEmail] = useState<Email | null>(null)

  const { data: counts, isLoading, isError, error } = useQuery({
    queryKey: ['dashboard-counts'],
    queryFn: getDashboardCounts,
    staleTime: 0,
    refetchInterval: 30000,
  })

  const { data: voicemails } = useQuery({
    queryKey: ['voicemails'],
    queryFn: listVoicemails,
    refetchInterval: 30000,
  })

  const { data: emails } = useQuery({
    queryKey: ['emails', 'Unmatched'],
    queryFn: () => listEmails('Unmatched'),
    refetchInterval: 60000,
  })

  if (isLoading) return <LoadingSpinner />
  if (isError) return (
    <div className="text-center py-12">
      <p className="text-warm-gray dark:text-gray-400 mb-2">Failed to load dashboard.</p>
      <p className="text-xs text-red-400 font-mono mb-4">{error instanceof Error ? error.message : 'Unknown error'}</p>
      <button onClick={() => window.location.reload()} className="text-sm text-slate-blue underline">Refresh</button>
    </div>
  )

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
      count: counts == null ? undefined : (counts.openTodos ?? 0),
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

      {/* Weekly workload pulse — Mon–Fri */}
      <PulseStrip />

      {/* Unmatched emails strip */}
      {emails && emails.length > 0 && (
        <Card className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Mail size={18} className="text-slate-blue" />
              <h2 className="text-base font-semibold text-charcoal dark:text-white">
                Unmatched emails
              </h2>
              <span className="text-xs text-warm-gray dark:text-gray-300">
                {emails.length}
              </span>
            </div>
          </div>
          <ul className="divide-y divide-light-gray dark:divide-gray-700">
            {emails.slice(0, 8).map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setAttachEmail(e)}
                  className="w-full text-left py-2.5 px-1 flex items-start gap-3 hover:bg-light-gray/50 dark:hover:bg-gray-700/40 rounded-md transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-medium text-charcoal dark:text-white truncate">
                        {e.fromName || e.from}
                      </p>
                      <span className="text-xs text-warm-gray dark:text-gray-400 shrink-0">
                        {new Date(e.receivedAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                    </div>
                    <p className="text-sm text-charcoal dark:text-gray-200 truncate">
                      {e.subject}
                    </p>
                    <p className="text-xs text-warm-gray dark:text-gray-400 truncate">
                      {e.snippet}
                    </p>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <EmailAttachModal
        email={attachEmail}
        onClose={() => setAttachEmail(null)}
      />

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
