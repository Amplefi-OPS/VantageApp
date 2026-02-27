import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Input, TextArea } from './ui/Input'
import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { useToast } from './ui/Toast'
import { createAppointment } from '../api/endpoints'

const TYPE_OPTIONS = [
  { value: 'in_office', label: 'In-Office' },
  { value: 'telehealth', label: 'Telehealth' },
  { value: 'phone', label: 'Phone' },
]

interface NewAppointmentModalProps {
  open: boolean
  onClose: () => void
}

interface AppointmentForm {
  patientName: string
  type: string
  date: string
  startTime: string
  endTime: string
  reason: string
  notes: string
}

const today = () => new Date().toISOString().slice(0, 10)

const EMPTY_FORM: AppointmentForm = {
  patientName: '',
  type: 'in_office',
  date: today(),
  startTime: '09:00',
  endTime: '09:30',
  reason: '',
  notes: '',
}

export function NewAppointmentModal({ open, onClose }: NewAppointmentModalProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<AppointmentForm>({ ...EMPTY_FORM })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: createAppointment,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Appointment created successfully.')
      setForm({ ...EMPTY_FORM, date: today() })
      setErrors({})
      onClose()
    },
    onError: () => {
      toast('error', 'Failed to create appointment. Please try again.')
    },
  })

  function updateField(field: keyof AppointmentForm, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }))
    if (errors[field]) {
      setErrors((prev) => {
        const next = { ...prev }
        delete next[field]
        return next
      })
    }
  }

  function handleSubmit() {
    const newErrors: Record<string, string> = {}
    if (!form.patientName.trim()) newErrors.patientName = 'Patient name is required'
    if (!form.date) newErrors.date = 'Date is required'
    if (!form.startTime) newErrors.startTime = 'Start time is required'
    if (!form.endTime) newErrors.endTime = 'End time is required'
    if (!form.reason.trim()) newErrors.reason = 'Reason is required'
    if (form.startTime && form.endTime && form.startTime >= form.endTime) {
      newErrors.endTime = 'End time must be after start time'
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors)
      return
    }

    const startTime = `${form.date}T${form.startTime}:00`
    const endTime = `${form.date}T${form.endTime}:00`

    mutation.mutate({
      patientName: form.patientName.trim(),
      type: form.type as 'in_office' | 'telehealth' | 'phone',
      startTime,
      endTime,
      reason: form.reason.trim(),
      notes: form.notes.trim() || undefined,
    })
  }

  function handleClose() {
    setForm({ ...EMPTY_FORM, date: today() })
    setErrors({})
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Appointment" size="md">
      <div className="space-y-4">
        <Input
          label="Patient Name *"
          value={form.patientName}
          onChange={(e) => updateField('patientName', e.target.value)}
          error={errors.patientName}
          placeholder="John Smith"
        />

        <Select
          label="Appointment Type"
          options={TYPE_OPTIONS}
          value={form.type}
          onChange={(e) => updateField('type', e.target.value)}
        />

        <Input
          label="Date *"
          type="date"
          value={form.date}
          onChange={(e) => updateField('date', e.target.value)}
          error={errors.date}
        />

        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Start Time *"
            type="time"
            value={form.startTime}
            onChange={(e) => updateField('startTime', e.target.value)}
            error={errors.startTime}
          />
          <Input
            label="End Time *"
            type="time"
            value={form.endTime}
            onChange={(e) => updateField('endTime', e.target.value)}
            error={errors.endTime}
          />
        </div>

        <Input
          label="Reason *"
          value={form.reason}
          onChange={(e) => updateField('reason', e.target.value)}
          error={errors.reason}
          placeholder="Annual checkup, Follow-up, etc."
        />

        <TextArea
          label="Notes"
          value={form.notes}
          onChange={(e) => updateField('notes', e.target.value)}
          placeholder="Optional notes..."
        />

        <div className="flex gap-3 justify-end pt-4 border-t border-light-gray">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={mutation.isPending} icon={<CalendarPlus size={18} />}>
            Create Appointment
          </Button>
        </div>
      </div>
    </Modal>
  )
}
