import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mic, Square, X, Loader2 } from 'lucide-react'
import { presignDictationUpload } from '../api/endpoints'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../auth/AuthProvider'
import { cn } from '../lib/utils'

interface DictationModeProps {
  patientId: string
  patientName: string
  onClose: () => void
}

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function getMediaType(): string {
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus'
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm'
  if (MediaRecorder.isTypeSupported('audio/mp4')) return 'audio/mp4'
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus'
  return 'audio/webm'
}

function getFileExt(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'm4a'
  if (mimeType.includes('ogg')) return 'ogg'
  return 'webm'
}

export default function DictationMode({
  patientId,
  patientName,
  onClose,
}: DictationModeProps) {
  const { toast } = useToast()
  const { user } = useAuth()
  const queryClient = useQueryClient()

  const [isRecording, setIsRecording] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const [uploading, setUploading] = useState(false)
  const [done, setDone] = useState(false)

  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  // Start recording on mount
  useEffect(() => {
    startRecording()
    return () => {
      stopStream()
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  const stopStream = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = getMediaType()
      const recorder = new MediaRecorder(stream, { mimeType })
      mediaRecorderRef.current = recorder
      chunksRef.current = []

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }

      recorder.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
      }

      recorder.start(1000) // collect chunks every second
      setIsRecording(true)
      setElapsed(0)

      timerRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1)
      }, 1000)
    } catch (err) {
      toast('error', 'Microphone access denied. Please allow microphone access and try again.')
      onClose()
    }
  }

  const stopAndUpload = useCallback(async () => {
    if (!mediaRecorderRef.current || mediaRecorderRef.current.state !== 'recording') return

    setIsRecording(false)
    setUploading(true)

    // Stop recording and wait for final data
    const recorder = mediaRecorderRef.current
    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }
        resolve()
      }
      recorder.stop()
    })

    stopStream()

    const mimeType = recorder.mimeType || 'audio/webm'
    const blob = new Blob(chunksRef.current, { type: mimeType })

    if (blob.size < 1000) {
      toast('error', 'Recording too short. Please try again.')
      setUploading(false)
      onClose()
      return
    }

    try {
      // Get content type without codec suffix for S3
      const contentType = mimeType.split(';')[0]
      const ext = getFileExt(mimeType)
      const filename = `dictation-${Date.now()}.${ext}`

      // Step 1: Get presigned URL
      const presign = await presignDictationUpload({
        providerId: user?.providerId || '',
        patientId,
        filename,
        contentType,
      })

      // Step 2: Upload to S3
      const uploadRes = await fetch(presign.upload_url, {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
        body: blob,
      })

      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status})`)
      }

      setDone(true)
      toast('success', 'Dictation uploaded. Transcription will begin shortly.')
      queryClient.invalidateQueries({ queryKey: ['patient-dictations'] })
      queryClient.invalidateQueries({ queryKey: ['patient-notes'] })

      // Auto-close after a moment
      setTimeout(() => onClose(), 2000)
    } catch (err) {
      console.error('Dictation upload failed:', err)
      toast('error', 'Failed to upload dictation. Please try again.')
      setUploading(false)
    }
  }, [patientId, user, toast, queryClient, onClose])

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center">
      {/* Header */}
      <div className="w-full flex items-center justify-between mb-8">
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

      {/* Recording state */}
      {isRecording && (
        <div className="flex flex-col items-center gap-6">
          {/* Pulsing mic indicator */}
          <div className="relative">
            <div className="absolute inset-0 rounded-full bg-red-500/20 animate-ping" />
            <div className="relative w-24 h-24 rounded-full bg-red-500 flex items-center justify-center shadow-lg">
              <Mic size={40} className="text-white" />
            </div>
          </div>

          <div className="text-center">
            <p className="text-4xl font-mono font-bold text-charcoal dark:text-white">
              {formatTimer(elapsed)}
            </p>
            <p className="text-sm text-warm-gray dark:text-gray-400 mt-2">
              Recording... Speak clearly.
            </p>
          </div>

          <Button
            onClick={stopAndUpload}
            variant="danger"
            size="lg"
            icon={<Square size={18} />}
          >
            Stop & Save
          </Button>
        </div>
      )}

      {/* Uploading state */}
      {uploading && !done && (
        <div className="flex flex-col items-center gap-4">
          <Loader2 size={48} className="text-slate-blue animate-spin" />
          <p className="text-lg font-medium text-charcoal dark:text-white">
            Uploading dictation...
          </p>
          <p className="text-sm text-warm-gray dark:text-gray-400">
            Duration: {formatTimer(elapsed)}
          </p>
        </div>
      )}

      {/* Done state */}
      {done && (
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
            <Mic size={32} className="text-green-600" />
          </div>
          <p className="text-lg font-medium text-charcoal dark:text-white">
            Dictation saved
          </p>
          <p className="text-sm text-warm-gray dark:text-gray-400 text-center">
            Transcription will appear in the Notes tab within a few minutes.
          </p>
        </div>
      )}
    </div>
  )
}
