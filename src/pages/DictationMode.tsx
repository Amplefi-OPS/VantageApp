import { useState, useRef, useCallback, useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Mic, MicOff, X, Save, FileText } from 'lucide-react'
import { createNote } from '../api/endpoints'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { useToast } from '../components/ui/Toast'
import { cn } from '../lib/utils'

interface DictationModeProps {
  patientId: string
  patientName: string
  onClose: () => void
}

const TEMPLATES: Record<string, string> = {
  SOAP: `SUBJECTIVE:\n\n\nOBJECTIVE:\n\n\nASSESSMENT:\n\n\nPLAN:\n`,
  'Follow-up': `FOLLOW-UP VISIT\n\nReason for visit:\n\nFindings:\n\nPlan:\n`,
  'Medication Change': `MEDICATION CHANGE\n\nCurrent medication:\n\nNew medication:\n\nReason for change:\n\nInstructions:\n`,
}

export default function DictationMode({
  patientId,
  patientName,
  onClose,
}: DictationModeProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [transcript, setTranscript] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)
  const recognitionRef = useRef<any>(null)

  // Check for Web Speech API support
  useEffect(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (SpeechRecognition) {
      setSpeechSupported(true)
      const recognition = new SpeechRecognition()
      recognition.continuous = true
      recognition.interimResults = true
      recognition.lang = 'en-US'

      recognition.onresult = (event: any) => {
        let interimTranscript = ''
        let finalTranscript = ''

        for (let i = event.resultIndex; i < event.results.length; i++) {
          const result = event.results[i]
          if (result.isFinal) {
            finalTranscript += result[0].transcript + ' '
          } else {
            interimTranscript += result[0].transcript
          }
        }

        if (finalTranscript) {
          setTranscript((prev) => prev + finalTranscript)
        }
      }

      recognition.onerror = () => {
        setIsRecording(false)
      }

      recognition.onend = () => {
        setIsRecording(false)
      }

      recognitionRef.current = recognition
    }

    // Cleanup: stop recognition on unmount
    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop() } catch { /* already stopped */ }
      }
    }
  }, [])

  const toggleRecording = useCallback(() => {
    if (!recognitionRef.current) return
    if (isRecording) {
      recognitionRef.current.stop()
      setIsRecording(false)
    } else {
      recognitionRef.current.start()
      setIsRecording(true)
    }
  }, [isRecording])

  const applyTemplate = (name: string) => {
    if (!title) setTitle(name)
    setTranscript((prev) => {
      if (prev.trim()) return prev + '\n\n' + TEMPLATES[name]
      return TEMPLATES[name]
    })
  }

  const saveMutation = useMutation({
    mutationFn: createNote,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patient-notes'] })
      toast('success', 'Note saved successfully!')
      onClose()
    },
    onError: () => toast('error', 'Failed to save note. Please try again.'),
  })

  const handleSave = () => {
    if (!transcript.trim()) {
      toast('error', 'Please add some text before saving.')
      return
    }
    saveMutation.mutate({
      patientId,
      title: title || 'Untitled Note',
      body: transcript,
    })
  }

  return (
    <div className="min-h-[80vh] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-charcoal">Dictation</h1>
          <p className="text-sm text-warm-gray">Patient: {patientName}</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-lg hover:bg-light-gray transition-colors"
          aria-label="Close dictation"
        >
          <X size={24} />
        </button>
      </div>

      {/* Title */}
      <Input
        label="Note Title"
        placeholder="e.g. Annual Checkup, Follow-up..."
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />

      {/* Template buttons */}
      <div className="flex gap-2 my-4 flex-wrap">
        {Object.keys(TEMPLATES).map((name) => (
          <Button
            key={name}
            variant="ghost"
            size="sm"
            icon={<FileText size={14} />}
            onClick={() => applyTemplate(name)}
          >
            {name}
          </Button>
        ))}
      </div>

      {/* Transcript area */}
      <div className="flex-1 mb-4">
        <label className="text-sm font-medium text-charcoal mb-1.5 block">
          Transcript
        </label>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={
            speechSupported
              ? 'Tap the microphone to start dictating, or type here...'
              : 'Type your notes here...'
          }
          className="w-full h-64 sm:h-80 px-4 py-3 rounded-lg border border-light-gray text-base bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-slate-blue resize-y font-sans leading-relaxed"
        />
      </div>

      {/* Recording indicator */}
      {isRecording && (
        <div className="flex items-center gap-2 mb-4 px-4 py-3 bg-red-50 rounded-lg border border-red-200">
          <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse" />
          <span className="text-red-700 font-medium text-sm">
            Recording... Speak clearly into your microphone.
          </span>
        </div>
      )}

      {/* Bottom controls */}
      <div className="flex items-center justify-between gap-4 pt-4 border-t border-light-gray">
        {/* Mic button */}
        {speechSupported ? (
          <button
            onClick={toggleRecording}
            className={cn(
              'w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-md',
              isRecording
                ? 'bg-red-500 text-white scale-110 animate-pulse'
                : 'bg-slate-blue text-white hover:bg-slate-blue/90',
            )}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            {isRecording ? <MicOff size={28} /> : <Mic size={28} />}
          </button>
        ) : (
          <p className="text-sm text-warm-gray">
            Speech recognition not available in this browser. Type your notes above.
          </p>
        )}

        <div className="flex gap-3">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            loading={saveMutation.isPending}
            icon={<Save size={18} />}
            size="lg"
          >
            Save Note
          </Button>
        </div>
      </div>
    </div>
  )
}
