/**
 * API endpoints — each function either calls the real API client
 * or returns mock data when Demo Mode is on.
 *
 * Backend engineer: implement each of these HTTP endpoints.
 */

import { getSettings } from '../lib/settings'
import {
  mockPatients,
  mockVoicemails,
  mockTodos,
  mockNotes,
  mockFaxes,
} from './mock-data'
import type {
  Patient,
  Voicemail,
  Todo,
  Note,
  Fax,
  CreatePatientRequest,
  AttachVoicemailRequest,
  UpdateTodoRequest,
  CreateNoteRequest,
  SendFaxRequest,
  UploadToS3Response,
  DashboardCounts,
  TodoType,
} from './types'
import { apiGet, apiPost, apiPut, apiUpload } from './client'

// Simulated delay for mock responses
const delay = (ms = 400) => new Promise((r) => setTimeout(r, ms))

function isDemoMode(): boolean {
  return getSettings().demoMode
}

// ── Mutable mock state (lives in-memory for the session) ──

let patients = [...mockPatients]
let voicemails = [...mockVoicemails]
let todos = [...mockTodos]
let notes = [...mockNotes]
let faxes = [...mockFaxes]

let nextId = 100

function genId(prefix: string) {
  nextId++
  return `${prefix}${nextId}`
}

// ── Dashboard ──────────────────────────────────────────

export async function getDashboardCounts(): Promise<DashboardCounts> {
  if (isDemoMode()) {
    await delay(200)
    const today = new Date().toISOString().slice(0, 10)
    return {
      unattachedVoicemails: voicemails.filter((v) => v.attachedTo.type === 'none').length,
      openTodos: todos.filter((t) => t.status === 'Open').length,
      overdueTodos: todos.filter(
        (t) => t.status === 'Open' && t.dueDate && t.dueDate.slice(0, 10) < today,
      ).length,
      totalPatients: patients.length,
    }
  }
  return apiGet<DashboardCounts>('/dashboard/counts')
}

// ── Patients ───────────────────────────────────────────

export async function listPatients(): Promise<Patient[]> {
  if (isDemoMode()) {
    await delay()
    return [...patients].sort((a, b) => a.lastName.localeCompare(b.lastName))
  }
  return apiGet<Patient[]>('/patients')
}

export async function getPatient(id: string): Promise<Patient | undefined> {
  if (isDemoMode()) {
    await delay(200)
    return patients.find((p) => p.id === id)
  }
  return apiGet<Patient>(`/patients/${id}`)
}

export async function createPatient(req: CreatePatientRequest): Promise<Patient> {
  if (isDemoMode()) {
    await delay()
    const p: Patient = {
      id: genId('p'),
      firstName: req.firstName,
      lastName: req.lastName,
      phone: req.phone,
      dob: req.dob,
      createdAt: new Date().toISOString(),
    }
    patients.push(p)
    return p
  }
  return apiPost<Patient>('/patients', req)
}

// ── Voicemails ─────────────────────────────────────────

export async function listVoicemails(): Promise<Voicemail[]> {
  if (isDemoMode()) {
    await delay()
    return [...voicemails].sort(
      (a, b) => new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime(),
    )
  }
  return apiGet<Voicemail[]>('/voicemails')
}

export async function attachVoicemail(req: AttachVoicemailRequest): Promise<Voicemail> {
  if (isDemoMode()) {
    await delay()
    const vm = voicemails.find((v) => v.id === req.voicemailId)
    if (!vm) throw new Error('Voicemail not found')
    vm.attachedTo = {
      type: req.isNewPatient ? 'new_patient' : 'patient',
      patientId: req.patientId,
    }
    vm.status = 'Attached'

    // Auto-generate todo
    const patient = patients.find((p) => p.id === req.patientId)
    const name = patient ? `${patient.firstName} ${patient.lastName}` : 'Patient'
    const categoryMap: Record<string, { type: TodoType; title: string }> = {
      Scheduling: { type: 'Schedule', title: `Schedule appointment for ${name}` },
      Refills: { type: 'Refill', title: `Process refill for ${name}` },
      'Basic Questions': { type: 'CallBack', title: `Call back ${name}` },
      'Everything Else': { type: 'General', title: `Follow up with ${name}` },
    }
    const info = categoryMap[vm.category] || categoryMap['Everything Else']
    const todo: Todo = {
      id: genId('t'),
      patientId: req.patientId,
      voicemailId: vm.id,
      type: info.type,
      title: info.title,
      status: 'Open',
      priority: 'Med',
      createdAt: new Date().toISOString(),
    }
    todos.push(todo)

    return vm
  }
  return apiPost<Voicemail>('/voicemails/attach', req)
}

