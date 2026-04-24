import { useState, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Phone, Search, User, UserPlus, Play, Pause, Archive, FileText, Loader2, Check } from 'lucide-react'
import { listVoicemails, listAllPatients, attachVoicemail, archiveVoicemail, createPatient, transcribeVoicemail, getTranscriptionResult } from '../api/endpoints'
import { searchPatients as emrSearchPatients, type EmrPatient } from '../api/emr'
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

const categoryBadge: Record<string, 'blue' | 'green' | 'yellow' | 'red' | 'gray'> = {
  Scheduling: 'blue',
  Refills: 'green',
  Billing: 'yellow',
  'New Patient': 'red',
  'Basic Questions': 'gray',
  'Everything Else': 'gray',
}

function AudioPlayer({ url }: { url: string }) {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    setPlaying(false)
    setError(false)
    if (typeof Audio === 'undefined') return

    const audio = new Audio()
    audio.preload = 'none'

    const onEnded = () => setPlaying(false)
    const onError = () => {
      console.error('Audio playback error:', audio.error?.message, 'url:', url.slice(0, 100))
      setPlaying(false)
      setError(true)
    }

    audio.addEventListener('ended', onEnded)
    audio.addEventListener('error', onError)
    audio.src = url
    audioRef.current = audio

    return () => {
      audio.pause()
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('error', onError)
      audio.src = ''
      audioRef.current = null
    }
  }, [url])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (playing) {
      audio.pause()
      setPlaying(false)
    } else {
      setError(false)
      audio.play()
        .then(() => setPlaying(true))
        .catch((err) => {
          console.error('Audio play() failed:', err)
          setPlaying(false)
          setError(true)
        })
    }
  }

  return (
    <button
      onClick={toggle}
      className={`p-2 rounded-full transition-colors min-w-[40px] min-h-[40px] flex items-center justify-center ${
        error
          ? 'bg-red-100 text-red-500'
          : 'bg-slate-blue/10 text-slate-blue hover:bg-slate-blue/20'
      }`}
      aria-label={playing ? 'Pause' : error ? 'Playback error' : 'Play'}
      title={error ? 'Audio playback failed — try refreshing' : undefined}
    >
      {playing ? <Pause size={18} /> : <Play size={18} />}
    </button>
  )
}

