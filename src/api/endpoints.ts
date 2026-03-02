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
  CreatePatientRequest,
  CreateAppointmentRequest,
  AttachVoicemailRequest,
  UpdateTodoRequest,
  CreateNoteRequest,
  SendFaxRequest,
  UploadToS3Response,
  DashboardCounts,
} from './types'
import { apiGet, apiPost, apiPut, apiUpload } from './client'

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

// ── Todos ──────────────────────────────────────────────

export async function listTodos(): Promise<Todo[]> {
  return apiGet<Todo[]>('/todos')
}

export async function updateTodo(req: UpdateTodoRequest): Promise<Todo> {
  return apiPut<Todo>(`/todos/${req.id}`, req)
}

export async function createTodo(
  todo: Omit<Todo, 'id' | 'createdAt'>,
): Promise<Todo> {
  return apiPost<Todo>('/todos', todo)
}

// ── Notes ──────────────────────────────────────────────

export async function listNotes(patientId: string): Promise<Note[]> {
  return apiGet<Note[]>(`/patients/${patientId}/notes`)
}

export async function createNote(req: CreateNoteRequest): Promise<Note> {
  return apiPost<Note>(`/patients/${req.patientId}/notes`, req)
}

// ── Fax ────────────────────────────────────────────────

export async function listFaxes(): Promise<Fax[]> {
  return apiGet<Fax[]>('/faxes')
}

export async function sendFax(req: SendFaxRequest): Promise<Fax> {
  return apiPost<Fax>('/faxes', req)
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
