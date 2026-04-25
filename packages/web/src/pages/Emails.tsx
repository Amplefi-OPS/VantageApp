import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, Inbox, CheckCircle2, Archive } from 'lucide-react'
import { listEmails, archiveEmail } from '../api/endpoints'
import type { Email } from '../api/types'
import { Card } from '../components/ui/Card'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { useToast } from '../components/ui/Toast'
import { EmailAttachModal } from '../components/EmailAttachModal'

type Tab = 'Unmatched' | 'Attached' | 'all'

export default function Emails() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState<Tab>('Unmatched')
  const [attachEmail, setAttachEmail] = useState<Email | null>(null)

  const { data: emails, isLoading } = useQuery({
    queryKey: ['emails', tab],
    queryFn: () => listEmails(tab),
    refetchInterval: 60000,
  })

  const archiveMutation = useMutation({
    mutationFn: archiveEmail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emails'] })
      toast('success', 'Archived')
    },
    onError: () => toast('error', 'Failed to archive'),
  })

  if (isLoading) return <LoadingSpinner />

  const list = emails ?? []

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal dark:text-white mb-4">Emails</h1>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 text-sm">
        {([
          ['Unmatched', Inbox, 'Unmatched'],
          ['Attached', CheckCircle2, 'Attached'],
          ['all', Mail, 'All'],
        ] as const).map(([key, Icon, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-colors ${
              tab === key
                ? 'bg-slate-blue text-white'
                : 'bg-light-gray dark:bg-gray-700 text-warm-gray hover:bg-slate-blue/10'
            }`}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      {list.length === 0 ? (
        <Card>
          <p className="text-center text-warm-gray dark:text-gray-300 py-6 italic">
            No emails in this view.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-light-gray dark:divide-gray-700">
            {list.map((e) => (
              <li key={e.id} className="flex items-stretch hover:bg-light-gray/50 dark:hover:bg-gray-700/40 transition-colors">
                <button
                  onClick={() => e.status === 'Unmatched' && setAttachEmail(e)}
                  disabled={e.status !== 'Unmatched'}
                  className="flex-1 text-left px-4 py-3 flex items-start gap-3 disabled:cursor-default"
                >
                  <Mail size={18} className="text-slate-blue mt-0.5 shrink-0" />
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
                    <p className="text-xs text-warm-gray dark:text-gray-400 truncate mt-0.5">
                      {e.snippet}
                    </p>
                    {e.status === 'Attached' && (
                      <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                        Attached to to-do {e.attachedTodoId}
                        {e.assignedTo ? ` · assigned to ${e.assignedTo}` : ''}
                      </p>
                    )}
                    {e.status === 'Archived' && (
                      <p className="text-xs text-warm-gray dark:text-gray-500 mt-1">Archived</p>
                    )}
                  </div>
                </button>
                {e.status !== 'Archived' && (
                  <button
                    onClick={(ev) => {
                      ev.stopPropagation()
                      archiveMutation.mutate(e.id)
                    }}
                    title="Archive"
                    className="px-3 text-warm-gray hover:text-charcoal dark:hover:text-white transition-colors"
                  >
                    <Archive size={18} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <EmailAttachModal
        email={attachEmail}
        onClose={() => setAttachEmail(null)}
      />
    </div>
  )
}
