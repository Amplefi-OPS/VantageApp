import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { Modal } from './ui/Modal'
import { Input, TextArea } from './ui/Input'
import { Select } from './ui/Select'
import { Button } from './ui/Button'
import { useToast } from './ui/Toast'
import { createPatient } from '../api/endpoints'
import { CreatePatientSchema, type CreatePatientRequest } from '../api/types'

const GENDER_OPTIONS = [
  { value: '', label: 'Select gender' },
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
  { value: 'Non-binary', label: 'Non-binary' },
  { value: 'Prefer not to say', label: 'Prefer not to say' },
]

const LANGUAGE_OPTIONS = [
  { value: '', label: 'Select language' },
  { value: 'English', label: 'English' },
  { value: 'Spanish', label: 'Spanish' },
  { value: 'Chinese', label: 'Chinese' },
  { value: 'Vietnamese', label: 'Vietnamese' },
  { value: 'Korean', label: 'Korean' },
  { value: 'Tagalog', label: 'Tagalog' },
  { value: 'Arabic', label: 'Arabic' },
  { value: 'French', label: 'French' },
  { value: 'Other', label: 'Other' },
]

const US_STATES = [
  { value: '', label: 'Select state' },
  { value: 'AL', label: 'Alabama' },
  { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' },
  { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' },
  { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' },
  { value: 'DE', label: 'Delaware' },
  { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' },
  { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' },
  { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' },
  { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' },
  { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' },
  { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' },
  { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' },
  { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' },
  { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' },
  { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' },
  { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' },
  { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' },
  { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' },
  { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' },
  { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' },
  { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' },
  { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' },
  { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' },
  { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' },
  { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' },
  { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
  { value: 'DC', label: 'District of Columbia' },
]

interface NewPatientModalProps {
  open: boolean
  onClose: () => void
}

const EMPTY_FORM: CreatePatientRequest = {
  firstName: '',
  lastName: '',
  phone: '',
  dob: '',
  email: '',
  gender: '',
  preferredLanguage: '',
  addressStreet: '',
  addressCity: '',
  addressState: '',
  addressZip: '',
  emergencyContactName: '',
  emergencyContactPhone: '',
  emergencyContactRelationship: '',
  primaryCareProvider: '',
  allergies: '',
  insuranceProvider: '',
  insuranceId: '',
  insuranceGroupNumber: '',
  insurancePolicyHolder: '',
  notes: '',
}

export function NewPatientModal({ open, onClose }: NewPatientModalProps) {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreatePatientRequest>({ ...EMPTY_FORM })
  const [errors, setErrors] = useState<Record<string, string>>({})

  const mutation = useMutation({
    mutationFn: createPatient,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-counts'] })
      toast('success', 'Patient created successfully.')
      setForm({ ...EMPTY_FORM })
      setErrors({})
      onClose()
    },
    onError: () => {
      toast('error', 'Failed to create patient. Please try again.')
    },
  })

  function updateField(field: keyof CreatePatientRequest, value: string) {
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
    // Strip empty strings to undefined for optional fields, keep required as-is
    const cleaned: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(form)) {
      cleaned[k] = v === '' ? undefined : v
    }
    // Ensure required fields stay as strings for validation
    cleaned.firstName = form.firstName
    cleaned.lastName = form.lastName
    cleaned.phone = form.phone

    const result = CreatePatientSchema.safeParse(cleaned)
    if (!result.success) {
      const fieldErrors: Record<string, string> = {}
      result.error.errors.forEach((e) => {
        const field = e.path[0] as string
        if (!fieldErrors[field]) fieldErrors[field] = e.message
      })
      setErrors(fieldErrors)
      return
    }
    mutation.mutate(result.data)
  }

  function handleClose() {
    setForm({ ...EMPTY_FORM })
    setErrors({})
    onClose()
  }

  return (
    <Modal open={open} onClose={handleClose} title="New Patient" size="lg">
      <div className="space-y-6">
        {/* Basic Information */}
        <fieldset>
          <legend className="text-sm font-semibold text-charcoal mb-3 uppercase tracking-wide">
            Basic Information
          </legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="First Name *"
              value={form.firstName}
              onChange={(e) => updateField('firstName', e.target.value)}
              error={errors.firstName}
              placeholder="John"
            />
            <Input
              label="Last Name *"
              value={form.lastName}
              onChange={(e) => updateField('lastName', e.target.value)}
              error={errors.lastName}
              placeholder="Smith"
            />
            <Input
              label="Date of Birth"
              type="date"
              value={form.dob || ''}
              onChange={(e) => updateField('dob', e.target.value)}
            />
            <Input
              label="Phone *"
              type="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              error={errors.phone}
              placeholder="(555) 000-0000"
            />
            <Input
              label="Email"
              type="email"
              value={form.email || ''}
              onChange={(e) => updateField('email', e.target.value)}
              error={errors.email}
              placeholder="patient@example.com"
            />
            <Select
              label="Gender"
              options={GENDER_OPTIONS}
              value={form.gender || ''}
              onChange={(e) => updateField('gender', e.target.value)}
            />
            <Select
              label="Preferred Language"
              options={LANGUAGE_OPTIONS}
              value={form.preferredLanguage || ''}
              onChange={(e) => updateField('preferredLanguage', e.target.value)}
            />
          </div>
        </fieldset>

        {/* Address */}
        <fieldset>
          <legend className="text-sm font-semibold text-charcoal mb-3 uppercase tracking-wide">
            Address
          </legend>
          <div className="space-y-4">
            <Input
              label="Street"
              value={form.addressStreet || ''}
              onChange={(e) => updateField('addressStreet', e.target.value)}
              placeholder="123 Main St"
            />
            <div className="grid sm:grid-cols-3 gap-4">
              <Input
                label="City"
                value={form.addressCity || ''}
                onChange={(e) => updateField('addressCity', e.target.value)}
              />
              <Select
                label="State"
                options={US_STATES}
                value={form.addressState || ''}
                onChange={(e) => updateField('addressState', e.target.value)}
              />
              <Input
                label="ZIP Code"
                value={form.addressZip || ''}
                onChange={(e) => updateField('addressZip', e.target.value)}
                error={errors.addressZip}
                placeholder="12345"
              />
            </div>
          </div>
        </fieldset>

        {/* Emergency Contact */}
        <fieldset>
          <legend className="text-sm font-semibold text-charcoal mb-3 uppercase tracking-wide">
            Emergency Contact
          </legend>
          <div className="grid sm:grid-cols-3 gap-4">
            <Input
              label="Name"
              value={form.emergencyContactName || ''}
              onChange={(e) => updateField('emergencyContactName', e.target.value)}
            />
            <Input
              label="Phone"
              type="tel"
              value={form.emergencyContactPhone || ''}
              onChange={(e) => updateField('emergencyContactPhone', e.target.value)}
            />
            <Input
              label="Relationship"
              value={form.emergencyContactRelationship || ''}
              onChange={(e) => updateField('emergencyContactRelationship', e.target.value)}
              placeholder="Spouse, Parent, etc."
            />
          </div>
        </fieldset>

        {/* Medical */}
        <fieldset>
          <legend className="text-sm font-semibold text-charcoal mb-3 uppercase tracking-wide">
            Medical
          </legend>
          <div className="space-y-4">
            <Input
              label="Primary Care Provider"
              value={form.primaryCareProvider || ''}
              onChange={(e) => updateField('primaryCareProvider', e.target.value)}
            />
            <TextArea
              label="Allergies"
              value={form.allergies || ''}
              onChange={(e) => updateField('allergies', e.target.value)}
              placeholder="List known allergies, or 'NKDA' for none"
            />
          </div>
        </fieldset>

        {/* Insurance */}
        <fieldset>
          <legend className="text-sm font-semibold text-charcoal mb-3 uppercase tracking-wide">
            Insurance
          </legend>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="Insurance Provider"
              value={form.insuranceProvider || ''}
              onChange={(e) => updateField('insuranceProvider', e.target.value)}
            />
            <Input
              label="Insurance ID"
              value={form.insuranceId || ''}
              onChange={(e) => updateField('insuranceId', e.target.value)}
            />
            <Input
              label="Group Number"
              value={form.insuranceGroupNumber || ''}
              onChange={(e) => updateField('insuranceGroupNumber', e.target.value)}
            />
            <Input
              label="Policy Holder"
              value={form.insurancePolicyHolder || ''}
              onChange={(e) => updateField('insurancePolicyHolder', e.target.value)}
              placeholder="Self, or name of policy holder"
            />
          </div>
        </fieldset>

        {/* Notes */}
        <fieldset>
          <legend className="text-sm font-semibold text-charcoal mb-3 uppercase tracking-wide">
            Notes
          </legend>
          <TextArea
            value={form.notes || ''}
            onChange={(e) => updateField('notes', e.target.value)}
            placeholder="Any additional notes about this patient"
          />
        </fieldset>

        {/* Actions */}
        <div className="flex gap-3 justify-end pt-4 border-t border-light-gray">
          <Button variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={mutation.isPending} icon={<UserPlus size={18} />}>
            Create Patient
          </Button>
        </div>
      </div>
    </Modal>
  )
}
