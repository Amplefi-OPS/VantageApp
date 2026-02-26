import type { Patient, Voicemail, Todo, Note, Fax } from './types'

// Public domain sample audio
const SAMPLE_AUDIO = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3'

export const mockPatients: Patient[] = [
  { id: 'p1', firstName: 'Margaret', lastName: 'Thompson', phone: '(555) 201-1001', dob: '1952-03-14', createdAt: '2024-08-10T09:00:00Z' },
  { id: 'p2', firstName: 'Robert', lastName: 'Garcia', phone: '(555) 201-1002', dob: '1948-07-22', createdAt: '2024-08-12T10:30:00Z' },
  { id: 'p3', firstName: 'Dorothy', lastName: 'Williams', phone: '(555) 201-1003', dob: '1960-11-05', createdAt: '2024-09-01T08:15:00Z' },
  { id: 'p4', firstName: 'James', lastName: 'Anderson', phone: '(555) 201-1004', dob: '1955-01-30', createdAt: '2024-09-15T14:00:00Z' },
  { id: 'p5', firstName: 'Patricia', lastName: 'Martinez', phone: '(555) 201-1005', dob: '1963-09-18', createdAt: '2024-10-03T11:45:00Z' },
  { id: 'p6', firstName: 'William', lastName: 'Brown', phone: '(555) 201-1006', dob: '1970-05-12', createdAt: '2024-10-10T09:30:00Z' },
  { id: 'p7', firstName: 'Barbara', lastName: 'Davis', phone: '(555) 201-1007', dob: '1958-12-25', createdAt: '2024-10-20T16:00:00Z' },
  { id: 'p8', firstName: 'Richard', lastName: 'Wilson', phone: '(555) 201-1008', dob: '1945-04-08', createdAt: '2024-11-01T08:00:00Z' },
  { id: 'p9', firstName: 'Susan', lastName: 'Taylor', phone: '(555) 201-1009', dob: '1967-08-15', createdAt: '2024-11-15T13:20:00Z' },
  { id: 'p10', firstName: 'Charles', lastName: 'Johnson', phone: '(555) 201-1010', dob: '1972-02-28', createdAt: '2024-12-01T10:00:00Z' },
]

const now = new Date()
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600000).toISOString()
const daysAgo = (d: number) => new Date(now.getTime() - d * 86400000).toISOString()

export const mockVoicemails: Voicemail[] = [
  { id: 'vm1', callerNumber: '(555) 201-1001', callerName: 'Margaret Thompson', receivedAt: hoursAgo(1), category: 'Scheduling', durationSeconds: 45, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'patient', patientId: 'p1' }, status: 'Attached' },
  { id: 'vm2', callerNumber: '(555) 201-1002', callerName: 'Robert Garcia', receivedAt: hoursAgo(2), category: 'Refills', durationSeconds: 62, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'patient', patientId: 'p2' }, status: 'Attached' },
  { id: 'vm3', callerNumber: '(555) 300-4455', callerName: undefined, receivedAt: hoursAgo(3), category: 'Basic Questions', durationSeconds: 30, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'none' }, status: 'Unattached' },
  { id: 'vm4', callerNumber: '(555) 201-1003', callerName: 'Dorothy Williams', receivedAt: hoursAgo(4), category: 'Scheduling', durationSeconds: 55, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'patient', patientId: 'p3' }, status: 'Attached' },
  { id: 'vm5', callerNumber: '(555) 400-7788', callerName: undefined, receivedAt: hoursAgo(5), category: 'Everything Else', durationSeconds: 90, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'none' }, status: 'Unattached' },
  { id: 'vm6', callerNumber: '(555) 201-1005', callerName: 'Patricia Martinez', receivedAt: hoursAgo(8), category: 'Refills', durationSeconds: 40, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'patient', patientId: 'p5' }, status: 'Attached' },
  { id: 'vm7', callerNumber: '(555) 500-1122', callerName: undefined, receivedAt: hoursAgo(12), category: 'Scheduling', durationSeconds: 35, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'none' }, status: 'Unattached' },
  { id: 'vm8', callerNumber: '(555) 201-1008', callerName: 'Richard Wilson', receivedAt: daysAgo(1), category: 'Basic Questions', durationSeconds: 25, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'patient', patientId: 'p8' }, status: 'Attached' },
  { id: 'vm9', callerNumber: '(555) 600-3344', callerName: undefined, receivedAt: daysAgo(1), category: 'Refills', durationSeconds: 50, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'none' }, status: 'Unattached' },
  { id: 'vm10', callerNumber: '(555) 201-1010', callerName: 'Charles Johnson', receivedAt: daysAgo(2), category: 'Everything Else', durationSeconds: 78, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'patient', patientId: 'p10' }, status: 'Attached' },
  { id: 'vm11', callerNumber: '(555) 700-5566', callerName: undefined, receivedAt: daysAgo(2), category: 'Scheduling', durationSeconds: 42, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'none' }, status: 'Unattached' },
  { id: 'vm12', callerNumber: '(555) 201-1004', callerName: 'James Anderson', receivedAt: daysAgo(3), category: 'Basic Questions', durationSeconds: 33, audioUrl: SAMPLE_AUDIO, attachedTo: { type: 'patient', patientId: 'p4' }, status: 'Reviewed' },
]

