import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, Search, User, UserPlus, Play, Pause, Archive } from 'lucide-react'
import { listVoicemails, listPatients, attachVoicemail, archiveVoicemail, createPatient } from '../api/endpoints'
import type { Voicemail, Patient } from '../api/types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Tabs } from '../components/ui/Tabs'
import { useToast } from '../components/ui/Toast'
import { formatDateTime, formatDuration, timeAgo } from '../lib/utils'

const categoryBadge: Record<string, 'blue' | 'green' | 'yellow' | 'gray'> = {
  Scheduling: 'blue',
  Refills: 'green',
  'Basic Questions': 'yellow',
  'Everything Else': 'gray',
}

function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false)
  const [audioEl] = useState(() => {
    if (typeof Audio !== 'undefined') return new Audio(url)
    return null
  })

  const toggle = () => {
    if (!audioEl) return
    if (playing) {
      audioEl.pause()
    } else {
      audioEl.play().catch(() => {})
    }
    setPlaying(!playing)
  }

  return (
    <button
      onClick={toggle}
      className="p-2 rounded-full bg-slate-blue/10 text-slate-blue hover:bg-slate-blue/20 transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center"
      aria-label={playing ? 'Pause' : 'Play'}
    >
      {playing ? <Pause size={18} /> : <Play size={18} />}
    </button>
  )
}

