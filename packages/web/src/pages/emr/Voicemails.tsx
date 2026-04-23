/**
 * EMR Voicemails — unmatched queue with an auto-match + manual-search attach flow.
 *
 * Flow per voicemail: caller ID is looked up against the FM patient roster when
 * the attach modal opens. Exact phone hit → pre-confirmed candidate card.
 * Zero or many hits → fall through to manual search (phone/email/DOB/last name).
 * Selecting a candidate stamps match_source=auto when it was the caller-ID hit
 * the user clicked, match_source=manual when it came from the search tabs.
 */

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Phone, UserPlus, Search, Loader2, Check } from 'lucide-react'
import {
  listUnmatchedVoicemails,
  searchPatients,
  attachVoicemail,
  type EmrVoicemail,
  type EmrPatient,
} from '../../api/emr'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { LoadingSpinner } from '../../components/ui/LoadingSpinner'
import { useToast } from '../../components/ui/Toast'

// ── Helpers ────────────────────────────────────────────────────────────────

function formatPhone(digits: string | undefined): string {
  if (!digits) return ''
  const d = digits.replace(/\D/g, '')
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
  if (d.length === 11 && d.startsWith('1')) return `+1 (${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`
  return digits
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Patient candidate card (used in auto-match and manual-search lists) ────

function PatientCandidateCard({
  patient,
  onSelect,
  loading,
}: {
  patient: EmrPatient
  onSelect: () => void
  loading?: boolean
}) {
  const name = `${patient.last_name}, ${patient.first_name}${patient.middle_name ? ' ' + patient.middle_name : ''}`
  const cityState = [patient.address?.city, patient.address?.state].filter(Boolean).join(', ')
  const phone = patient.mobile_phone || patient.home_phone
  return (
    <button
      onClick={onSelect}
      disabled={loading}
      className="w-full text-left px-4 py-3 rounded-lg border border-light-gray dark:border-gray-600 hover:border-slate-blue hover:bg-slate-blue/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-charcoal dark:text-white truncate">{name}</div>
          <div className="text-sm text-warm-gray dark:text-gray-300 mt-0.5">
            {patient.dob ? `DOB ${patient.dob}` : 'DOB —'}
            {cityState && ` · ${cityState}`}
          </div>
          {phone && (
            <div className="text-sm text-warm-gray dark:text-gray-300">{formatPhone(phone)}</div>
          )}
        </div>
        {loading ? <Loader2 size={18} className="animate-spin text-slate-blue shrink-0 mt-1" />
          : <Check size={18} className="text-slate-blue shrink-0 mt-1 opacity-0 group-hover:opacity-100" />}
      </div>
    </button>
  )
}

// ── Attach modal ───────────────────────────────────────────────────────────

type AttachField = 'phone' | 'email' | 'dob' | 'q'

function AttachModal({
  voicemail,
  onClose,
  onAttached,
}: {
  voicemail: EmrVoicemail
  onClose: () => void
  onAttached: () => void
}) {
  const { toast } = useToast()
  const [field, setField] = useState<AttachField>('q')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [attaching, setAttaching] = useState<string | null>(null) // patient_id being attached

  // Debounce the manual-search query so each keystroke doesn't slam the API.
  useEffect(() => {
    const h = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(h)
  }, [query])

  // Auto-match: look up caller_id against the roster the moment the modal opens.
  const autoMatch = useQuery({
    queryKey: ['emr-auto-match', voicemail.caller_id],
    queryFn: () => searchPatients({ phone: voicemail.caller_id }),
    enabled: !!voicemail.caller_id,
    staleTime: 60_000,
  })

  const manualSearch = useQuery({
    queryKey: ['emr-manual-search', field, debounced],
    queryFn: () => searchPatients({ [field]: debounced }),
    enabled: debounced.length >= 2,
    staleTime: 30_000,
  })

  const handleAttach = async (patientId: string, source: 'auto' | 'manual') => {
    setAttaching(patientId)
    try {
      await attachVoicemail(voicemail.voicemail_id, patientId, source)
      toast('success', 'Voicemail attached to patient')
      onAttached()
    } catch (err) {
      toast('error', (err as Error).message || 'Attach failed')
      setAttaching(null)
    }
  }

  const callerDisplay = voicemail.caller_name_cnam || formatPhone(voicemail.caller_id)
  const autoMatchHits = autoMatch.data ?? []
  const manualHits = manualSearch.data ?? []

  const placeholderByField: Record<AttachField, string> = {
    q: 'Last name (prefix)',
    phone: 'Phone digits, e.g. 7275551234',
    email: 'email@example.com',
    dob: 'YYYY-MM-DD',
  }

  return (
    <Modal open onClose={onClose} title="Attach voicemail" size="md">
      <div className="mb-4 pb-4 border-b border-light-gray dark:border-gray-700">
        <div className="text-sm text-warm-gray dark:text-gray-300">From</div>
        <div className="font-semibold text-charcoal dark:text-white">{callerDisplay}</div>
        {voicemail.caller_name_cnam && (
          <div className="text-sm text-warm-gray dark:text-gray-300">{formatPhone(voicemail.caller_id)}</div>
        )}
        {voicemail.transcript && (
          <div className="mt-2 p-3 bg-light-gray dark:bg-gray-700 rounded text-sm italic text-charcoal dark:text-gray-200">
            "{voicemail.transcript}"
          </div>
        )}
      </div>

      {/* Auto-match section */}
      <section className="mb-5">
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
              <PatientCandidateCard
                key={p.patient_id}
                patient={p}
                onSelect={() => handleAttach(p.patient_id, 'auto')}
                loading={attaching === p.patient_id}
              />
            ))}
          </div>
        )}
      </section>

      {/* Manual search section */}
      <section>
        <h3 className="text-sm font-semibold text-charcoal dark:text-white mb-2">
          Search manually
        </h3>
        <div className="flex gap-1 mb-3 text-xs">
          {(['q', 'phone', 'email', 'dob'] as AttachField[]).map(f => (
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
        <div className="space-y-2 max-h-80 overflow-y-auto">
          {manualHits.map(p => (
            <PatientCandidateCard
              key={p.patient_id}
              patient={p}
              onSelect={() => handleAttach(p.patient_id, 'manual')}
              loading={attaching === p.patient_id}
            />
          ))}
        </div>
      </section>

      <div className="flex justify-end mt-5 pt-4 border-t border-light-gray dark:border-gray-700">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </Modal>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────

export default function EmrVoicemails() {
  const qc = useQueryClient()
  const [openVm, setOpenVm] = useState<EmrVoicemail | null>(null)

  const { data: voicemails, isLoading, isError, error } = useQuery({
    queryKey: ['emr-unmatched-voicemails'],
    queryFn: listUnmatchedVoicemails,
  })

  const handleAttached = () => {
    setOpenVm(null)
    qc.invalidateQueries({ queryKey: ['emr-unmatched-voicemails'] })
  }

  if (isLoading) return <LoadingSpinner />
  if (isError) {
    return (
      <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm">
        <p className="font-semibold text-red-700 dark:text-red-300 mb-1">
          Could not load EMR voicemails
        </p>
        <p className="text-red-600 dark:text-red-400">{(error as Error)?.message}</p>
      </div>
    )
  }

  const vms = voicemails ?? []

  return (
    <div>
      <div className="flex items-baseline justify-between mb-6">
        <h1 className="text-2xl font-bold text-charcoal dark:text-white">EMR — Voicemails</h1>
        <span className="text-sm text-warm-gray dark:text-gray-400">{vms.length} unmatched</span>
      </div>

      {vms.length === 0 && (
        <EmptyState
          icon={<Phone size={48} />}
          title="All caught up"
          description="No unmatched voicemails. Re-seed stubs with packages/infra/scripts/seed-stub-voicemails.ts."
        />
      )}

      <div className="space-y-3">
        {vms.map(vm => (
          <Card key={vm.voicemail_id} className="hover:shadow-sm transition-shadow">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-charcoal dark:text-white truncate">
                    {vm.caller_name_cnam || formatPhone(vm.caller_id)}
                  </span>
                  {vm.scenario && <Badge variant="gray">{vm.scenario}</Badge>}
                </div>
                <div className="text-sm text-warm-gray dark:text-gray-300 mt-0.5">
                  {formatPhone(vm.caller_id)}
                </div>
                <div className="flex items-center gap-3 mt-1 text-sm text-warm-gray dark:text-gray-300">
                  <span>{timeAgo(vm.received_at)}</span>
                  <span>{formatDuration(vm.duration_seconds)}</span>
                </div>
                {vm.transcript && (
                  <div className="mt-2 p-3 bg-light-gray dark:bg-gray-700 rounded-lg text-sm text-charcoal dark:text-gray-200">
                    {vm.transcript}
                  </div>
                )}
              </div>
              <div className="shrink-0">
                <Button size="sm" onClick={() => setOpenVm(vm)} icon={<UserPlus size={16} />}>
                  Attach
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {openVm && (
        <AttachModal
          voicemail={openVm}
          onClose={() => setOpenVm(null)}
          onAttached={handleAttached}
        />
      )}
    </div>
  )
}
