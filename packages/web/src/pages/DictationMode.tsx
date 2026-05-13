import { useState, useRef, useEffect, useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Mic, Square, X, Save, AlertCircle, Loader2 } from 'lucide-react'
import { createNote, getUploadUrl, getPracticeSettings } from '../api/endpoints'
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

const SpeechRecognitionCtor =
  typeof window !== 'undefined'
    ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    : null

export default function DictationMode({
  patientId,
  patientName,
  onClose,
  onTranscript,
}: DictationModeProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()

  const [isRecording, setIsRecording] = useState(false)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const [elapsed, setElapsed] = useState(0)
  const [noteText, setNoteText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [noteTitle, setNoteTitle] = useState('SOAP')
  const [audioBlobUrl, setAudioBlobUrl] = useState<string | null>(null)
  const [audioS3Url, setAudioS3Url] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [selectedApptType, setSelectedApptType] = useState<string>('')

  const { data: practiceSettings } = useQuery({
    queryKey: ['practice-settings'],
    queryFn: getPracticeSettings,
  })

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const speechRecRef = useRef<any>(null)
  const isRecordingRef = useRef(false)

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
      if (speechRecRef.current) {
        speechRecRef.current.onend = null
        try { speechRecRef.current.abort() } catch {}
        speechRecRef.current = null
      }
    }
  }, [stopStream])

  const startRecording = async () => {
    setRecordingError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      // Start MediaRecorder for audio capture
      const mimeType =
        typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : 'audio/webm'
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      audioChunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data)
      }

      recorder.onstop = async () => {
        const blob = new Blob(audioChunksRef.current, { type: mimeType })
        const url = URL.createObjectURL(blob)
        setAudioBlobUrl(url)

        // Upload audio to S3 in background
        setUploading(true)
        try {
          const format = mimeType.includes('mp4') ? 'mp4' as const
            : mimeType.includes('ogg') ? 'ogg' as const
            : 'webm' as const
          const { uploadUrl, s3Key } = await getUploadUrl(format)
          await fetch(uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': blob.type },
            body: blob,
          })
          // Build the S3 object URL for playback (will need presigning on read, but store the key)
          setAudioS3Url(s3Key)
        } catch (err) {
          console.warn('Audio upload to S3 failed:', err)
          // Non-fatal — note text still saves
        } finally {
          setUploading(false)
        }
      }

      recorder.start(250)

      // Start Web Speech API for live transcription
      if (SpeechRecognitionCtor) {
        const recognition = new SpeechRecognitionCtor()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = 'en-US'

        recognition.onresult = (event: any) => {
          let finalTranscript = ''
          let interim = ''

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i]
            if (result.isFinal) {
              finalTranscript += result[0].transcript
            } else {
              interim += result[0].transcript
            }
          }

          if (finalTranscript) {
            setNoteText((prev) => prev + finalTranscript + ' ')
            if (onTranscript) onTranscript(finalTranscript)
          }
          setInterimText(interim)
        }

        recognition.onerror = (event: any) => {
          if (event.error === 'no-speech' || event.error === 'aborted') return
          console.error('Speech recognition error:', event.error)
          setRecordingError(`Speech recognition error: ${event.error}. You can type manually.`)
        }

        recognition.onend = () => {
          // Auto-restart if still recording (browser stops after silence)
          if (isRecordingRef.current) {
            try {
              recognition.start()
            } catch {}
          }
        }

        recognition.start()
        speechRecRef.current = recognition
      }

      setIsRecording(true)
      isRecordingRef.current = true
      setElapsed(0)

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1)
      }, 1000)
    } catch {
      toast('error', 'Microphone access denied. Please allow microphone access and try again.')
    }
  }

  const stopRecording = useCallback(() => {
    // Stop speech recognition
    if (speechRecRef.current) {
      speechRecRef.current.onend = null
      try { speechRecRef.current.stop() } catch {}
      speechRecRef.current = null
    }

    // Commit any remaining interim text
    setInterimText((current) => {
      if (current) {
        setNoteText((prev) => prev + current + ' ')
      }
      return ''
    })

    // Stop MediaRecorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }

    stopStream()
    setIsRecording(false)
    isRecordingRef.current = false

    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [stopStream])

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
    if (isRecording) stopRecording()
    setIsSaving(true)
    try {
      await createNote({
        patientId,
        title: `${noteTitle} — ${new Date().toLocaleDateString()}`,
        body: noteText.trim(),
        audioUrl: audioS3Url || undefined,
        appointmentType: selectedApptType || undefined,
      })
      toast('success', 'Note saved to patient record.')
      queryClient.invalidateQueries({ queryKey: ['patient-notes', patientId] })
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
            if (isRecording) stopRecording()
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

      {/* Browser support warning */}
      {!SpeechRecognitionCtor && (
        <div className="flex items-start gap-3 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-amber-700 dark:text-amber-300 text-sm">
          <AlertCircle size={18} className="shrink-0 mt-0.5" />
          <span>Live transcription requires Chrome or Edge. Audio recording still works — type your note manually after recording.</span>
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
            className="w-14 h-14 rounded-full bg-slate-blue flex items-center justify-center shadow-lg hover:bg-slate-blue/90 transition-colors"
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
            <span className="text-sm text-warm-gray dark:text-gray-400">
              {SpeechRecognitionCtor ? 'Recording — live transcription active' : 'Recording...'}
            </span>
          </div>
        )}
      </div>

      {/* Audio playback after recording */}
      {audioBlobUrl && !isRecording && (
        <div className="p-3 bg-slate-blue/5 dark:bg-slate-blue/10 rounded-lg border border-slate-blue/20">
          <div className="flex items-center gap-2 mb-2">
            <p className="text-xs font-medium text-slate-blue">Recorded Audio</p>
            {uploading && (
              <span className="flex items-center gap-1 text-xs text-warm-gray dark:text-gray-400">
                <Loader2 size={12} className="animate-spin" /> Uploading...
              </span>
            )}
          </div>
          <audio controls src={audioBlobUrl} className="w-full h-10" />
        </div>
      )}

      {/* Textarea + interim text */}
      <div>
        <textarea
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
          placeholder={
            SpeechRecognitionCtor
              ? 'Tap the microphone to start dictating — text appears in real time...'
              : 'Tap the microphone to record, then type your note here...'
          }
          className="w-full min-h-[240px] p-4 rounded-lg border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-charcoal dark:text-white text-base resize-y focus:outline-none focus:ring-2 focus:ring-slate-blue"
          data-testid="dictation-textarea"
        />
        {interimText && (
          <div className="px-4 py-1.5 text-sm text-warm-gray dark:text-gray-400 italic">
            {interimText}
          </div>
        )}
      </div>

      {/* Visit billing */}
      {practiceSettings && practiceSettings.appointmentTypes.length > 0 && (
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-charcoal dark:text-white shrink-0">Bill for visit:</label>
          <select
            value={selectedApptType}
            onChange={(e) => setSelectedApptType(e.target.value)}
            className="flex-1 px-3 py-2 rounded-md border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-charcoal dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue"
          >
            <option value="">— No billing —</option>
            {practiceSettings.appointmentTypes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.name} (${(t.amountCents / 100).toFixed(0)})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Save / Cancel */}
      <div className="flex items-center justify-end gap-3 pt-2 border-t border-light-gray dark:border-gray-700">
        <Button
          variant="ghost"
          onClick={() => {
            if (isRecording) stopRecording()
            onClose()
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={saveNote}
          loading={isSaving}
          disabled={isRecording || uploading || !noteText.trim()}
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