function TranscriptDisplay({ vm, onTranscribed }: { vm: Voicemail; onTranscribed?: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [isTranscribing, setIsTranscribing] = useState(false)

  const isPending = vm.transcriptStatus === 'Pending' ||
    vm.transcriptionStatus === 'PENDING'
  const isInProgress = vm.transcriptStatus === 'Transcribing' ||
    vm.transcriptionStatus === 'IN_PROGRESS' ||
    isTranscribing

  if (isPending || isInProgress) {
    return (
      <div className="mt-2 flex items-center gap-2 text-sm text-warm-gray dark:text-gray-400" data-testid="transcribing-indicator">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500" />
        </span>
        <span>{isPending ? 'Queued for transcription\u2026' : 'Transcribing\u2026'}</span>
      </div>
    )
  }

  if (vm.transcriptStatus === 'Failed' || vm.transcriptionStatus === 'FAILED') {
    return (
      <div className="mt-2 text-sm text-red-500">
        Transcription failed
      </div>
    )
  }

  if (vm.transcript) {
    const truncated = vm.transcript.length > 200
    const displayText = expanded ? vm.transcript : vm.transcript.slice(0, 200)

    return (
      <div className="mt-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs font-medium text-slate-blue hover:underline flex items-center gap-1"
        >
          <FileText size={12} />
          {expanded ? 'Hide transcript' : 'Show transcript'}
        </button>
        {expanded && (
          <div className="mt-1.5 p-3 bg-light-gray dark:bg-gray-700 rounded-lg max-h-32 overflow-y-auto" data-testid="transcript-text">
            <p className="text-sm text-charcoal dark:text-gray-200 whitespace-pre-wrap">
              {displayText}
              {truncated && !expanded && '...'}
            </p>
          </div>
        )}
      </div>
    )
  }

  // No transcript, not in progress — show Transcribe button
  const handleTranscribe = async () => {
    setIsTranscribing(true)
    try {
      const { jobName } = await transcribeVoicemail(vm.id, vm.audioUrl)

      // Poll for result
      let attempts = 0
      const poll = async () => {
        if (attempts >= 40) {
          setIsTranscribing(false)
          return
        }
        attempts++
        const result = await getTranscriptionResult(jobName, vm.id)
        if (result.status === 'COMPLETED' || result.status === 'FAILED') {
          setIsTranscribing(false)
          if (onTranscribed) onTranscribed()
          return
        }
        await new Promise((resolve) => setTimeout(resolve, 3000))
        return poll()
      }
      await poll()
    } catch {
      setIsTranscribing(false)
    }
  }

  return (
    <div className="mt-2">
      <button
        onClick={handleTranscribe}
        className="text-xs px-2.5 py-1 rounded-md bg-light-gray dark:bg-gray-700 text-warm-gray dark:text-gray-300 hover:bg-slate-blue/10 hover:text-slate-blue transition-colors"
        data-testid="transcribe-button"
      >
        Transcribe
      </button>
    </div>
  )
}

// ── EMR patient picker (used inside the attach modal) ─────────────────────
// Pulled inline rather than a separate file so the Voicemails page holds the
// whole attach flow in one place during this tester-day iteration. If the
// component gets reused elsewhere (intake form, new-todo modal), extract it.

type EmrField = 'q' | 'phone' | 'email' | 'dob'

function normDigits(s: string | undefined | null): string {
  return (s ?? '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
}
function formatPhoneDigits(digits: string | undefined): string {
  if (!digits) return ''
  const d = digits.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return digits
}

function EmrCandidateCard({
  patient,
  selected,
  onSelect,
}: {
  patient: EmrPatient
  selected: boolean
  onSelect: () => void
}) {
  const name = `${patient.last_name}, ${patient.first_name}${patient.middle_name ? ' ' + patient.middle_name : ''}`
  const cityState = [patient.address?.city, patient.address?.state].filter(Boolean).join(', ')
  const phone = patient.mobile_phone || patient.home_phone
  return (
    <button
      onClick={onSelect}
      className={`w-full text-left px-4 py-3 rounded-lg border transition-colors ${
        selected
          ? 'border-slate-blue bg-slate-blue/10'
          : 'border-light-gray dark:border-gray-600 hover:border-slate-blue hover:bg-slate-blue/5'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-charcoal dark:text-white truncate">{name}</div>
          <div className="text-sm text-warm-gray dark:text-gray-300 mt-0.5">
            {patient.dob ? `DOB ${patient.dob}` : 'DOB —'}
            {cityState && ` · ${cityState}`}
          </div>
          {phone && (
            <div className="text-sm text-warm-gray dark:text-gray-300">{formatPhoneDigits(phone)}</div>
          )}
        </div>
        {selected && <Check size={18} className="text-slate-blue shrink-0 mt-1" />}
      </div>
    </button>
  )
}

function EmrPatientPicker({
  callerNumber,
  selectedPatientId,
  onSelect,
}: {
  callerNumber?: string
  selectedPatientId: string
  onSelect: (id: string) => void
}) {
  const [field, setField] = useState<EmrField>('q')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')

  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(h)
  }, [query])

  const callerDigits = normDigits(callerNumber)
  const autoMatch = useQuery({
    queryKey: ['emr-match-phone', callerDigits],
    queryFn: () => emrSearchPatients({ phone: callerDigits }),
    enabled: callerDigits.length >= 10,
    staleTime: 60_000,
  })

  const manualSearch = useQuery({
    queryKey: ['emr-match-manual', field, debounced],
    queryFn: () => emrSearchPatients({ [field]: debounced }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })

  const autoMatchHits = autoMatch.data ?? []
  const manualHits = manualSearch.data ?? []

  const placeholderByField: Record<EmrField, string> = {
    q: 'Last name (prefix)',
    phone: 'Phone digits, e.g. 7275551234',
    email: 'email@example.com',
    dob: 'YYYY-MM-DD',
  }

  return (
    <div>
      {/* Auto-match by caller ID */}
      {callerDigits.length >= 10 && (
        <section className="mb-4">
          <h3 className="text-sm font-semibold text-charcoal dark:text-white mb-2">
            Caller-ID match
          </h3>
          {autoMatch.isLoading && <div className="text-sm text-warm-gray">Searching…</div>}
          {autoMatch.isSuccess && autoMatchHits.length === 0 && (
            <div className="text-sm text-warm-gray dark:text-gray-400 italic">
              No patient on file with this number. Search manually below.
            </div>
          )}
          {autoMatch.isSuccess && autoMatchHits.length > 0 && (
            <div className="space-y-2">
              {autoMatchHits.length > 1 && (
                <div className="text-xs text-warm-gray dark:text-gray-400 mb-1">
                  {autoMatchHits.length} patients share this number — pick the right one:
                </div>
              )}
              {autoMatchHits.map(p => (
                <EmrCandidateCard
                  key={p.patient_id}
                  patient={p}
                  selected={selectedPatientId === p.patient_id}
                  onSelect={() => onSelect(p.patient_id)}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Manual search */}
      <section>
        <h3 className="text-sm font-semibold text-charcoal dark:text-white mb-2">
          Search manually
        </h3>
        <div className="flex gap-1 mb-3 text-xs">
          {(['q', 'phone', 'email', 'dob'] as EmrField[]).map(f => (
            <button
              key={f}
              onClick={() => { setField(f); setQuery('') }}
              className={`px-2.5 py-1 rounded-md transition-colors ${
                field === f
                  ? 'bg-slate-blue text-white'
                  : 'bg-light-gray dark:bg-gray-700 text-warm-gray hover:bg-slate-blue/10'
              }`}
            >
              {f === 'q' ? 'Last name' : f === 'dob' ? 'DOB' : f === 'phone' ? 'Phone' : 'Email'}
            </button>
          ))}
        </div>
        <div className="relative mb-3">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-gray" />
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={placeholderByField[field]}
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue"
          />
        </div>
        {debounced.length >= 2 && manualSearch.isLoading && (
          <div className="text-sm text-warm-gray py-2">Searching…</div>
        )}
        {manualSearch.isSuccess && manualHits.length === 0 && debounced.length >= 2 && (
          <div className="text-sm text-warm-gray italic py-2">No matches.</div>
        )}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {manualHits.map(p => (
            <EmrCandidateCard
              key={p.patient_id}
              patient={p}
              selected={selectedPatientId === p.patient_id}
              onSelect={() => onSelect(p.patient_id)}
            />
          ))}
        </div>
      </section>
    </div>
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

  const { data: voicemails, isLoading, isError, error: queryError } = useQuery({
    queryKey: ['voicemails'],
    queryFn: listVoicemails,
    // Auto-poll every 15s while any voicemail has an active transcription
    refetchInterval: (query) => {
      const vms = query.state.data as Voicemail[] | undefined
      const hasActive = vms?.some((vm) =>
        !vm.transcript &&
        vm.transcriptStatus !== 'Failed' &&
        vm.transcriptionStatus !== 'FAILED' &&
        (vm.transcriptStatus === 'Pending' ||
         vm.transcriptStatus === 'Transcribing' ||
         vm.transcriptionStatus === 'PENDING' ||
         vm.transcriptionStatus === 'IN_PROGRESS')
      )
      return hasActive ? 15_000 : false
    },
  })

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: listAllPatients,
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
    if (tab === 'archived') return vm.status === 'Archived'
    return vm.status !== 'Archived'
  })

  const allCount = voicemails?.filter((v) => v.status !== 'Archived').length ?? 0
  const unattachedCount = voicemails?.filter((v) => v.attachedTo.type === 'none' && v.status !== 'Archived').length ?? 0
  const archivedCount = voicemails?.filter((v) => v.status === 'Archived').length ?? 0

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
        callerNumber: attachModal.callerNumber,
        callerName: attachModal.callerName,
        category: attachModal.category,
      })
    } else if (attachMode === 'new' && newPatient.firstName && newPatient.lastName) {
      createPatientMutation.mutate(newPatient)
    }
  }

  const openAttachModal = (vm: Voicemail, preselectedPatientId?: string) => {
    setAttachModal(vm)
    setAttachMode('existing')
    setSearchQuery('')
    setSelectedPatientId(preselectedPatientId || '')
    setNewPatient({ firstName: '', lastName: '', phone: '' })
  }

  const getPatientName = (patientId?: string) => {
    if (!patientId || !patients) return null
    const p = patients.find((p) => p.id === patientId)
    if (p) return `${p.firstName} ${p.lastName}`
    return null
  }

  if (isLoading) return <LoadingSpinner />
  if (isError) {
    const errMsg = (queryError as any)?.message || 'Unknown error'
    const status = (queryError as any)?.status
    return (
      <div className="py-8">
        <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm">
          <p className="font-semibold text-red-700 dark:text-red-300 mb-1">
            Could not load voicemails{status ? ` (${status})` : ''}
          </p>
          <p className="text-red-600 dark:text-red-400">{errMsg}</p>
          {status === 404 && (
            <p className="text-red-500 dark:text-red-400 mt-2 text-xs">
              API route may not be configured. Expected: GET /zoom/voicemails
            </p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal dark:text-white mb-6">Voicemails</h1>

      <Tabs
        tabs={[
          { key: 'all', label: 'All', count: allCount },
          { key: 'unattached', label: 'Unattached', count: unattachedCount },
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
                : tab === 'archived'
                  ? "No archived voicemails yet."
                  : "No voicemails found."
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

                {/* Transcript */}
                <TranscriptDisplay vm={vm} onTranscribed={() => queryClient.invalidateQueries({ queryKey: ['voicemails'] })} />

                {/* Suggested patient matches */}
                {vm.suggestedPatientIds && vm.suggestedPatientIds.length > 0 && vm.attachedTo.type === 'none' && (
                  <div className="mt-2">
                    <span className="text-xs text-warm-gray dark:text-gray-400">Suggested matches: </span>
                    <div className="inline-flex gap-1.5 flex-wrap">
                      {vm.suggestedPatientIds.map((pid) => {
                        const name = getPatientName(pid)
                        if (!name) return null
                        return (
                          <button
                            key={pid}
                            onClick={() => openAttachModal(vm, pid)}
                            className="text-xs px-2 py-0.5 rounded-full bg-slate-blue/10 text-slate-blue hover:bg-slate-blue/20 transition-colors"
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )}

                {vm.attachedTo.type !== 'none' && (
                  <p className="text-sm text-green-700 mt-2 flex items-center gap-1">
                    <User size={14} />
                    Attached to {getPatientName(vm.attachedTo.patientId) || 'patient'}
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
              <EmrPatientPicker
                callerNumber={attachModal.callerNumber}
                selectedPatientId={selectedPatientId}
                onSelect={setSelectedPatientId}
              />
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
