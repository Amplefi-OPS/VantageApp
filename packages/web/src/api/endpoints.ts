/**
 * API endpoints — all calls go to the real backend.
 * No demo mode / mock data.
 */

import type {
  Patient,
  Voicemail,
  Todo,
  Note,
  Fax,
  Appointment,
  RxDetails,
  Email,
  CreatePatientRequest,
  AttachVoicemailRequest,
  AttachEmailRequest,
  UpdateTodoRequest,
  CreateNoteRequest,
  SendFaxRequest,
  UploadToS3Response,
  DashboardCounts,
  PracticeSettings,
} from './types'
import { apiGet, apiPost, apiPut, apiPatch, apiDelete, apiUpload } from './client'

// ── Dashboard ──────────────────────────────────────────

export async function getDashboardCounts(): Promise<DashboardCounts> {
  return apiGet<DashboardCounts>('/dashboard/counts')
}

export interface Pulse {
  weekStart: string
  weekEnd: string
  total: number
  done: number
  remaining: number
  newPatientCount: number
  newPatientPercent: number
}

export async function getPulse(): Promise<Pulse> {
  return apiGet<Pulse>('/pulse')
}

// ── Patients ───────────────────────────────────────────

export interface PaginatedPatients {
  patients: Patient[]
  nextToken?: string
}

export async function listPatients(nextToken?: string, limit = 25): Promise<PaginatedPatients> {
  const params = new URLSearchParams({ limit: String(limit) })
  if (nextToken) params.set('nextToken', nextToken)
  const res = await apiGet<Patient[] | { patients: Patient[]; nextToken?: string }>(`/patients?${params}`)
  console.log('[Patients] API response:', JSON.stringify(res).slice(0, 200))
  // Handle both array response (legacy) and paginated response
  if (Array.isArray(res)) {
    return { patients: res }
  }
  return { patients: res.patients ?? [], nextToken: res.nextToken }
}

export async function listAllPatients(): Promise<Patient[]> {
  const res = await listPatients(undefined, 1000)
  return res.patients
}

export async function getPatient(id: string): Promise<Patient | undefined> {
  return apiGet<Patient>(`/patients/${id}`)
}

export async function createPatient(req: CreatePatientRequest): Promise<Patient> {
  return apiPost<Patient>('/patients', req)
}

// ── Appointments (Google Calendar) ───────────────────

export async function listAppointments(date: string, rangeEnd?: string): Promise<Appointment[]> {
  const params = new URLSearchParams({ date })
  if (rangeEnd) params.set('range_end', rangeEnd)
  const res = await apiGet<{ appointments: Appointment[]; count: number }>(`/appointments?${params}`)
  return res.appointments
}

export async function listPatientAppointments(phone: string): Promise<Appointment[]> {
  const params = new URLSearchParams({ phone })
  const res = await apiGet<{ appointments: Appointment[]; count: number }>(`/appointments?${params}`)
  return res.appointments
}

export async function cancelAppointment(id: string): Promise<{ cancelled: boolean; appointmentId: string }> {
  return apiPut<{ cancelled: boolean; appointmentId: string }>(`/appointments/${id}/cancel`, {})
}

export async function markNoShow(id: string): Promise<{ noShow: boolean; appointmentId: string }> {
  return apiPut<{ noShow: boolean; appointmentId: string }>(`/appointments/${id}/no-show`, {})
}

export async function completeAppointment(id: string): Promise<{ completed: boolean; appointmentId: string }> {
  return apiPut<{ completed: boolean; appointmentId: string }>(`/appointments/${id}/complete`, {})
}

export async function createAppointment(req: {
  patientName: string
  patientPhone: string
  patientEmail?: string
  type: string
  startTime: string
  endTime: string
  notes?: string
}): Promise<{ appointmentId: string; patientName: string; type: string; startTime: string; endTime: string; calendarLink: string | null }> {
  return apiPost('/appointments', req)
}

