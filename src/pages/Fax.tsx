import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Send,
  Plus,
  Upload,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  ArrowDownLeft,
  ArrowUpRight,
} from 'lucide-react'
import { listFaxes, listPatients, sendFax, uploadToS3 } from '../api/endpoints'
import type { SendFaxRequest } from '../api/types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { TextArea } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Tabs } from '../components/ui/Tabs'
import { useToast } from '../components/ui/Toast'
import { formatDateTime } from '../lib/utils'

const statusConfig = {
  Queued: { variant: 'yellow' as const, icon: Clock, label: 'Queued' },
  Sent: { variant: 'green' as const, icon: CheckCircle, label: 'Sent' },
  Failed: { variant: 'red' as const, icon: AlertCircle, label: 'Failed' },
}

const emptyForm: SendFaxRequest = {
  pharmacyName: '',
  pharmacyFax: '',
  pharmacyPhone: '',
  rxDetails: {
    medication: '',
    dosage: '',
    directions: '',
    quantity: '',
    refills: '',
    prescriberName: '',
  },
}

export default function Fax() {
  const { toast } = useToast()
  const queryClient = useQueryClient()
  const [tab, setTab] = useState('history')
  const [showCompose, setShowCompose] = useState(false)
  const [form, setForm] = useState<SendFaxRequest>({ ...emptyForm })
  const [file, setFile] = useState<File | null>(null)

  const { data: faxes, isLoading } = useQuery({
    queryKey: ['faxes'],
    queryFn: listFaxes,
  })

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: listPatients,
  })

  const sendMutation = useMutation({
    mutationFn: async () => {
      let attachmentUrl: string | undefined
      if (file) {
        const result = await uploadToS3(file, 'fax-attachments')
        attachmentUrl = result.url
      }
      return sendFax({ ...form, attachmentUrl })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['faxes'] })
      toast('success', 'Fax queued for sending!')
      setShowCompose(false)
      setForm({ ...emptyForm })
      setFile(null)
    },
    onError: () => toast('error', 'Failed to send fax. Please try again.'),
  })

  const updateRx = (field: string, value: string) => {
    setForm({
      ...form,
      rxDetails: { ...form.rxDetails, [field]: value },
    })
  }

  const statusCounts = {
    Queued: faxes?.filter((f) => f.status === 'Queued').length ?? 0,
    Sent: faxes?.filter((f) => f.status === 'Sent').length ?? 0,
    Failed: faxes?.filter((f) => f.status === 'Failed').length ?? 0,
    Inbound: faxes?.filter((f) => f.direction === 'inbound').length ?? 0,
  }

  const filtered = faxes?.filter((f) => {
    if (tab === 'history') return true
    if (tab === 'Inbound') return f.direction === 'inbound'
    return f.status === tab
  })

  const getPatientName = (patientId?: string) => {
    if (!patientId || !patients) return null
    const p = patients.find((p) => p.id === patientId)
    return p ? `${p.firstName} ${p.lastName}` : null
  }

  if (isLoading) return <LoadingSpinner />

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-charcoal">Fax</h1>
        <Button onClick={() => setShowCompose(true)} icon={<Plus size={18} />}>
          New Fax
        </Button>
      </div>

      <Tabs
        tabs={[
          { key: 'history', label: 'All', count: faxes?.length },
          { key: 'Inbound', label: 'Inbound', count: statusCounts.Inbound },
          { key: 'Queued', label: 'Queued', count: statusCounts.Queued },
          { key: 'Sent', label: 'Sent', count: statusCounts.Sent },
          { key: 'Failed', label: 'Failed', count: statusCounts.Failed },
        ]}
        active={tab}
        onChange={setTab}
      />

      <div className="mt-4 space-y-3">
        {filtered?.length === 0 && (
          <EmptyState
            icon={<Send size={48} />}
            title="No faxes"
            description="Faxes you send will appear here."
            action={
              <Button onClick={() => setShowCompose(true)} icon={<Plus size={18} />}>
                Send a Fax
              </Button>
            }
          />
        )}

        {filtered?.map((fax) => {
          const config = statusConfig[fax.status] || statusConfig.Sent
          const DirIcon = fax.direction === 'inbound' ? ArrowDownLeft : ArrowUpRight
          const dirColor = fax.direction === 'inbound' ? 'text-blue-500' : 'text-green-600'
          return (
            <Card key={fax.id}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <DirIcon size={16} className={dirColor} />
                    <span className="font-semibold text-charcoal">{fax.pharmacyName}</span>
                    <Badge variant={config.variant}>
                      <config.icon size={12} className="mr-1" />
                      {config.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-warm-gray">Fax: {fax.pharmacyFax}</p>
                  {fax.patientId && (
                    <p className="text-sm text-warm-gray">
                      Patient: {getPatientName(fax.patientId)}
                    </p>
                  )}
                  {fax.rxDetails ? (
                    <p className="text-sm text-charcoal mt-2">
                      <strong>Rx:</strong> {fax.rxDetails.medication} {fax.rxDetails.dosage}
                    </p>
                  ) : fax.pages ? (
                    <p className="text-sm text-charcoal mt-2">
                      <FileText size={14} className="inline mr-1" />
                      {fax.pages} page{fax.pages > 1 ? 's' : ''}
                    </p>
                  ) : (
                    <p className="text-sm text-warm-gray mt-2">Fax document</p>
                  )}
                  <p className="text-xs text-warm-gray mt-1">
                    {formatDateTime(fax.createdAt)}
                  </p>
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* Compose Fax Modal */}
      <Modal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        title="Send Fax"
        size="lg"
      >
        <div className="space-y-4">
          {/* Patient (optional) */}
          <Select
            label="Patient (optional)"
            placeholder="Select a patient..."
            options={
              patients?.map((p) => ({
                value: p.id,
                label: `${p.firstName} ${p.lastName}`,
              })) ?? []
            }
            value={form.patientId || ''}
            onChange={(e) => setForm({ ...form, patientId: e.target.value || undefined })}
          />

          <div className="border-t border-light-gray pt-4">
            <h3 className="font-semibold text-charcoal mb-3">Pharmacy</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <Input
                label="Pharmacy Name"
                placeholder="e.g. CVS Pharmacy"
                value={form.pharmacyName}
                onChange={(e) => setForm({ ...form, pharmacyName: e.target.value })}
              />
              <Input
                label="Fax Number"
                placeholder="(555) 000-0000"
                value={form.pharmacyFax}
                onChange={(e) => setForm({ ...form, pharmacyFax: e.target.value })}
                type="tel"
              />
              <Input
                label="Phone (optional)"
                placeholder="(555) 000-0000"
                value={form.pharmacyPhone || ''}
                onChange={(e) => setForm({ ...form, pharmacyPhone: e.target.value })}
                type="tel"
              />
            </div>
          </div>

          <div className="border-t border-light-gray pt-4">
            <h3 className="font-semibold text-charcoal mb-3">Prescription</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <Input
                label="Medication"
                placeholder="e.g. Lisinopril"
                value={form.rxDetails.medication}
                onChange={(e) => updateRx('medication', e.target.value)}
              />
              <Input
                label="Dosage"
                placeholder="e.g. 10mg"
                value={form.rxDetails.dosage}
                onChange={(e) => updateRx('dosage', e.target.value)}
              />
              <div className="sm:col-span-2">
                <Input
                  label="Directions"
                  placeholder="e.g. Take one tablet daily"
                  value={form.rxDetails.directions}
                  onChange={(e) => updateRx('directions', e.target.value)}
                />
              </div>
              <Input
                label="Quantity"
                placeholder="e.g. 30"
                value={form.rxDetails.quantity}
                onChange={(e) => updateRx('quantity', e.target.value)}
              />
              <Input
                label="Refills"
                placeholder="e.g. 5"
                value={form.rxDetails.refills}
                onChange={(e) => updateRx('refills', e.target.value)}
              />
              <div className="sm:col-span-2">
                <Input
                  label="Prescriber Name"
                  placeholder="e.g. Dr. Sarah Chen"
                  value={form.rxDetails.prescriberName}
                  onChange={(e) => updateRx('prescriberName', e.target.value)}
                />
              </div>
            </div>
          </div>

          {/* Attachment */}
          <div className="border-t border-light-gray pt-4">
            <h3 className="font-semibold text-charcoal mb-3">Attachment (optional)</h3>
            <label className="flex items-center gap-3 p-4 border-2 border-dashed border-light-gray rounded-lg cursor-pointer hover:border-slate-blue hover:bg-slate-blue/5 transition-colors min-h-[64px]">
              <Upload size={22} className="text-warm-gray" />
              <div>
                {file ? (
                  <span className="font-medium text-charcoal">{file.name}</span>
                ) : (
                  <>
                    <span className="font-medium text-charcoal">Upload PDF or image</span>
                    <p className="text-xs text-warm-gray">Click to choose a file</p>
                  </>
                )}
              </div>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          <div className="flex gap-3 justify-end pt-4 border-t border-light-gray">
            <Button variant="ghost" onClick={() => setShowCompose(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              loading={sendMutation.isPending}
              icon={<Send size={18} />}
              disabled={
                !form.pharmacyName ||
                !form.pharmacyFax ||
                !form.rxDetails.medication
              }
            >
              Send Fax
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