export const mockTodos: Todo[] = [
  { id: 't1', patientId: 'p1', voicemailId: 'vm1', type: 'Schedule', title: 'Schedule appointment for Margaret Thompson', status: 'Open', priority: 'High', createdAt: hoursAgo(1), dueDate: daysAgo(-1) },
  { id: 't2', patientId: 'p2', voicemailId: 'vm2', type: 'Refill', title: 'Process refill for Robert Garcia', status: 'Open', priority: 'High', createdAt: hoursAgo(2) },
  { id: 't3', patientId: 'p3', voicemailId: 'vm4', type: 'Schedule', title: 'Schedule appointment for Dorothy Williams', status: 'Open', priority: 'Med', createdAt: hoursAgo(4), dueDate: daysAgo(-2) },
  { id: 't4', patientId: 'p5', voicemailId: 'vm6', type: 'Refill', title: 'Process refill for Patricia Martinez', status: 'Open', priority: 'Med', createdAt: hoursAgo(8) },
  { id: 't5', patientId: 'p8', voicemailId: 'vm8', type: 'CallBack', title: 'Call back Richard Wilson', notes: 'Asked about lab results', status: 'Open', priority: 'Low', createdAt: daysAgo(1) },
  { id: 't6', patientId: 'p10', voicemailId: 'vm10', type: 'General', title: 'Follow up with Charles Johnson', status: 'Open', priority: 'Low', createdAt: daysAgo(2) },
  { id: 't7', patientId: 'p4', voicemailId: 'vm12', type: 'CallBack', title: 'Call back James Anderson', status: 'Done', priority: 'Med', createdAt: daysAgo(3) },
  { id: 't8', patientId: 'p6', type: 'General', title: 'Send intake paperwork to William Brown', status: 'Open', priority: 'Med', createdAt: daysAgo(1), dueDate: daysAgo(0) },
  { id: 't9', patientId: 'p7', type: 'Schedule', title: 'Reschedule Barbara Davis annual checkup', status: 'Open', priority: 'High', createdAt: daysAgo(2), dueDate: daysAgo(-1) },
  { id: 't10', patientId: 'p9', type: 'Refill', title: 'Process refill for Susan Taylor', status: 'Done', priority: 'Med', createdAt: daysAgo(4) },
  { id: 't11', type: 'General', title: 'Order office supplies', status: 'Open', priority: 'Low', createdAt: daysAgo(5) },
  { id: 't12', patientId: 'p1', type: 'CallBack', title: 'Confirm insurance for Margaret Thompson', status: 'Open', priority: 'Med', createdAt: daysAgo(1), dueDate: daysAgo(0) },
  { id: 't13', patientId: 'p2', type: 'SendDocs', title: 'Send lab requisition to Robert Garcia', status: 'Open', priority: 'High', createdAt: daysAgo(1) },
  { id: 't14', patientId: 'p3', type: 'General', title: 'Update Dorothy Williams address', status: 'Done', priority: 'Low', createdAt: daysAgo(6) },
  { id: 't15', patientId: 'p5', type: 'Schedule', title: 'Schedule follow-up for Patricia Martinez', status: 'Open', priority: 'Med', createdAt: daysAgo(3), dueDate: daysAgo(-3) },
]

