import { useState, useRef, useEffect, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Mic, Square, X, Loader2, AlertCircle, Save } from 'lucide-react'
import { getUploadUrl, startTranscription, getTranscriptionResult, createNote } from '../api/endpoints'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'

interface DictationModeProps {
  patientId: string
  patientName: string
  onClose: () => void
  onTranscript?: (text: string) => void
}

const NOTE_TEMPLATES: Record<string, string> = {
  SOAP: 'Subjective:\n\nObjective:\n\nAssessment:\n\nPlan:\n',
  'Follow-up': 'Follow-up visit for:\n\nCurrent symptoms:\n\nPlan:\n',
  'Medication Change': 'Current medication:\n\nChange to:\n\nReason:\n\nInstructions:\n',
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getMediaType(): string {
  if (typeof MediaRecorder === 'undefined') return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus'
  return 'audio/webm'
}

function detectFormat(mimeType: string): 'webm' | 'mp4' | 'wav' | 'ogg' {
  if (mimeType.includes('mp4')) return 'mp4'
  if (mimeType.includes('ogg')) return 'ogg'
  if (mimeType.includes('wav')) return 'wav'
  return 'webm'
}

export default function DictationMode({
  patientId,
  patientName,
  onClose,
  onTranscript,
}: DictationModeProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [isRecording, setIsRecording] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStage, setProcessingStage] = useState<'uploading' | 'transcribing' | ''>('')
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [noteText, setNoteText] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [noteTitle, setNoteTitle] = useState('SOAP')

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopStream = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  useEffect(() => {
    return () => {
      stopStream()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [stopStream])

  const startRecording = async () => {
    setRecordingError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = getMediaType()
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.start(250)
      setIsRecording(true)
      setElapsed(0)

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1)
      }, 1000)
    } catch {
      toast('error', 'Microphone access denied. Please allow microphone access and try again.')
    }
  }

  const processRecording = useCallback(async () => {
    setIsProcessing(true)
    setProcessingStage('uploading')

    const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm'
    const blob = new Blob(audioChunksRef.current, { type: mimeType })
    const format = detectFormat(mimeType)

    try {
      const { uploadUrl, s3Key } = await getUploadUrl(format)

      await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': blob.type },
        body: blob,
      })

      setProcessingStage('transcribing')

      const { jobName } = await startTranscription(s3Key, 'DICTATION')

      // Poll for result
      let attempts = 0
      const maxAttempts = 40
      const poll = async (): Promise<void> => {
        if (attempts >= maxAttempts) {
          setRecordingError('Transcription timed out — please type your note manually.')
          setIsProcessing(false)
          setProcessingStage('')
          return
        }
        attempts++

        const result = await getTranscriptionResult(jobName)

        if (result.status === 'COMPLETED' && result.transcript) {
          setNoteText((prev) => (prev ? prev + '\n\n' + result.transcript : result.transcript!))
          if (onTranscript) onTranscript(result.transcript)
          setIsProcessing(false)
          setProcessingStage('')
          toast('success', 'Transcription complete!')
          queryClient.invalidateQueries({ queryKey: ['patient-dictations'] })
          return
        }

        if (result.status === 'FAILED') {
          setRecordingError('Transcription failed — please type your note manually.')
          setIsProcessing(false)
          setProcessingStage('')
          return
        }

        await new Promise((resolve) => setTimeout(resolve, 3000))
        return poll()
      }

      await poll()
    } catch (err) {
      console.error('Transcription pipeline error:', err)
      setRecordingError('Transcription failed — please type your note manually.')
      setIsProcessing(false)
      setProcessingStage('')
    }
  }, [toast, queryClient, onTranscript])

  const stopRecording = useCallback(() => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return

    const recorder = mediaRecorderRef.current
    recorder.onstop = () => {
      processRecording()
    }
    recorder.stop()

    stopStream()
    setIsRecording(false)
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [processRecording, stopStream])

  const applyTemplate = (name: string) => {
    const template = NOTE_TEMPLATES[name]
    if (template) {
      setNoteText(template)
      setSelectedTemplate(name)
      setNoteTitle(name)
    }
  }

  const saveNote = async () => {
    if (!noteText.trim()) {
      toast('error', 'Note is empty — record or type something first.')
      return
    }
    setIsSaving(true)
    try {
      await createNote({
        patientId,
        title: `${noteTitle} — ${new Date().toLocaleDateString()}`,
        body: noteText.trim(),
      })
      toast('success', 'Note saved to patient record.')
      queryClient.invalidateQueries({ queryKey: ['patient-notes'] })
      queryClient.invalidateQueries({ queryKey: ['patient-dictations'] })
      onClose()
    } catch (err) {
      console.error('Save note error:', err)
      toast('error', 'Failed to save note. Please try again.')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-charcoal dark:text-white">Dictation</h1>
          <p className="text-sm text-warm-gray dark:text-gray-400">Patient: {patientName}</p>
        </div>
        <button
          onClick={() => {
            if (mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop()
            }
            stopStream()
            if (timerRef.current) clearInterval(timerRef.current)
            onClose()
          }}
          className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700 transition-colors"
          aria-label="Close dictation"
        >
          <X size={24} className="text-charcoal dark:text-white" />
        </button>
      </div>

      {/* Error banner */}
      {recordingError && (
        <div className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg text-red-700 dark:text-red-300 text-sm">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span className="flex-1">{recordingError}</span>
          <button
            onClick={() => setRecordingError(null)}
            className="shrink-0 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded"
            aria-label="Dismiss error"
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Templates */}
      <div className="flex gap-2 flex-wrap">
        {Object.keys(NOTE_TEMPLATES).map((name) => (
          <button
            key={name}
            onClick={() => applyTemplate(name)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              selectedTemplate === name
                ? 'bg-slate-blue text-white'
                : 'bg-light-gray dark:bg-gray-700 text-charcoal dark:text-gray-200 hover:bg-slate-blue/10'
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {/* Recording controls */}
      <div className="flex items-center gap-4">
        {isRecording ? (
          <button
            onClick={stopRecording}
            className="relative w-14 h-14 rounded-full bg-red-500 flex items-center justify-center shadow-lg hover:bg-red-600 transition-colors"
            aria-label="Stop recording"
            data-testid="stop-recording-btn"
          >
            <div className="absolute inset-0 rounded-full bg-red-500/30 animate-ping" />
            <Square size={22} className="text-white relative z-10" />
          </button>
        ) : (
          <button
            onClick={startRecording}
            disabled={isProcessing}
            className="w-14 h-14 rounded-full bg-slate-blue flex items-center justify-center shadow-lg hover:bg-slate-blue/90 transition-colors disabled:opacity-50"
            aria-label="Start recording"
            data-testid="mic-button"
          >
            <Mic size={22} className="text-white" />
          </button>
        )}

        {isRecording && (
          <div className="flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-lg font-mono font-semibold text-charcoal dark:text-white">
              {formatTimer(elapsed)}
            </span>
            <span className="text-sm text-warm-gray dark:text-gray-400">Recording...</span>
          </div>
        )}

        {isProcessing && (
          <div className="flex items-center gap-3" data-testid="processing-indicator">
            <Loader2 size={20} className="text-slate-blue animate-spin" />
            <span className="text-sm text-charcoal dark:text-white" data-testid="processing-stage">
              {processingStage === 'uploading' ? 'Uploading audio\u2026' : 'Transcribing with AWS\u2026'}
            </span>
          </div>
        )}
      </div>

      {/* Textarea */}
      <textarea
        value={noteText}
        onChange={(e) => setNoteText(e.target.value)}
        placeholder="Transcribed text will appear here, or type manually..."
        className="w-full min-h-[240px] p-4 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-charcoal dark:text-white text-base resize-y focus:outline-none focus:ring-2 focus:ring-slate-blue"
        data-testid="dictation-textarea"
      />

      {/* Save / Cancel */}
      <div className="flex items-center justify-end gap-3 pt-2">
        <Button
          variant="ghost"
          onClick={() => {
            if (mediaRecorderRef.current?.state === 'recording') {
              mediaRecorderRef.current.stop()
            }
            stopStream()
            if (timerRef.current) clearInterval(timerRef.current)
            onClose()
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={saveNote}
          loading={isSaving}
          disabled={isRecording || isProcessing || !noteText.trim()}
          icon={<Save size={18} />}
          size="lg"
          data-testid="save-note-btn"
        >
          Save Note
        </Button>
      </div>
    </div>
  )
}