export default function Voicemails() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('all')
  const [attachModal, setAttachModal] = useState<Voicemail | null>(null)
  const [attachMode, setAttachMode] = useState<'existing' | 'new'>('existing')
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedPatientId, setSelectedPatientId] = useState('')
  const [newPatient, setNewPatient] = useState({ firstName: '', lastName: '', phone: '' })

  const { data: voicemails, isLoading } = useQuery({
    queryKey: ['voicemails'],
    queryFn: listVoicemails,
  })

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: listPatients,
  })

  const attachMutation = useMutation({
    mutationFn: attachVoicemail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voicemails'] })
      queryClient.invalidateQueries({ queryKey: ['todos'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      setAttachModal(null)
      toast('success', 'Voicemail attached and to-do created!')
    },
    onError: () => toast('error', 'Failed to attach voicemail. Please try again.'),
  })

  const createPatientMutation = useMutation({
    mutationFn: createPatient,
    onSuccess: (patient) => {
      queryClient.invalidateQueries({ queryKey: ['patients'] })
      if (attachModal) {
        attachMutation.mutate({
          voicemailId: attachModal.id,
          patientId: patient.id,
          isNewPatient: true,
        })
      }
    },
    onError: () => toast('error', 'Failed to create patient. Please try again.'),
  })

  const archiveMutation = useMutation({
    mutationFn: archiveVoicemail,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['voicemails'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Voicemail archived!')
    },
    onError: () => toast('error', 'Failed to archive voicemail. Please try again.'),
  })

  const filtered = voicemails?.filter((vm) => {
    if (tab === 'unattached') return vm.attachedTo.type === 'none' && vm.status !== 'Archived'
    if (tab === 'attached') return vm.attachedTo.type !== 'none' && vm.status !== 'Archived'
    if (tab === 'archived') return vm.status === 'Archived'
    return vm.status !== 'Archived'
  })

  const unattachedCount = voicemails?.filter((v) => v.attachedTo.type === 'none' && v.status !== 'Archived').length ?? 0
  const attachedCount = voicemails?.filter((v) => v.attachedTo.type !== 'none' && v.status !== 'Archived').length ?? 0
  const archivedCount = voicemails?.filter((v) => v.status === 'Archived').length ?? 0
  const activeCount = (voicemails?.length ?? 0) - archivedCount

  const filteredPatients = patients?.filter((p) => {
    const q = searchQuery.toLowerCase()
    return (
      p.firstName.toLowerCase().includes(q) ||
      p.lastName.toLowerCase().includes(q) ||
      p.phone.includes(q)
    )
  })

  const handleAttach = () => {
    if (!attachModal) return
    if (attachMode === 'existing' && selectedPatientId) {
      attachMutation.mutate({
        voicemailId: attachModal.id,
        patientId: selectedPatientId,
        isNewPatient: false,
      })
    } else if (attachMode === 'new' && newPatient.firstName && newPatient.lastName) {
      createPatientMutation.mutate(newPatient)
    }
  }

  const openAttachModal = (vm: Voicemail) => {
    setAttachModal(vm)
    setAttachMode('existing')
    setSearchQuery('')
    setSelectedPatientId('')
    setNewPatient({ firstName: '', lastName: '', phone: '' })
  }

  const getPatientName = (vm: Voicemail) => {
    if (vm.attachedTo.patientId && patients) {
      const p = patients.find((p) => p.id === vm.attachedTo.patientId)
      if (p) return `${p.firstName} ${p.lastName}`
    }
    return null
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal dark:text-white mb-6">Voicemails</h1>

      <Tabs
        tabs={[
          { key: 'all', label: 'All', count: activeCount },
          { key: 'unattached', label: 'Unattached', count: unattachedCount },
          { key: 'attached', label: 'Attached', count: attachedCount },
          { key: 'archived', label: 'Archived', count: archivedCount },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4 space-y-3">
        {filtered?.length === 0 && (
          <EmptyState
            icon={<Phone size={48} />}
            title="No voicemails"
            description={
              tab === 'unattached'
                ? "All voicemails have been attached to patients. Nice work!"
                : "No voicemails yet. They'll appear here when patients call."
            }
          />
        )}

        {filtered?.map((vm) => (
          <Card key={vm.id} className="hover:shadow-sm transition-shadow">
            <div className="flex items-start gap-3">
              <AudioPlayer url={vm.audioUrl} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-charcoal dark:text-white truncate">
                    {vm.callerName || vm.callerNumber}
                  </span>
                  <Badge variant={categoryBadge[vm.category]}>{vm.category}</Badge>
                </div>
                {vm.callerName && (
                  <p className="text-sm text-warm-gray dark:text-gray-300">{vm.callerNumber}</p>
                )}
                <div className="flex items-center gap-3 mt-1 text-sm text-warm-gray dark:text-gray-300">
                  <span>{timeAgo(vm.receivedAt)}</span>
                  <span>{formatDuration(vm.durationSeconds)}</span>
                </div>

                {vm.attachedTo.type !== 'none' && (
                  <p className="text-sm text-green-700 mt-2 flex items-center gap-1">
                    <User size={14} />
                    Attached to {getPatientName(vm) || 'patient'}
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-2 shrink-0">
                {vm.attachedTo.type === 'none' && vm.status !== 'Archived' && (
                  <Button
                    size="sm"
                    onClick={() => openAttachModal(vm)}
                    icon={<UserPlus size={16} />}
                  >
                    Attach
                  </Button>
                )}
                {vm.status !== 'Archived' && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => archiveMutation.mutate(vm.id)}
                    icon={<Archive size={16} />}
                  >
                    Archive
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Attach to Patient Modal */}
      <Modal
        open={!!attachModal}
        onClose={() => setAttachModal(null)}
        title="Attach to Patient"
        size="md"
      >
        {attachModal && (
          <div>
            <p className="text-sm text-warm-gray dark:text-gray-300 mb-4">
              Voicemail from{' '}
              <strong>{attachModal.callerName || attachModal.callerNumber}</strong>{' '}
              ({formatDateTime(attachModal.receivedAt)})
            </p>

            {/* Toggle: Existing or New */}
            <div className="flex gap-2 mb-5">
              <Button
                variant={attachMode === 'existing' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setAttachMode('existing')}
                icon={<User size={16} />}
              >
                Existing Patient
              </Button>
              <Button
                variant={attachMode === 'new' ? 'primary' : 'ghost'}
                size="sm"
                onClick={() => setAttachMode('new')}
                icon={<UserPlus size={16} />}
              >
                New Patient
              </Button>
            </div>

            {attachMode === 'existing' ? (
              <div>
                <div className="relative mb-3">
                  <Search
                    size={18}
                    className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-gray"
                  />
                  <input
                    type="text"
                    placeholder="Search patients..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-3 rounded-lg border border-light-gray dark:border-gray-600 text-base bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-blue min-h-[48px]"
                  />
                </div>

                <div className="max-h-60 overflow-y-auto space-y-1 border border-light-gray rounded-lg">
                  {filteredPatients?.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => setSelectedPatientId(p.id)}
                      className={`w-full text-left px-4 py-3 transition-colors min-h-[48px] ${
                        selectedPatientId === p.id
                          ? 'bg-slate-blue/10 text-slate-blue'
                          : 'hover:bg-light-gray dark:hover:bg-gray-700'
                      }`}
                    >
                      <span className="font-medium">
                        {p.firstName} {p.lastName}
                      </span>
                      <span className="text-sm text-warm-gray dark:text-gray-300 ml-2">{p.phone}</span>
                    </button>
                  ))}
                  {filteredPatients?.length === 0 && (
                    <p className="px-4 py-3 text-warm-gray text-sm">
                      No patients found. Try a different search or add a new patient.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <Input
                  label="First Name"
                  value={newPatient.firstName}
                  onChange={(e) =>
                    setNewPatient({ ...newPatient, firstName: e.target.value })
                  }
                  placeholder="e.g. John"
                />
                <Input
                  label="Last Name"
                  value={newPatient.lastName}
                  onChange={(e) =>
                    setNewPatient({ ...newPatient, lastName: e.target.value })
                  }
                  placeholder="e.g. Smith"
                />
                <Input
                  label="Phone Number"
                  value={newPatient.phone}
                  onChange={(e) =>
                    setNewPatient({ ...newPatient, phone: e.target.value })
                  }
                  placeholder="(555) 000-0000"
                  type="tel"
                />
              </div>
            )}

            <div className="flex gap-3 justify-end mt-6">
              <Button variant="ghost" onClick={() => setAttachModal(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleAttach}
                loading={attachMutation.isPending || createPatientMutation.isPending}
                disabled={
                  attachMode === 'existing'
                    ? !selectedPatientId
                    : !newPatient.firstName || !newPatient.lastName
                }
              >
                {attachMode === 'new' ? 'Create & Attach' : 'Attach'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
