import { z } from 'zod'

// ── Enums ──────────────────────────────────────────────

export const VoicemailCategory = z.enum([
  'Scheduling',
  'Refills',
  'Basic Questions',
  'Everything Else',
])
export type VoicemailCategory = z.infer<typeof VoicemailCategory>

export const TodoType = z.enum([
  'Schedule',
  'Refill',
  'CallBack',
  'SendDocs',
  'General',
])
export type TodoType = z.infer<typeof TodoType>

export const TodoStatus = z.enum(['Open', 'Done'])
export type TodoStatus = z.infer<typeof TodoStatus>

export const Priority = z.enum(['Low', 'Med', 'High'])
export type Priority = z.infer<typeof Priority>

export const FaxStatus = z.enum(['Queued', 'Sent', 'Failed'])
export type FaxStatus = z.infer<typeof FaxStatus>

export const AttachmentType = z.enum(['none', 'patient', 'new_patient'])
export type AttachmentType = z.infer<typeof AttachmentType>

// ── Core models ────────────────────────────────────────

export const PatientSchema = z.object({
  id: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.string().optional(),
  phone: z.string(),
  email: z.string().optional(),
  gender: z.string().optional(),
  preferredLanguage: z.string().optional(),
  // Address
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  addressZip: z.string().optional(),
  // Emergency contact
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  // Medical
  primaryCareProvider: z.string().optional(),
  allergies: z.string().optional(),
  // Insurance
  insuranceProvider: z.string().optional(),
  insuranceId: z.string().optional(),
  insuranceGroupNumber: z.string().optional(),
  insurancePolicyHolder: z.string().optional(),
  // Notes
  notes: z.string().optional(),
  createdAt: z.string(),
})
export type Patient = z.infer<typeof PatientSchema>

export const VoicemailSchema = z.object({
  id: z.string(),
  callerNumber: z.string(),
  callerName: z.string().optional(),
  receivedAt: z.string(),
  category: VoicemailCategory,
  durationSeconds: z.number(),
  audioUrl: z.string(),
  attachedTo: z.object({
    type: AttachmentType,
    patientId: z.string().optional(),
  }),
  status: z.enum(['Unattached', 'Attached', 'Reviewed']),
})
export type Voicemail = z.infer<typeof VoicemailSchema>

export const TodoSchema = z.object({
  id: z.string(),
  patientId: z.string().optional(),
  voicemailId: z.string().optional(),
  type: TodoType,
  title: z.string(),
  notes: z.string().optional(),
  status: TodoStatus,
  priority: Priority,
  dueDate: z.string().optional(),
  assignedTo: z.string().optional(),
  createdAt: z.string(),
})
export type Todo = z.infer<typeof TodoSchema>

export const NoteSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  createdAt: z.string(),
  title: z.string(),
  body: z.string(),
})
export type Note = z.infer<typeof NoteSchema>

export const RxDetailsSchema = z.object({
  medication: z.string(),
  dosage: z.string(),
  directions: z.string(),
  quantity: z.string(),
  refills: z.string(),
  prescriberName: z.string(),
})
export type RxDetails = z.infer<typeof RxDetailsSchema>

export const FaxSchema = z.object({
  id: z.string(),
  patientId: z.string().optional(),
  createdAt: z.string(),
  pharmacyName: z.string(),
  pharmacyFax: z.string(),
  pharmacyPhone: z.string().optional(),
  status: FaxStatus,
  rxDetails: RxDetailsSchema,
  attachmentUrl: z.string().optional(),
})
export type Fax = z.infer<typeof FaxSchema>

// ── Settings ───────────────────────────────────────────

export interface AppSettings {
  officeName: string
  timezone: string
  staffList: string[]
  apiBaseUrl: string
  s3BucketName: string
  s3Region: string
  zoomPhoneNumber: string
  ivrMapping: Record<string, string>
}

// ── API request/response shapes ────────────────────────

export const CreatePatientSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  phone: z.string().min(1, 'Phone number is required'),
  dob: z.string().optional(),
  email: z.string().email('Invalid email address').optional().or(z.literal('')),
  gender: z.string().optional(),
  preferredLanguage: z.string().optional(),
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressState: z.string().optional(),
  addressZip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Invalid ZIP code').optional().or(z.literal('')),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  primaryCareProvider: z.string().optional(),
  allergies: z.string().optional(),
  insuranceProvider: z.string().optional(),
  insuranceId: z.string().optional(),
  insuranceGroupNumber: z.string().optional(),
  insurancePolicyHolder: z.string().optional(),
  notes: z.string().optional(),
})
export type CreatePatientRequest = z.infer<typeof CreatePatientSchema>

export interface AttachVoicemailRequest {
  voicemailId: string
  patientId: string
  isNewPatient: boolean
}

export interface UpdateTodoRequest {
  id: string
  status?: TodoStatus
  notes?: string
  assignedTo?: string
  dueDate?: string
  priority?: Priority
}

export interface CreateNoteRequest {
  patientId: string
  title: string
  body: string
}

export interface CreateAppointmentRequest {
  patientId?: string
  patientName: string
  type: 'in_office' | 'telehealth' | 'phone'
  startTime: string
  endTime: string
  reason: string
  notes?: string
  status?: string
}

export interface SendFaxRequest {
  patientId?: string
  pharmacyName: string
  pharmacyFax: string
  pharmacyPhone?: string
  rxDetails: RxDetails
  attachmentUrl?: string
}

export interface UploadToS3Request {
  file: File
  folder: string
}

export interface UploadToS3Response {
  url: string
  key: string
}

export interface DashboardCounts {
  unattachedVoicemails: number
  openTodos: number
  overdueTodos: number
  totalPatients: number
}
