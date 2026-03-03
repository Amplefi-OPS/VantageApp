/**
 * API endpoints — all calls go to the real backend.
 * No demo mode / mock data.
 */

import type {
  Patient,
  Voicemail,
  CallLog,
  Todo,
  Note,
  Fax,
  RxDetails,
  CreatePatientRequest,
  CreateAppointmentRequest,
  AttachVoicemailRequest,
  UpdateTodoRequest,
  CreateNoteRequest,
  SendFaxRequest,
  UploadToS3Response,
  DashboardCounts,
} from './types'
import { apiGet, apiPost, apiPut, apiPatch, apiUpload } from './client'

// ── Dashboard ──────────────────────────────────────────

export async function getDashboardCounts(): Promise<DashboardCounts> {
  return apiGet<DashboardCounts>('/dashboard/counts')
}

// ── Patients ───────────────────────────────────────────

export async function listPatients(): Promise<Patient[]> {
  return apiGet<Patient[]>('/patients')
}

export async function getPatient(id: string): Promise<Patient | undefined> {
  return apiGet<Patient>(`/patients/${id}`)
}

export async function createPatient(req: CreatePatientRequest): Promise<Patient> {
  return apiPost<Patient>('/patients', req)
}

// ── Appointments ──────────────────────────────────────

export async function createAppointment(req: CreateAppointmentRequest) {
  return apiPost('/appointments', req)
}

// ── Voicemails (Zoom Phone) ─────────────────────────────

export async function listVoicemails(): Promise<Voicemail[]> {
  return apiGet<Voicemail[]>('/zoom/voicemails')
}

// ── Call Logs (Zoom Phone) ──────────────────────────────

export async function listCallLogs(): Promise<{ callLogs: CallLog[]; count: number }> {
  return apiGet<{ callLogs: CallLog[]; count: number }>('/zoom/call-logs')
}

export async function attachVoicemail(req: AttachVoicemailRequest): Promise<Voicemail> {
  return apiPost<Voicemail>('/voicemails/attach', req)
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

export async function listTodos(): Promise<Todo[]> {
  const res = await apiGet<{ tasks: TaskApiItem[]; count: number }>('/tasks')
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

// ── Notes ──────────────────────────────────────────────

export async function listNotes(patientId: string): Promise<Note[]> {
  return apiGet<Note[]>(`/patients/${patientId}/notes`)
}

export async function createNote(req: CreateNoteRequest): Promise<Note> {
  return apiPost<Note>(`/patients/${req.patientId}/notes`, req)
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