export async function rescheduleAppointment(id: string, req: {
  startTime: string
  endTime: string
}): Promise<{ rescheduled: boolean; appointmentId: string; startTime: string; endTime: string }> {
  return apiPatch(`/appointments/${id}`, req)
}

// ── Voicemails (Zoom Phone) ─────────────────────────────

export async function listVoicemails(): Promise<Voicemail[]> {
  return apiGet<Voicemail[]>('/zoom/voicemails')
}

export async function attachVoicemail(req: AttachVoicemailRequest): Promise<Voicemail> {
  return apiPost<Voicemail>('/voicemails/attach', req)
}

export async function archiveVoicemail(voicemailId: string): Promise<void> {
  return apiPatch<void>(`/voicemails/${voicemailId}/archive`, {})
}

// ── Todos (backed by /tasks API) ───────────────────────

interface TaskApiItem {
  task_id: string
  provider_id: string
  patient_id: string | null
  voicemail_id: string | null
  type: string
  title: string
  status: string
  priority: string
  due_date: string | null
  assigned_to: string | null
  notes: string
  created_at: string
  updated_at: string
}

function mapTaskToTodo(t: TaskApiItem): Todo {
  return {
    id: t.task_id,
    patientId: t.patient_id || undefined,
    voicemailId: t.voicemail_id || undefined,
    type: t.type as Todo['type'],
    title: t.title,
    status: t.status as Todo['status'],
    priority: t.priority as Todo['priority'],
    dueDate: t.due_date || undefined,
    assignedTo: t.assigned_to || undefined,
    notes: t.notes || undefined,
    createdAt: t.created_at,
  }
}

export async function listTodos(filter?: { assignedTo?: string; status?: string }): Promise<Todo[]> {
  const params = new URLSearchParams()
  if (filter?.assignedTo) params.set('assigned_to', filter.assignedTo)
  if (filter?.status) params.set('status', filter.status)
  const qs = params.toString()
  const res = await apiGet<{ tasks: TaskApiItem[]; count: number }>(`/tasks${qs ? `?${qs}` : ''}`)
  if (!res?.tasks || !Array.isArray(res.tasks)) {
    console.error('listTodos: unexpected response shape', res)
    return []
  }
  return res.tasks.map(mapTaskToTodo)
}

export async function updateTodo(req: UpdateTodoRequest): Promise<Todo> {
  const body: Record<string, unknown> = {}
  if (req.status !== undefined) body.status = req.status
  if (req.notes !== undefined) body.notes = req.notes
  if (req.assignedTo !== undefined) body.assigned_to = req.assignedTo
  if (req.priority !== undefined) body.priority = req.priority
  if (req.dueDate !== undefined) body.due_date = req.dueDate

  const res = await apiPatch<TaskApiItem>(`/tasks/${req.id}`, body)
  return mapTaskToTodo(res)
}

export async function createTodo(
  todo: Omit<Todo, 'id' | 'createdAt'>,
): Promise<Todo> {
  const body = {
    type: todo.type,
    title: todo.title,
    status: todo.status || 'Open',
    priority: todo.priority || 'Med',
    patient_id: todo.patientId || null,
    voicemail_id: todo.voicemailId || null,
    due_date: todo.dueDate || null,
    assigned_to: todo.assignedTo || null,
    notes: todo.notes || '',
  }
  const res = await apiPost<TaskApiItem>('/tasks', body)
  return mapTaskToTodo(res)
}

// ── Emails (content@ inbox) ────────────────────────────

export async function listEmails(status: 'Unmatched' | 'Attached' | 'all' = 'Unmatched'): Promise<Email[]> {
  const res = await apiGet<{ emails: Email[]; count: number }>(`/emails?status=${encodeURIComponent(status)}`)
  return res.emails || []
}

export async function attachEmail(req: AttachEmailRequest): Promise<{
  emailId: string
  todoId: string
  status: string
  assignedTo: string | null
  patientId: string | null
  notified: boolean
}> {
  return apiPost('/emails/attach', req)
}

export async function archiveEmail(emailId: string): Promise<{ id: string; status: string }> {
  return apiPatch(`/emails/${emailId}/archive`, {})
}

