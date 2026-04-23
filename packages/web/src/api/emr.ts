/**
 * EMR API endpoints. Typed thin wrappers over emr-client.
 *
 * Response shapes mirror the Dynamo PROFILE / voicemail items (snake_case)
 * with infra keys stripped server-side. Any mapping to camelCase happens in
 * the components that consume these — not here, so grep-ability back to the
 * HHA source stays intact.
 */

import { emrGet, emrPost } from './emr-client'

export type EmrAddress = {
  line1?: string
  line2?: string
  city?: string
  state?: string
  zip?: string
}

export type EmrEmergencyContact = {
  name: string
  relationship?: string
  phone?: string
}

export type EmrPatient = {
  patient_id: string
  legacy_billing_id?: string
  source_system?: string
  first_name: string
  middle_name?: string
  last_name: string
  dob?: string
  sex?: 'F' | 'M' | 'X'
  email?: string
  email_ok?: boolean
  mobile_phone?: string
  home_phone?: string
  sms_ok?: boolean
  address?: EmrAddress
  timezone?: string
  assigned_provider?: string
  office_location?: string
  emergency_contacts?: EmrEmergencyContact[]
  notes?: string
  created_at?: string
  imported_at?: string
}

export type EmrVoicemail = {
  voicemail_id: string
  caller_id: string
  caller_id_raw?: string
  caller_name_cnam?: string
  received_at: string
  duration_seconds: number
  transcript?: string
  source?: string
  scenario?: string
  // attached-only
  patient_id?: string
  matched_by?: string
  matched_at?: string
  match_source?: 'auto' | 'manual'
}

type PatientsResponse = { patients: EmrPatient[]; nextToken: string | null }
type VoicemailsResponse = { voicemails: EmrVoicemail[]; nextToken: string | null }

export async function listUnmatchedVoicemails(): Promise<EmrVoicemail[]> {
  const res = await emrGet<VoicemailsResponse>('/voicemails?status=unmatched&limit=100')
  return res.voicemails
}

export type PatientSearchParams = {
  phone?: string
  email?: string
  dob?: string
  q?: string
}

export async function searchPatients(params: PatientSearchParams): Promise<EmrPatient[]> {
  const qs = new URLSearchParams()
  if (params.phone) qs.set('phone', params.phone)
  if (params.email) qs.set('email', params.email)
  if (params.dob) qs.set('dob', params.dob)
  if (params.q) qs.set('q', params.q)
  qs.set('limit', '25')
  const res = await emrGet<PatientsResponse>(`/patients?${qs.toString()}`)
  return res.patients
}

export async function getEmrPatient(id: string): Promise<EmrPatient> {
  return emrGet<EmrPatient>(`/patients/${id}`)
}

export async function attachVoicemail(
  voicemailId: string,
  patientId: string,
  matchSource: 'auto' | 'manual',
): Promise<EmrVoicemail> {
  const res = await emrPost<{ voicemail: EmrVoicemail }>(
    `/voicemails/${voicemailId}/attach`,
    { patient_id: patientId, match_source: matchSource },
  )
  return res.voicemail
}