export const mockNotes: Note[] = [
  { id: 'n1', patientId: 'p1', createdAt: daysAgo(5), title: 'Annual Checkup', body: 'SUBJECTIVE:\nPatient reports feeling well overall. Mild knee pain on left side, worse with stairs.\n\nOBJECTIVE:\nBP: 128/82, HR: 72, Temp: 98.4F\nKnee exam: mild crepitus, full ROM.\n\nASSESSMENT:\nOsteoarthritis, left knee. Hypertension controlled.\n\nPLAN:\nContinue current medications. Recommend PT for knee. Follow up 3 months.' },
  { id: 'n2', patientId: 'p2', createdAt: daysAgo(10), title: 'Medication Review', body: 'Reviewed current medications with patient. Lisinopril 10mg daily - well tolerated. Added Metformin 500mg twice daily for newly diagnosed Type 2 DM. Discussed diet and exercise. Follow up in 6 weeks with labs.' },
  { id: 'n3', patientId: 'p3', createdAt: daysAgo(14), title: 'Follow-up Visit', body: 'Patient returns for blood pressure check. Reports compliance with medication. No side effects. BP today: 130/80. Continue current regimen. Next visit in 3 months.' },
  { id: 'n4', patientId: 'p1', createdAt: daysAgo(30), title: 'Phone Consultation', body: 'Patient called regarding knee pain. Advised ice, elevation, and OTC ibuprofen as needed. If not improving in 1 week, schedule office visit.' },
]

export const mockFaxes: Fax[] = [
  {
    id: 'f1', patientId: 'p2', createdAt: daysAgo(1), pharmacyName: 'CVS Pharmacy #4521', pharmacyFax: '(555) 800-0001', pharmacyPhone: '(555) 800-0002', status: 'Sent',
    rxDetails: { medication: 'Metformin 500mg', dosage: '500mg', directions: 'Take one tablet twice daily with meals', quantity: '60', refills: '5', prescriberName: 'Dr. Sarah Chen' },
  },
  {
    id: 'f2', patientId: 'p5', createdAt: daysAgo(2), pharmacyName: 'Walgreens #1234', pharmacyFax: '(555) 800-0003', status: 'Sent',
    rxDetails: { medication: 'Lisinopril 10mg', dosage: '10mg', directions: 'Take one tablet daily in the morning', quantity: '30', refills: '11', prescriberName: 'Dr. Sarah Chen' },
  },
  {
    id: 'f3', patientId: 'p1', createdAt: hoursAgo(6), pharmacyName: 'Rite Aid #789', pharmacyFax: '(555) 800-0005', pharmacyPhone: '(555) 800-0006', status: 'Queued',
    rxDetails: { medication: 'Ibuprofen 600mg', dosage: '600mg', directions: 'Take one tablet every 6 hours as needed for pain', quantity: '30', refills: '0', prescriberName: 'Dr. Sarah Chen' },
  },
  {
    id: 'f4', createdAt: daysAgo(5), pharmacyName: 'CVS Pharmacy #4521', pharmacyFax: '(555) 800-0001', status: 'Failed',
    rxDetails: { medication: 'Amoxicillin 500mg', dosage: '500mg', directions: 'Take one capsule three times daily for 10 days', quantity: '30', refills: '0', prescriberName: 'Dr. James Park' },
  },
]