// ── Todos ──────────────────────────────────────────────

export async function listTodos(): Promise<Todo[]> {
  if (isDemoMode()) {
    await delay()
    return [...todos].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }
  return apiGet<Todo[]>('/todos')
}

export async function updateTodo(req: UpdateTodoRequest): Promise<Todo> {
  if (isDemoMode()) {
    await delay(300)
    const t = todos.find((t) => t.id === req.id)
    if (!t) throw new Error('Todo not found')
    if (req.status !== undefined) t.status = req.status
    if (req.notes !== undefined) t.notes = req.notes
    if (req.assignedTo !== undefined) t.assignedTo = req.assignedTo
    if (req.dueDate !== undefined) t.dueDate = req.dueDate
    if (req.priority !== undefined) t.priority = req.priority
    return { ...t }
  }
  return apiPut<Todo>(`/todos/${req.id}`, req)
}

export async function createTodo(
  todo: Omit<Todo, 'id' | 'createdAt'>,
): Promise<Todo> {
  if (isDemoMode()) {
    await delay()
    const t: Todo = {
      ...todo,
      id: genId('t'),
      createdAt: new Date().toISOString(),
    }
    todos.push(t)
    return t
  }
  return apiPost<Todo>('/todos', todo)
}

// ── Notes ──────────────────────────────────────────────

export async function listNotes(patientId: string): Promise<Note[]> {
  if (isDemoMode()) {
    await delay(300)
    return notes
      .filter((n) => n.patientId === patientId)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
  }
  return apiGet<Note[]>(`/patients/${patientId}/notes`)
}

export async function createNote(req: CreateNoteRequest): Promise<Note> {
  if (isDemoMode()) {
    await delay()
    const n: Note = {
      id: genId('n'),
      patientId: req.patientId,
      title: req.title,
      body: req.body,
      createdAt: new Date().toISOString(),
    }
    notes.push(n)
    return n
  }
  return apiPost<Note>(`/patients/${req.patientId}/notes`, req)
}

// ── Fax ────────────────────────────────────────────────

export async function listFaxes(): Promise<Fax[]> {
  if (isDemoMode()) {
    await delay()
    return [...faxes].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    )
  }
  return apiGet<Fax[]>('/faxes')
}

export async function sendFax(req: SendFaxRequest): Promise<Fax> {
  if (isDemoMode()) {
    await delay(800)
    const f: Fax = {
      id: genId('f'),
      patientId: req.patientId,
      createdAt: new Date().toISOString(),
      pharmacyName: req.pharmacyName,
      pharmacyFax: req.pharmacyFax,
      pharmacyPhone: req.pharmacyPhone,
      status: 'Queued',
      rxDetails: req.rxDetails,
      attachmentUrl: req.attachmentUrl,
    }
    faxes.push(f)
    return f
  }
  return apiPost<Fax>('/faxes', req)
}

// ── S3 Upload ──────────────────────────────────────────

export async function uploadToS3(
  file: File,
  folder: string,
): Promise<UploadToS3Response> {
  if (isDemoMode()) {
    await delay(600)
    // Simulate an S3 URL
    const key = `${folder}/${Date.now()}-${file.name}`
    return {
      url: `https://vantage-demo-bucket.s3.us-east-1.amazonaws.com/${key}`,
      key,
    }
  }
  return apiUpload('/upload', file, folder)
}

// ── Patient voicemails & todos (filtered) ──────────────

export async function getPatientVoicemails(patientId: string): Promise<Voicemail[]> {
  if (isDemoMode()) {
    await delay(200)
    return voicemails.filter((v) => v.attachedTo.patientId === patientId)
  }
  return apiGet<Voicemail[]>(`/patients/${patientId}/voicemails`)
}

export async function getPatientTodos(patientId: string): Promise<Todo[]> {
  if (isDemoMode()) {
    await delay(200)
    return todos.filter((t) => t.patientId === patientId)
  }
  return apiGet<Todo[]>(`/patients/${patientId}/todos`)
}