// ── Notes ──────────────────────────────────────────────

export async function listNotes(patientId: string): Promise<Note[]> {
  return apiGet<Note[]>(`/patients/${patientId}/notes`)
}

export async function createNote(req: CreateNoteRequest): Promise<Note> {
  return apiPost<Note>(`/patients/${req.patientId}/notes`, req)
}

export async function deleteNote(patientId: string, noteId: string): Promise<void> {
  return apiDelete<void>(`/patients/${patientId}/notes/${noteId}`)
}

// ── Fax ────────────────────────────────────────────────

// The list-faxes Lambda returns a mix of Zoom-sourced and DB-sourced fax records.
// Fields use camelCase from the Lambda mapping layer.
interface FaxApiItem {
  id: string
  patientId?: string
  patient_id?: string
  pharmacyName: string
  pharmacy_name?: string
  pharmacyFax: string
  pharmacy_fax?: string
  pharmacyPhone?: string
  pharmacy_phone?: string
  status: string
  rxDetails?: RxDetails
  rx_details?: RxDetails
  attachmentUrl?: string
  attachment_url?: string
  direction?: 'inbound' | 'outbound'
  pages?: number
  createdAt?: string
  created_at?: string
}

function mapFaxItem(f: FaxApiItem): Fax {
  return {
    id: f.id,
    patientId: f.patientId || f.patient_id || undefined,
    pharmacyName: f.pharmacyName || f.pharmacy_name || '',
    pharmacyFax: f.pharmacyFax || f.pharmacy_fax || '',
    pharmacyPhone: f.pharmacyPhone || f.pharmacy_phone || undefined,
    status: (f.status as Fax['status']) || 'Queued',
    rxDetails: f.rxDetails || f.rx_details || undefined,
    attachmentUrl: f.attachmentUrl || f.attachment_url || undefined,
    direction: f.direction,
    pages: f.pages,
    createdAt: f.createdAt || f.created_at || new Date().toISOString(),
  }
}

export async function listFaxes(): Promise<Fax[]> {
  const res = await apiGet<FaxApiItem[]>('/faxes')
  return res.map(mapFaxItem)
}

export async function sendFax(req: SendFaxRequest): Promise<Fax> {
  const body = {
    pharmacy_name: req.pharmacyName,
    pharmacy_fax: req.pharmacyFax,
    pharmacy_phone: req.pharmacyPhone || null,
    patient_id: req.patientId || null,
    rx_details: req.rxDetails,
    attachment_url: req.attachmentUrl || null,
  }
  const res = await apiPost<FaxApiItem>('/faxes', body)
  return mapFaxItem(res)
}

// ── S3 Upload ──────────────────────────────────────────

export async function uploadToS3(
  file: File,
  folder: string,
): Promise<UploadToS3Response> {
  return apiUpload('/upload', file, folder)
}

// ── Patient voicemails & todos (filtered) ──────────────

export async function getPatientVoicemails(patientId: string): Promise<Voicemail[]> {
  return apiGet<Voicemail[]>(`/patients/${patientId}/voicemails`)
}

export async function getPatientTodos(patientId: string): Promise<Todo[]> {
  return apiGet<Todo[]>(`/patients/${patientId}/todos`)
}

// ── Dictations ────────────────────────────────────────

export interface DictationRecord {
  dictation_id: string
  provider_id: string
  patient_id: string | null
  status: 'Uploading' | 'Transcribing' | 'DraftReady' | 'TranscriptionFailed'
  note_type: string
  transcript_text: string | null
  confidence: number | null
  audio_url: string | null
  created_at: string
  updated_at: string
}

export async function listDictations(patientId?: string): Promise<DictationRecord[]> {
  const params = patientId ? `?patient_id=${patientId}` : ''
  const res = await apiGet<{ dictations: DictationRecord[]; count: number }>(`/dictations${params}`)
  return res.dictations || []
}

