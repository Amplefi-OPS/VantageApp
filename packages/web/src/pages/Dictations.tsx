import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { EmptyState } from '../components/ui/EmptyState'
import { Tabs } from '../components/ui/Tabs'
import { useToast } from '../components/ui/Toast'
import { Mic, Upload, FileText, AlertCircle, CheckCircle, Clock, RefreshCw } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { apiGet, apiPost, ApiError } from '../api/client'

interface Dictation {
  dictation_id: string
  provider_id: string
  patient_id: string | null
  status: 'Uploading' | 'Transcribing' | 'DraftReady' | 'TranscriptionFailed' | 'Reviewed'
  note_type: string
  transcript_text: string | null
  confidence: number | null
  original_filename: string
  created_at: string
  updated_at: string
  task_id: string | null
}

const statusConfig: Record<string, { variant: 'blue' | 'green' | 'yellow' | 'red' | 'gray'; icon: typeof Clock }> = {
  Uploading: { variant: 'gray', icon: Upload },
  Transcribing: { variant: 'yellow', icon: Clock },
  DraftReady: { variant: 'green', icon: FileText },
  TranscriptionFailed: { variant: 'red', icon: AlertCircle },
  Reviewed: { variant: 'blue', icon: CheckCircle },
}

export default function Dictations() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { toast } = useToast()
  const [filter, setFilter] = useState<string>('all')
  const [selectedDictation, setSelectedDictation] = useState<Dictation | null>(null)
  const [showUpload, setShowUpload] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const { data: dictations = [], isLoading, isError } = useQuery({
    queryKey: ['dictations', user?.providerId],
    queryFn: async () => {
      const result = await apiGet<{ tasks: Dictation[] }>(
        `/tasks?provider_id=${user?.providerId}&type=Dictation`,
      )
      return result.tasks || []
    },
  })

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      // Step 1: Get pre-signed URL via typed API client
      const presignResult = await apiPost<{ upload_url: string; dictation_id: string }>(
        '/uploads/presign',
        {
          provider_id: user?.providerId,
          filename: file.name,
          content_type: file.type || 'audio/mp4',
          note_type: 'progress_note',
          idempotency_key: crypto.randomUUID(),
        },
      )

      if (!presignResult.upload_url) {
        throw new Error('Failed to get upload URL')
      }

      // Step 2: Upload directly to S3
      const uploadRes = await fetch(presignResult.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': file.type || 'audio/mp4' },
        body: file,
      })

      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status})`)
      }

      return { dictation_id: presignResult.dictation_id }
    },
    onSuccess: () => {
      toast('success', 'Dictation uploaded. Transcription will begin shortly.')
      setShowUpload(false)
      queryClient.invalidateQueries({ queryKey: ['dictations'] })
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Upload failed. Please try again.'
      toast('error', msg)
    },
  })

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const maxSize = 100 * 1024 * 1024 // 100 MB
    if (file.size > maxSize) {
      toast('error', 'File too large. Maximum size is 100 MB.')
      return
    }
    uploadMutation.mutate(file)
  }

  const filtered = dictations.filter((d) => {
    if (filter === 'all') return true
    return d.status === filter
  })

  const tabs = [
    { key: 'all', label: `All (${dictations.length})` },
    { key: 'DraftReady', label: `Ready (${dictations.filter((d) => d.status === 'DraftReady').length})` },
    { key: 'Transcribing', label: `Processing (${dictations.filter((d) => d.status === 'Transcribing').length})` },
    { key: 'TranscriptionFailed', label: `Failed (${dictations.filter((d) => d.status === 'TranscriptionFailed').length})` },
  ]

  if (isLoading) return <LoadingSpinner />

  if (isError) {
    return (
      <EmptyState
        icon={<AlertCircle className="w-12 h-12" />}
        title="Failed to load dictations"
        description="Please check your connection and try again."
      />
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-charcoal dark:text-white">Dictations</h1>
          <p className="text-warm-gray dark:text-gray-300 text-sm mt-1">Upload audio, view transcripts</p>
        </div>
        <Button onClick={() => setShowUpload(true)}>
          <Upload className="w-4 h-4 mr-2" />
          Upload Dictation
        </Button>
      </div>

      <Tabs tabs={tabs} active={filter} onChange={setFilter} />

      <div className="mt-4 space-y-3">
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Mic className="w-12 h-12" />}
            title="No dictations"
            description="Upload an audio recording to get started."
          />
        ) : (
          filtered.map((dict) => {
            const config = statusConfig[dict.status] || statusConfig.Uploading
            const StatusIcon = config.icon
            return (
              <Card
                key={dict.dictation_id}
                className="cursor-pointer hover:border-slate-blue/30 transition-colors"
                onClick={() => setSelectedDictation(dict)}
              >
                <div className="flex items-start gap-4">
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-slate-blue/10 flex items-center justify-center">
                    <StatusIcon className="w-5 h-5 text-slate-blue" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold text-charcoal dark:text-white truncate">
                        {dict.original_filename}
                      </h3>
                      <Badge variant={config.variant}>{dict.status.replace(/([A-Z])/g, ' $1').trim()}</Badge>
                    </div>
                    <p className="text-sm text-warm-gray dark:text-gray-300">
                      {dict.note_type.replace(/_/g, ' ')}
                      {dict.confidence !== null && ` — ${(dict.confidence * 100).toFixed(0)}% confidence`}
                    </p>
                    {dict.transcript_text && (
                      <p className="text-sm text-charcoal dark:text-gray-200 mt-2 line-clamp-2">
                        {dict.transcript_text}
                      </p>
                    )}
                    <p className="text-xs text-warm-gray dark:text-gray-400 mt-2">
                      {new Date(dict.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </Card>
            )
          })
        )}
      </div>

      {/* Upload Modal */}
      <Modal
        open={showUpload}
        onClose={() => setShowUpload(false)}
        title="Upload Dictation"
      >
        <div className="space-y-4">
          <p className="text-sm text-warm-gray dark:text-gray-300">
            Select an audio file (m4a, mp3, mp4, wav, flac). Maximum 100 MB.
          </p>
          <div
            className="border-2 border-dashed border-light-gray dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-slate-blue transition-colors"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="w-8 h-8 text-warm-gray mx-auto mb-2" />
            <p className="text-sm font-medium text-charcoal dark:text-white">
              {uploadMutation.isPending ? 'Uploading...' : 'Click to select audio file'}
            </p>
            <p className="text-xs text-warm-gray dark:text-gray-400 mt-1">or drag and drop</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".m4a,.mp3,.mp4,.wav,.flac,audio/*"
            onChange={handleFileSelect}
            className="hidden"
          />
          {uploadMutation.isPending && (
            <div className="flex items-center gap-2 text-sm text-slate-blue">
              <RefreshCw className="w-4 h-4 animate-spin" />
              Uploading and starting transcription...
            </div>
          )}
        </div>
      </Modal>

      {/* Dictation Detail Modal */}
      <Modal
        open={!!selectedDictation}
        onClose={() => setSelectedDictation(null)}
        title={selectedDictation?.original_filename || 'Dictation'}
      >
        {selectedDictation && (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Badge variant={statusConfig[selectedDictation.status]?.variant || 'gray'}>
                {selectedDictation.status.replace(/([A-Z])/g, ' $1').trim()}
              </Badge>
              <span className="text-sm text-warm-gray dark:text-gray-300">
                {selectedDictation.note_type.replace(/_/g, ' ')}
              </span>
            </div>

            {selectedDictation.confidence !== null && (
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-light-gray dark:bg-gray-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-slate-blue rounded-full"
                    style={{ width: `${(selectedDictation.confidence || 0) * 100}%` }}
                  />
                </div>
                <span className="text-sm font-medium text-charcoal dark:text-white">
                  {((selectedDictation.confidence || 0) * 100).toFixed(1)}%
                </span>
              </div>
            )}

            {selectedDictation.transcript_text ? (
              <div>
                <h3 className="text-sm font-semibold text-charcoal dark:text-white mb-2">Transcript</h3>
                <div className="bg-off-white dark:bg-gray-900 rounded-lg p-4 text-sm text-charcoal dark:text-gray-200 leading-relaxed max-h-80 overflow-y-auto">
                  {selectedDictation.transcript_text}
                </div>
              </div>
            ) : selectedDictation.status === 'Transcribing' ? (
              <div className="text-center py-8">
                <Clock className="w-8 h-8 text-warm-gray mx-auto mb-2 animate-pulse" />
                <p className="text-sm text-warm-gray dark:text-gray-300">Transcription in progress...</p>
              </div>
            ) : selectedDictation.status === 'TranscriptionFailed' ? (
              <div className="text-center py-8">
                <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
                <p className="text-sm text-red-600 dark:text-red-400">Transcription failed</p>
                <Button
                  variant="secondary"
                  className="mt-4"
                  onClick={() => {
                    queryClient.invalidateQueries({ queryKey: ['dictations'] })
                    toast('info', 'Checking for updated status...')
                  }}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            ) : null}

            <div className="text-xs text-warm-gray dark:text-gray-400 space-y-1 pt-2 border-t border-light-gray dark:border-gray-700">
              <p>ID: {selectedDictation.dictation_id}</p>
              <p>Created: {new Date(selectedDictation.created_at).toLocaleString()}</p>
              <p>Updated: {new Date(selectedDictation.updated_at).toLocaleString()}</p>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
