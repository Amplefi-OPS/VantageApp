import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList,
  Check,
  Calendar,
  MessageSquare,
  UserCircle,
  ChevronDown,
  ChevronUp,
  DollarSign,
  User,
  UserPlus,
  ExternalLink,
} from 'lucide-react'
import { listTodos, updateTodo, listAllPatients } from '../api/endpoints'
import { listAllEmrPatients } from '../api/emr'
import type { Todo } from '../api/types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Tabs } from '../components/ui/Tabs'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { useToast } from '../components/ui/Toast'
import { cn, formatDateTime, isOverdue, isToday } from '../lib/utils'
import { getSettings } from '../lib/settings'

const typeBadge: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray'> = {
  Schedule: 'blue',
  Refill: 'green',
  CallBack: 'yellow',
  SendDocs: 'red',
  General: 'gray',
}

const typeLabel: Record<string, string> = {
  Schedule: 'Schedule',
  Refill: 'Refill',
  CallBack: 'Call Back',
  SendDocs: 'Send Docs',
  General: 'General',
}

const priorityBadge: Record<string, 'red' | 'yellow' | 'gray'> = {
  High: 'red',
  Med: 'yellow',
  Low: 'gray',
}

export default function Todos() {
  const navigate = useNavigate()
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('all')
  const [staffFilter, setStaffFilter] = useState('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [confirmDoneId, setConfirmDoneId] = useState<string | null>(null)
  const settings = getSettings()

  const { data: todos, isLoading, isError, error } = useQuery({
    queryKey: ['todos'],
    queryFn: listTodos,
    staleTime: 0,
  })

  // Debug: log to console if query fails or returns unexpected data
  if (isError) console.error('[Todos] Query error:', error)
  if (todos) console.log('[Todos] Loaded', todos.length, 'todos')

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: listAllPatients,
  })

  // EMR patients are the going-forward roster; attach flows stamp EMR IDs on
  // new TODOs, so we need to resolve names against both tables during
  // migration. Legacy TODOs carry VantageApp IDs; resolved via `patients`.
  const { data: emrPatients } = useQuery({
    queryKey: ['emr-patients-all'],
    queryFn: listAllEmrPatients,
    staleTime: 5 * 60_000,
  })

  const updateMutation = useMutation({
    mutationFn: updateTodo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
    },
    onError: () => toast('error', 'Failed to update. Please try again.'),
  })

  const handleMarkDone = () => {
    if (!confirmDoneId) return
    updateMutation.mutate(
      { id: confirmDoneId, status: 'Done' },
      {
        onSuccess: () => {
          toast('success', 'Marked as done!')
          setConfirmDoneId(null)
        },
      },
    )
  }

  const getPatientName = (patientId?: string) => {
    if (!patientId) return null
    const va = patients?.find((p) => p.id === patientId)
    if (va) return `${va.firstName} ${va.lastName}`
    const emr = emrPatients?.find((p) => p.patient_id === patientId)
    if (emr) return `${emr.first_name} ${emr.last_name}`
    return null
  }

  const today = new Date().toISOString().slice(0, 10)

  const filtered = todos?.filter((t) => {
    // Staff filter
    if (staffFilter && t.assignedTo !== staffFilter) return false

    switch (tab) {
      case 'today':
        return t.status === 'Open' && isToday(t.dueDate)
      case 'overdue':
        return t.status === 'Open' && isOverdue(t.dueDate)
      case 'done':
        return t.status === 'Done'
      case 'open':
        return t.status === 'Open'
      default:
        return true
    }
  })

  // Sort: open first, then by priority (High > Med > Low), then by date
  const sorted = [...(filtered || [])].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'Open' ? -1 : 1
    const prioOrder = { High: 0, Med: 1, Low: 2 }
    const pa = prioOrder[a.priority as keyof typeof prioOrder] ?? 2
    const pb = prioOrder[b.priority as keyof typeof prioOrder] ?? 2
    if (pa !== pb) return pa - pb
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  })

  const openCount = todos?.filter((t) => t.status === 'Open').length ?? 0
  const todayCount =
    todos?.filter((t) => t.status === 'Open' && isToday(t.dueDate)).length ?? 0
  const overdueCount =
    todos?.filter((t) => t.status === 'Open' && isOverdue(t.dueDate)).length ?? 0
  const doneCount = todos?.filter((t) => t.status === 'Done').length ?? 0

  if (isLoading) return <LoadingSpinner />
  if (isError) return (
    <div className="text-center py-12">
      <p className="text-warm-gray dark:text-gray-400 mb-2">Failed to load to-dos.</p>
      <p className="text-xs text-red-400 font-mono mb-4">{error instanceof Error ? error.message : 'Unknown error'}</p>
      <button onClick={() => window.location.reload()} className="text-sm text-slate-blue underline">Refresh</button>
    </div>
  )

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-charcoal dark:text-white">To-Do List</h1>
        <div className="flex items-center gap-2">
          <span className="text-sm text-warm-gray dark:text-gray-400">My To-Do:</span>
          <select
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
            className="text-sm px-3 py-1.5 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-charcoal dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-blue"
          >
            <option value="">All</option>
            {settings.staffList.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
      </div>

      <Tabs
        tabs={[
          { key: 'all', label: 'All', count: todos?.length },
          { key: 'open', label: 'Open', count: openCount },
          { key: 'today', label: 'Today', count: todayCount },
          { key: 'overdue', label: 'Overdue', count: overdueCount },
          { key: 'done', label: 'Done', count: doneCount },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4 space-y-3">
        {sorted?.length === 0 && (
          <EmptyState
            icon={<ClipboardList size={48} />}
            title={
              tab === 'done'
                ? 'No completed to-dos yet'
                : tab === 'overdue'
                  ? 'No overdue to-dos!'
                  : tab === 'today'
                    ? 'Nothing due today'
                    : 'No to-dos yet'
            }
            description={
              tab === 'overdue'
                ? "You're all caught up. Great work!"
                : "To-dos will appear here when voicemails are attached to patients."
            }
          />
        )}

        {sorted?.map((todo) => {
          const expanded = expandedId === todo.id
          return (
            <Card key={todo.id} className="hover:shadow-sm transition-shadow">
              <div className="flex items-start gap-3">
                {/* Done checkbox */}
                {todo.status === 'Open' ? (
                  <button
                    onClick={() => setConfirmDoneId(todo.id)}
                    className="mt-0.5 w-6 h-6 rounded-md border-2 border-light-gray dark:border-gray-600 hover:border-slate-blue transition-colors shrink-0 flex items-center justify-center"
                    aria-label={`Mark "${todo.title}" as done`}
                  />
                ) : (
                  <div className="mt-0.5 w-6 h-6 rounded-md bg-green-100 text-green-600 flex items-center justify-center shrink-0">
                    <Check size={16} />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <p
                    className={cn(
                      'font-medium',
                      todo.status === 'Done' && 'line-through text-warm-gray',
                    )}
                  >
                    {todo.title}
                  </p>

                  <div className="flex items-center gap-2 flex-wrap mt-1.5">
                    <Badge variant={typeBadge[todo.type]}>{typeLabel[todo.type]}</Badge>
                    <Badge variant={priorityBadge[todo.priority]}>{todo.priority}</Badge>
                    {todo.patientId && (
                      <span className="text-xs text-warm-gray dark:text-gray-300">
                        {getPatientName(todo.patientId)}
                      </span>
                    )}
                  </div>

                  {todo.dueDate && (
                    <p
                      className={cn(
                        'text-xs mt-1 flex items-center gap-1',
                        isOverdue(todo.dueDate)
                          ? 'text-red-600 font-medium'
                          : 'text-warm-gray',
                      )}
                    >
                      <Calendar size={12} />
                      Due: {new Date(todo.dueDate).toLocaleDateString()}
                      {isOverdue(todo.dueDate) && ' (Overdue)'}
                    </p>
                  )}

                  {todo.status === 'Open' && (
                    <div className="mt-2 flex gap-2 flex-wrap">
                      {todo.title.toLowerCase().includes('no-show fee') && todo.patientId && (
                        <Button
                          size="sm"
                          variant="danger"
                          icon={<DollarSign size={14} />}
                          onClick={() => navigate(`/patients/${todo.patientId}?tab=billing`)}
                        >
                          Charge $30 Fee
                        </Button>
                      )}
                      {todo.patientId && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={<ExternalLink size={14} />}
                          onClick={() => navigate(`/patients/${todo.patientId}`)}
                        >
                          Go to Patient Record
                        </Button>
                      )}
                      {!todo.patientId && (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={<UserPlus size={14} />}
                          onClick={() => navigate('/patients?new=1')}
                        >
                          New Patient
                        </Button>
                      )}
                    </div>
                  )}

                  {todo.notes && (
                    <p className="text-sm text-warm-gray dark:text-gray-300 mt-1">
                      <MessageSquare size={12} className="inline mr-1" />
                      {todo.notes}
                    </p>
                  )}

                  {todo.assignedTo && (
                    <p className="text-xs text-warm-gray dark:text-gray-300 mt-1 flex items-center gap-1">
                      <UserCircle size={12} />
                      {todo.assignedTo}
                    </p>
                  )}

                  {/* Expanded actions */}
                  {expanded && todo.status === 'Open' && (
                    <div className="mt-4 pt-4 border-t border-light-gray dark:border-gray-700 space-y-3">
                      <Input
                        label="Add a note"
                        placeholder="Type a note..."
                        defaultValue={todo.notes || ''}
                        onBlur={(e) => {
                          if (e.target.value !== (todo.notes || '')) {
                            updateMutation.mutate({ id: todo.id, notes: e.target.value })
                          }
                        }}
                      />
                      <Select
                        label="Assign to"
                        options={settings.staffList.map((s) => ({ value: s, label: s }))}
                        value={todo.assignedTo || ''}
                        onChange={(e) =>
                          updateMutation.mutate({ id: todo.id, assignedTo: e.target.value })
                        }
                        placeholder="Select staff..."
                      />
                      <Input
                        label="Due date"
                        type="date"
                        defaultValue={todo.dueDate?.slice(0, 10) || ''}
                        onBlur={(e) => {
                          if (e.target.value) {
                            updateMutation.mutate({
                              id: todo.id,
                              dueDate: new Date(e.target.value).toISOString(),
                            })
                          }
                        }}
                      />
                      <Select
                        label="Priority"
                        options={[
                          { value: 'High', label: 'High' },
                          { value: 'Med', label: 'Medium' },
                          { value: 'Low', label: 'Low' },
                        ]}
                        value={todo.priority}
                        onChange={(e) =>
                          updateMutation.mutate({
                            id: todo.id,
                            priority: e.target.value as 'High' | 'Med' | 'Low',
                          })
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Expand toggle */}
                {todo.status === 'Open' && (
                  <button
                    onClick={() => setExpandedId(expanded ? null : todo.id)}
                    className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors shrink-0"
                    aria-label={expanded ? 'Collapse' : 'Expand'}
                  >
                    {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                  </button>
                )}
              </div>
            </Card>
          )
        })}
      </div>

      {/* Confirm done */}
      <ConfirmDialog
        open={!!confirmDoneId}
        onClose={() => setConfirmDoneId(null)}
        onConfirm={handleMarkDone}
        title="Mark as done?"
        message="This to-do will be moved to the completed list."
        confirmLabel="Mark Done"
        loading={updateMutation.isPending}
      />
    </div>
  )
}
