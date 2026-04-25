import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Mail, Search } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Button } from './ui/Button'
import { Select } from './ui/Select'
import { useToast } from './ui/Toast'
import { attachEmail, listTodos } from '../api/endpoints'
import type { Email, Todo } from '../api/types'
import { getSettings } from '../lib/settings'

interface Props {
  email: Email | null
  onClose: () => void
}

type Mode = 'create' | 'attach'

/** Best-guess todo type from the email subject. Falls back to General. */
function inferTodoType(subject: string): Todo['type'] {
  const s = subject.toLowerCase()
  if (/\b(refill|prescription|\brx\b|pharmacy|medication)\b/.test(s)) return 'Refill'
  if (/\b(schedule|appointment|reschedule|booking|book\b)\b/.test(s)) return 'Schedule'
  if (/\b(records|fax|send|forms?|paperwork)\b/.test(s)) return 'SendDocs'
  if (/\b(call ?back|callback|return call|please call)\b/.test(s)) return 'CallBack'
  return 'General'
}

export function EmailAttachModal({ email, onClose }: Props) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const settings = getSettings()
  const [mode, setMode] = useState<Mode>('create')
  const [title, setTitle] = useState('')
  const [assignee, setAssignee] = useState(settings.staffList[0] || '')
  const [priority, setPriority] = useState<'Low' | 'Med' | 'High'>('Med')
  const [type, setType] = useState<Todo['type']>('General')
  const [dueDate, setDueDate] = useState('')
  const [todoSearch, setTodoSearch] = useState('')
  const [selectedTodoId, setSelectedTodoId] = useState<string>('')

  useEffect(() => {
    if (email) {
      setMode('create')
      setTitle(email.subject || '')
      setAssignee(settings.staffList[0] || '')
      setPriority('Med')
      setType(inferTodoType(email.subject || ''))
      setDueDate('')
      setTodoSearch('')
      setSelectedTodoId('')
    }
  }, [email, settings.staffList])

  const { data: openTodos } = useQuery({
    queryKey: ['todos', 'open-for-attach'],
    queryFn: () => listTodos({ status: 'Open' }),
    enabled: !!email && mode === 'attach',
  })

  const filteredTodos = useMemo(() => {
    if (!openTodos) return []
    const q = todoSearch.trim().toLowerCase()
    if (!q) return openTodos.slice(0, 20)
    return openTodos.filter((t) => t.title.toLowerCase().includes(q)).slice(0, 20)
  }, [openTodos, todoSearch])

  const mutation = useMutation({
    mutationFn: attachEmail,
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['emails'] })
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast(
        'success',
        res.notified ? 'Attached — assignee notified by email.' : 'Attached.',
      )
      onClose()
    },
    onError: () => toast('error', 'Failed to attach email. Try again.'),
  })

  if (!email) return null

  const canSubmit =
    mode === 'create'
      ? title.trim().length > 0 && assignee.length > 0
      : selectedTodoId.length > 0

  const handleSubmit = () => {
    if (!email) return
    if (mode === 'create') {
      mutation.mutate({
        emailId: email.id,
        action: 'create',
        newTodo: {
          title: title.trim(),
          type,
          assignedTo: assignee,
          priority,
          dueDate: dueDate || undefined,
          notes: `From email: ${email.from} — "${email.subject}"`,
        },
      })
    } else {
      mutation.mutate({
        emailId: email.id,
        action: 'attach',
        todoId: selectedTodoId,
      })
    }
  }

  return (
    <Modal open={!!email} onClose={onClose} title="Match email to a to-do" size="lg">
      {/* Email header */}
      <div className="rounded-lg bg-light-gray/60 dark:bg-gray-700/40 p-3 mb-4">
        <div className="flex items-start gap-2">
          <Mail size={16} className="text-slate-blue mt-0.5 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-charcoal dark:text-white truncate">
              {email.fromName || email.from}
            </p>
            <p className="text-xs text-warm-gray dark:text-gray-300 truncate">{email.from}</p>
            <p className="text-sm text-charcoal dark:text-gray-100 mt-1">{email.subject}</p>
            <p className="text-xs text-warm-gray dark:text-gray-300 mt-1 line-clamp-2">
              {email.snippet}
            </p>
          </div>
        </div>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 mb-4 text-sm">
        {(['create', 'attach'] as Mode[]).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-3 py-1.5 rounded-md transition-colors ${
              mode === m
                ? 'bg-slate-blue text-white'
                : 'bg-light-gray dark:bg-gray-700 text-warm-gray hover:bg-slate-blue/10'
            }`}
          >
            {m === 'create' ? 'Create to-do' : 'Attach to existing'}
          </button>
        ))}
      </div>

      {mode === 'create' ? (
        <div className="space-y-3">
          <div>
            <label className="text-sm font-medium text-charcoal dark:text-white">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full px-3 py-2.5 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Assignee"
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              options={settings.staffList.map((s) => ({ value: s, label: s }))}
            />
            <Select
              label="Priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value as 'Low' | 'Med' | 'High')}
              options={[
                { value: 'Low', label: 'Low' },
                { value: 'Med', label: 'Med' },
                { value: 'High', label: 'High' },
              ]}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Type"
              value={type}
              onChange={(e) => setType(e.target.value as Todo['type'])}
              options={[
                { value: 'General', label: 'General' },
                { value: 'Schedule', label: 'Schedule' },
                { value: 'Refill', label: 'Refill' },
                { value: 'CallBack', label: 'Call back' },
                { value: 'SendDocs', label: 'Send docs' },
              ]}
            />
            <div>
              <label className="text-sm font-medium text-charcoal dark:text-white">Due date</label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="mt-1 w-full px-3 py-2.5 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-gray" />
            <input
              type="text"
              value={todoSearch}
              onChange={(e) => setTodoSearch(e.target.value)}
              placeholder="Search open to-dos…"
              className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue"
            />
          </div>
          <div className="max-h-72 overflow-y-auto space-y-1.5">
            {filteredTodos.length === 0 && (
              <p className="text-sm text-warm-gray italic p-3">No open to-dos.</p>
            )}
            {filteredTodos.map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTodoId(t.id)}
                className={`w-full text-left p-3 rounded-lg border transition-colors ${
                  selectedTodoId === t.id
                    ? 'border-slate-blue bg-slate-blue/5'
                    : 'border-light-gray dark:border-gray-600 hover:bg-light-gray/40 dark:hover:bg-gray-700/40'
                }`}
              >
                <p className="text-sm font-medium text-charcoal dark:text-white">{t.title}</p>
                <p className="text-xs text-warm-gray dark:text-gray-300">
                  {t.assignedTo || 'Unassigned'} · {t.priority} · {t.dueDate || 'no due date'}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={!canSubmit || mutation.isPending}
          onClick={handleSubmit}
        >
          {mutation.isPending ? 'Saving…' : mode === 'create' ? 'Create & assign' : 'Attach'}
        </Button>
      </div>
    </Modal>
  )
}