export async function presignDictationUpload(req: {
  providerId: string
  patientId?: string
  filename: string
  contentType: string
}): Promise<{ upload_url: string; dictation_id: string; object_key: string; expires_in: number }> {
  return apiPost('/uploads/presign', {
    provider_id: req.providerId,
    patient_id: req.patientId || null,
    filename: req.filename,
    content_type: req.contentType,
    note_type: 'progress_note',
    idempotency_key: crypto.randomUUID(),
  })
}

// ── Transcription (AWS Transcribe Medical) ──────────────

export async function getUploadUrl(format: 'webm' | 'wav' | 'mp4' | 'ogg'): Promise<{ uploadUrl: string; s3Key: string }> {
  return apiGet<{ uploadUrl: string; s3Key: string }>(`/transcription/upload-url?format=${format}`)
}

export async function startTranscription(
  s3Key: string,
  jobType: 'DICTATION' | 'VOICEMAIL',
  recordId?: string,
): Promise<{ jobName: string }> {
  return apiPost<{ jobName: string }>('/transcription/start', { s3Key, jobType, recordId })
}

export async function getTranscriptionResult(
  jobName: string,
  recordId?: string,
): Promise<{ status: string; transcript?: string }> {
  const params = new URLSearchParams({ jobName })
  if (recordId) params.set('recordId', recordId)
  return apiGet<{ status: string; transcript?: string }>(`/transcription/result?${params}`)
}

export async function transcribeVoicemail(
  voicemailId: string,
  audioUrl: string,
): Promise<{ jobName: string }> {
  // Extract s3Key from the full audio URL (everything after the bucket hostname)
  let s3Key: string
  try {
    const url = new URL(audioUrl)
    s3Key = url.pathname.slice(1) // remove leading /
  } catch {
    // Fallback: if audioUrl is already a relative path/key
    s3Key = audioUrl.startsWith('/') ? audioUrl.slice(1) : audioUrl
  }
  return startTranscription(s3Key, 'VOICEMAIL', voicemailId)
}

// ── Billing (Stripe) ────────────────────────────────────

export interface BillingPatient {
  customerId: string
  firstName: string
  lastName: string
  email: string
  phone: string
  paymentMethod: {
    id: string
    brand: string
    last4: string
    expMonth: number
    expYear: number
  } | null
}

export async function lookupPatient(q: string): Promise<BillingPatient> {
  return apiGet<BillingPatient>(`/billing/lookup?q=${encodeURIComponent(q)}`)
}

export async function chargePatient(
  customerId: string,
  paymentMethodId: string,
  amountCents: number,
  description?: string,
): Promise<{ paymentIntentId: string; status: string; amount: number }> {
  return apiPost('/billing/charge', {
    customerId,
    paymentMethodId,
    amountCents,
    description: description || undefined,
  })
}

export async function chargeNoShow(
  customerId: string,
  paymentMethodId: string,
): Promise<{ paymentIntentId: string; status: string; amount: number }> {
  return apiPost('/billing/no-show', { customerId, paymentMethodId })
}

export async function createPaymentIntentForCharge(
  customerId: string,
  amount: number,
  description?: string,
  saveCard?: boolean,
): Promise<{ clientSecret: string; paymentIntentId: string }> {
  return apiPost('/billing/payment-intent', { customerId, amount, description, saveCard })
}

// ── Practice Settings ──────────────────────────────────

export async function getPracticeSettings(): Promise<PracticeSettings> {
  return apiGet<PracticeSettings>('/settings/practice')
}

export async function updatePracticeSettings(settings: PracticeSettings): Promise<PracticeSettings> {
  return apiPut<PracticeSettings>('/settings/practice', settings)
}

// ── Notifications ──────────────────────────────────────

/** Fire-and-forget login failure report for Slack alerting. */
export function reportLoginFailure(email: string, reason: string): void {
  const url = `${import.meta.env.VITE_API_BASE_URL || '/api'}/notifications/login-failure`
  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, reason }),
  }).catch(() => {
    // Silent — never block the UI for notification failures
  })
}
