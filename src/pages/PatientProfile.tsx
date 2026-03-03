import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowLeft,
  Phone,
  Calendar,
  Mic,
  FileText,
  ClipboardList,
  FolderOpen,
  User,
  Mail,
  MapPin,
  Heart,
  Shield,
  Languages,
  Stethoscope,
  AlertTriangle,
  StickyNote,
} from 'lucide-react'
import {
  getPatient,
  getPatientTodos,
  listNotes,
  listVoicemails,
  listPatientAppointments,
} from '../api/endpoints'
import type { Appointment } from '../api/types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Tabs } from '../components/ui/Tabs'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { formatDate, formatDateTime, formatDuration, timeAgo } from '../lib/utils'
import DictationMode from './DictationMode'

export default function PatientProfile() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [tab, setTab] = useState('overview')
  const [dictating, setDictating] = useState(false)

  const { data: patient, isLoading } = useQuery({
    queryKey: ['patient', id],
    queryFn: () => getPatient(id!),
    enabled: !!id,
  })

  const { data: allVoicemails } = useQuery({
    queryKey: ['voicemails'],
    queryFn: listVoicemails,
    enabled: tab === 'voicemails',
  })

  // Filter voicemails by matching patient phone number (normalize to digits for comparison)
  const normalizeDigits = (phone: string) => phone.replace(/\D/g, '').replace(/^1(\d{10})$/, '$1')
  const voicemails = allVoicemails?.filter((vm) => {
    if (!patient?.phone) return false
    const patientDigits = normalizeDigits(patient.phone)
    const callerDigits = normalizeDigits(vm.callerNumber)
    return patientDigits === callerDigits
  })

  const { data: todos } = useQuery({
    queryKey: ['patient-todos', id],
    queryFn: () => getPatientTodos(id!),
    enabled: !!id && tab === 'todos',
  })

  const { data: notes, refetch: refetchNotes } = useQuery({
    queryKey: ['patient-notes', id],
    queryFn: () => listNotes(id!),
    enabled: !!id && (tab === 'notes' || dictating),
  })

  const { data: appointments } = useQuery({
    queryKey: ['patient-appointments', patient?.phone],
    queryFn: () => listPatientAppointments(patient!.phone),
    enabled: !!patient?.phone && tab === 'appointments',
  })

  if (isLoading) return <LoadingSpinner />
  if (!patient) {
    return (
      <EmptyState
        icon={<User size={48} />}
        title="Patient not found"
        action={<Button onClick={() => navigate('/patients')}>Back to Patients</Button>}
      />
    )
  }

  if (dictating) {
    return (
      <DictationMode
        patientId={id!}
        patientName={`${patient.firstName} ${patient.lastName}`}
        onClose={() => {
          setDictating(false)
          refetchNotes()
        }}
      />
    )
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/patients')}
          className="p-2 rounded-lg hover:bg-light-gray transition-colors"
          aria-label="Back to patients"
        >
          <ArrowLeft size={22} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-charcoal">
            {patient.firstName} {patient.lastName}
          </h1>
          <p className="text-sm text-warm-gray">{patient.phone}</p>
        </div>
        <Button
          onClick={() => setDictating(true)}
          icon={<Mic size={18} />}
          size="lg"
        >
          Dictate Note
        </Button>
      </div>

      <Tabs
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'appointments', label: 'Appointments' },
          { key: 'voicemails', label: 'Voicemails' },
          { key: 'todos', label: 'To-Dos' },
          { key: 'notes', label: 'Notes' },
          { key: 'documents', label: 'Documents' },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-5">
        {/* Overview Tab */}
        {tab === 'overview' && (
          <Card>
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="w-16 h-16 rounded-full bg-slate-blue/10 text-slate-blue flex items-center justify-center text-2xl font-semibold">
                  {patient.firstName[0]}
                  {patient.lastName[0]}
                </div>
                <div>
                  <h2 className="text-xl font-semibold">
                    {patient.firstName} {patient.lastName}
                  </h2>
                </div>
              </div>
              <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-light-gray">
                <div className="flex items-center gap-3">
                  <Phone size={18} className="text-warm-gray" />
                  <div>
                    <p className="text-xs text-warm-gray">Phone</p>
                    <p className="font-medium">{patient.phone}</p>
                  </div>
                </div>
                {patient.dob && (
                  <div className="flex items-center gap-3">
                    <Calendar size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray">Date of Birth</p>
                      <p className="font-medium">{formatDate(patient.dob)}</p>
                    </div>
                  </div>
                )}
                {patient.email && (
                  <div className="flex items-center gap-3">
                    <Mail size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray">Email</p>
                      <p className="font-medium">{patient.email}</p>
                    </div>
                  </div>
                )}
                {patient.gender && (
                  <div className="flex items-center gap-3">
                    <User size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray">Gender</p>
                      <p className="font-medium">{patient.gender}</p>
                    </div>
                  </div>
                )}
                {patient.preferredLanguage && (
                  <div className="flex items-center gap-3">
                    <Languages size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray">Preferred Language</p>
                      <p className="font-medium">{patient.preferredLanguage}</p>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-3">
                  <User size={18} className="text-warm-gray" />
                  <div>
                    <p className="text-xs text-warm-gray">Patient Since</p>
                    <p className="font-medium">{formatDate(patient.createdAt)}</p>
                  </div>
                </div>
              </div>

              {/* Address */}
              {(patient.addressStreet || patient.addressCity) && (
                <div className="pt-4 border-t border-light-gray">
                  <div className="flex items-center gap-3">
                    <MapPin size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray">Address</p>
                      <p className="font-medium">
                        {[patient.addressStreet, patient.addressCity, patient.addressState, patient.addressZip]
                          .filter(Boolean)
                          .join(', ')}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Emergency Contact */}
              {patient.emergencyContactName && (
                <div className="pt-4 border-t border-light-gray">
                  <div className="flex items-center gap-3">
                    <Heart size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray">Emergency Contact</p>
                      <p className="font-medium">
                        {patient.emergencyContactName}
                        {patient.emergencyContactRelationship && ` (${patient.emergencyContactRelationship})`}
                      </p>
                      {patient.emergencyContactPhone && (
                        <p className="text-sm text-warm-gray">{patient.emergencyContactPhone}</p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Medical */}
              {(patient.primaryCareProvider || patient.allergies) && (
                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-light-gray">
                  {patient.primaryCareProvider && (
                    <div className="flex items-center gap-3">
                      <Stethoscope size={18} className="text-warm-gray" />
                      <div>
                        <p className="text-xs text-warm-gray">Primary Care Provider</p>
                        <p className="font-medium">{patient.primaryCareProvider}</p>
                      </div>
                    </div>
                  )}
                  {patient.allergies && (
                    <div className="flex items-center gap-3">
                      <AlertTriangle size={18} className="text-warm-gray" />
                      <div>
                        <p className="text-xs text-warm-gray">Allergies</p>
                        <p className="font-medium">{patient.allergies}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Insurance */}
              {patient.insuranceProvider && (
                <div className="grid sm:grid-cols-2 gap-4 pt-4 border-t border-light-gray">
                  <div className="flex items-center gap-3">
                    <Shield size={18} className="text-warm-gray" />
                    <div>
                      <p className="text-xs text-warm-gray">Insurance</p>
                      <p className="font-medium">{patient.insuranceProvider}</p>
                      {patient.insuranceId && (
                        <p className="text-sm text-warm-gray">ID: {patient.insuranceId}</p>
                      )}
                    </div>
                  </div>
                  {patient.insuranceGroupNumber && (
                    <div className="flex items-center gap-3">
                      <Shield size={18} className="text-warm-gray" />
                      <div>
                        <p className="text-xs text-warm-gray">Group / Policy Holder</p>
                        <p className="font-medium">{patient.insuranceGroupNumber}</p>
                        {patient.insurancePolicyHolder && (
                          <p className="text-sm text-warm-gray">{patient.insurancePolicyHolder}</p>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {patient.notes && (
                <div className="pt-4 border-t border-light-gray">
                  <div className="flex items-start gap-3">
                    <StickyNote size={18} className="text-warm-gray mt-0.5" />
                    <div>
                      <p className="text-xs text-warm-gray">Notes</p>
                      <p className="font-medium whitespace-pre-wrap">{patient.notes}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* Appointments Tab */}
        {tab === 'appointments' && (
          <>
            {!appointments || appointments.length === 0 ? (
              <EmptyState
                icon={<Calendar size={48} />}
                title="No appointments"
                description="No appointments found for this patient in Acuity Scheduling."
              />
            ) : (
              <div className="space-y-3">
                {appointments.map((appt: Appointment) => {
                  const isPast = new Date(appt.startTime) < new Date()
                  return (
                    <Card key={appt.id}>
                      <div className="flex items-center gap-2 mb-1">
                        <Badge
                          variant={
                            appt.status === 'cancelled'
                              ? 'gray'
                              : appt.status === 'no_show'
                                ? 'red'
                                : isPast
                                  ? 'green'
                                  : 'blue'
                          }
                        >
                          {appt.status === 'cancelled'
                            ? 'Cancelled'
                            : appt.status === 'no_show'
                              ? 'No Show'
                              : isPast
                                ? 'Completed'
                                : 'Scheduled'}
                        </Badge>
                        <Badge variant="gray">{appt.type}</Badge>
                      </div>
                      <p className="font-medium">
                        {new Date(appt.startTime).toLocaleDateString(undefined, {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </p>
                      <p className="text-sm text-warm-gray">
                        {new Date(appt.startTime).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        -{' '}
                        {new Date(appt.endTime).toLocaleTimeString([], {
                          hour: 'numeric',
                          minute: '2-digit',
                        })}{' '}
                        ({appt.duration} min)
                      </p>
                      {appt.notes && (
                        <p className="text-sm text-warm-gray mt-1 italic">{appt.notes}</p>
                      )}
                    </Card>
                  )
                })}
              </div>
            )}
          </>
        )}

        {/* Voicemails Tab */}
        {tab === 'voicemails' && (
          <>
            {!voicemails || voicemails.length === 0 ? (
              <EmptyState
                icon={<Phone size={48} />}
                title="No voicemails"
                description="No voicemails have been linked to this patient."
              />
            ) : (
              <div className="space-y-3">
                {voicemails.map((vm) => (
                  <Card key={vm.id}>
                    <div className="flex items-center gap-3">
                      <Badge
                        variant={
                          vm.category === 'Scheduling'
                            ? 'blue'
                            : vm.category === 'Refills'
                              ? 'green'
                              : vm.category === 'Basic Questions'
                                ? 'yellow'
                                : 'gray'
                        }
                      >
                        {vm.category}
                      </Badge>
                      <span className="text-sm text-warm-gray">{timeAgo(vm.receivedAt)}</span>
                      <span className="text-sm text-warm-gray">
                        {formatDuration(vm.durationSeconds)}
                      </span>
                    </div>
                    <audio
                      controls
                      src={vm.audioUrl}
                      className="mt-2 w-full h-10"
                      preload="none"
                    />
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Todos Tab */}
        {tab === 'todos' && (
          <>
            {!todos || todos.length === 0 ? (
              <EmptyState
                icon={<ClipboardList size={48} />}
                title="No to-dos"
                description="No to-dos are linked to this patient."
              />
            ) : (
              <div className="space-y-3">
                {todos.map((t) => (
                  <Card key={t.id}>
                    <div className="flex items-center gap-2 mb-1">
                      <Badge
                        variant={t.status === 'Done' ? 'green' : 'yellow'}
                      >
                        {t.status}
                      </Badge>
                      <Badge variant={t.priority === 'High' ? 'red' : t.priority === 'Med' ? 'yellow' : 'gray'}>
                        {t.priority}
                      </Badge>
                    </div>
                    <p className="font-medium">{t.title}</p>
                    {t.notes && <p className="text-sm text-warm-gray mt-1">{t.notes}</p>}
                    <p className="text-xs text-warm-gray mt-1">{formatDateTime(t.createdAt)}</p>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Notes Tab */}
        {tab === 'notes' && (
          <>
            <div className="mb-4">
              <Button
                onClick={() => setDictating(true)}
                icon={<Mic size={18} />}
              >
                Dictate New Note
              </Button>
            </div>
            {!notes || notes.length === 0 ? (
              <EmptyState
                icon={<FileText size={48} />}
                title="No notes yet"
                description="Use the Dictate button to create appointment notes."
                action={
                  <Button onClick={() => setDictating(true)} icon={<Mic size={18} />}>
                    Dictate Note
                  </Button>
                }
              />
            ) : (
              <div className="space-y-3">
                {notes.map((note) => (
                  <Card key={note.id}>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="font-semibold text-charcoal">{note.title}</h3>
                      <span className="text-xs text-warm-gray">{formatDate(note.createdAt)}</span>
                    </div>
                    <pre className="text-sm text-charcoal whitespace-pre-wrap font-sans leading-relaxed">
                      {note.body}
                    </pre>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {/* Documents Tab */}
        {tab === 'documents' && (
          <EmptyState
            icon={<FolderOpen size={48} />}
            title="Documents"
            description="Patient documents will appear here once the backend is connected."
          />
        )}
      </div>
    </div>
  )
}
