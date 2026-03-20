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
import { listFaxes, listAllPatients, sendFax, uploadToS3 } from '../api/endpoints'
import type { SendFaxRequest } from '../api/types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Modal } from '../components/ui/Modal'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingSpinner } from '../components/ui/LoadingSpinner'
import { Tabs } from '../components/ui/Tabs'
import { useToast } from '../components/ui/Toast'
import { formatDateTime } from '../lib/utils'
import { validateRx } from '../lib/validateRx'
import type { RxErrors } from '../lib/validateRx'

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
  const [showConfirm, setShowConfirm] = useState(false)
  const [form, setForm] = useState<SendFaxRequest>({ ...emptyForm })
  const [file, setFile] = useState<File | null>(null)
  const [rxErrors, setRxErrors] = useState<RxErrors>({})

  const { data: faxes, isLoading, isError } = useQuery({
    queryKey: ['faxes'],
    queryFn: listFaxes,
  })

  const { data: patients } = useQuery({
    queryKey: ['patients'],
    queryFn: listAllPatients,
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
      setShowConfirm(false)
      setShowCompose(false)
      setForm({ ...emptyForm })
      setFile(null)
      setRxErrors({})
    },
    onError: () => {
      setShowConfirm(false)
      toast('error', 'Failed to send fax. Please try again.')
    },
  })

  const updateRx = (field: string, value: string) => {
    setForm({
      ...form,
      rxDetails: { ...form.rxDetails, [field]: value },
    })
    // Clear error for this field on change
    if (rxErrors[field as keyof RxErrors]) {
      setRxErrors({ ...rxErrors, [field]: undefined })
    }
  }

  const handleSendClick = () => {
    const errors = validateRx(form.rxDetails)
    setRxErrors(errors)
    if (Object.keys(errors).length > 0) return
    setShowConfirm(true)
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
  if (isError) return <div className="text-center py-12 text-warm-gray dark:text-gray-400">Failed to load faxes. Please refresh.</div>

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-charcoal dark:text-white">Fax</h1>
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
                    <span className="font-semibold text-charcoal dark:text-white">{fax.pharmacyName}</span>
                    <Badge variant={config.variant}>
                      <config.icon size={12} className="mr-1" />
                      {config.label}
                    </Badge>
                  </div>
                  <p className="text-sm text-warm-gray dark:text-gray-300">Fax: {fax.pharmacyFax}</p>
                  {fax.patientId && (
                    <p className="text-sm text-warm-gray dark:text-gray-300">
                      Patient: {getPatientName(fax.patientId)}
                    </p>
                  )}
                  {fax.rxDetails ? (
                    <p className="text-sm text-charcoal dark:text-gray-100 mt-2">
                      <strong>Rx:</strong> {fax.rxDetails.medication} {fax.rxDetails.dosage}
                    </p>
                  ) : fax.pages ? (
                    <p className="text-sm text-charcoal dark:text-gray-100 mt-2">
                      <FileText size={14} className="inline mr-1" />
                      {fax.pages} page{fax.pages > 1 ? 's' : ''}
                    </p>
                  ) : (
                    <p className="text-sm text-warm-gray dark:text-gray-300 mt-2">Fax document</p>
                  )}
                  <p className="text-xs text-warm-gray dark:text-gray-300 mt-1">
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

          <div className="border-t border-light-gray dark:border-gray-700 pt-4">
            <h3 className="font-semibold text-charcoal dark:text-white mb-3">Pharmacy</h3>
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

          <div className="border-t border-light-gray dark:border-gray-700 pt-4">
            <h3 className="font-semibold text-charcoal dark:text-white mb-3">Prescription</h3>
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Input
                  label="Medication"
                  placeholder="e.g. Lisinopril"
                  value={form.rxDetails.medication}
                  onChange={(e) => updateRx('medication', e.target.value)}
                />
                {rxErrors.medication && (
                  <p className="text-xs text-red-600 mt-1">{rxErrors.medication}</p>
                )}
              </div>
              <div>
                <Input
                  label="Dosage"
                  placeholder="e.g. 10mg"
                  value={form.rxDetails.dosage}
                  onChange={(e) => updateRx('dosage', e.target.value)}
                />
                {rxErrors.dosage && (
                  <p className="text-xs text-red-600 mt-1">{rxErrors.dosage}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Directions"
                  placeholder="e.g. Take one tablet daily"
                  value={form.rxDetails.directions}
                  onChange={(e) => updateRx('directions', e.target.value)}
                />
                {rxErrors.directions && (
                  <p className="text-xs text-red-600 mt-1">{rxErrors.directions}</p>
                )}
              </div>
              <div>
                <Input
                  label="Quantity"
                  placeholder="e.g. 30"
                  value={form.rxDetails.quantity}
                  onChange={(e) => updateRx('quantity', e.target.value)}
                />
                {rxErrors.quantity && (
                  <p className="text-xs text-red-600 mt-1">{rxErrors.quantity}</p>
                )}
              </div>
              <div>
                <Input
                  label="Refills"
                  placeholder="e.g. 5"
                  value={form.rxDetails.refills}
                  onChange={(e) => updateRx('refills', e.target.value)}
                />
                {rxErrors.refills && (
                  <p className="text-xs text-red-600 mt-1">{rxErrors.refills}</p>
                )}
              </div>
              <div className="sm:col-span-2">
                <Input
                  label="Prescriber Name"
                  placeholder="e.g. Dr. Sarah Chen"
                  value={form.rxDetails.prescriberName}
                  onChange={(e) => updateRx('prescriberName', e.target.value)}
                />
                {rxErrors.prescriberName && (
                  <p className="text-xs text-red-600 mt-1">{rxErrors.prescriberName}</p>
                )}
              </div>
            </div>
          </div>

          {/* Attachment */}
          <div className="border-t border-light-gray dark:border-gray-700 pt-4">
            <h3 className="font-semibold text-charcoal dark:text-white mb-3">Attachment (optional)</h3>
            <label className="flex items-center gap-3 p-4 border-2 border-dashed border-light-gray dark:border-gray-600 rounded-lg cursor-pointer hover:border-slate-blue hover:bg-slate-blue/5 transition-colors min-h-[64px]">
              <Upload size={22} className="text-warm-gray" />
              <div>
                {file ? (
                  <span className="font-medium text-charcoal dark:text-white">{file.name}</span>
                ) : (
                  <>
                    <span className="font-medium text-charcoal dark:text-white">Upload PDF or image</span>
                    <p className="text-xs text-warm-gray dark:text-gray-300">Click to choose a file</p>
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

          <div className="flex gap-3 justify-end pt-4 border-t border-light-gray dark:border-gray-700">
            <Button variant="ghost" onClick={() => setShowCompose(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSendClick}
              icon={<Send size={18} />}
              disabled={!form.pharmacyName || !form.pharmacyFax}
            >
              Send Fax
            </Button>
          </div>
        </div>
      </Modal>

      {/* Fax Confirmation Modal */}
      <Modal
        open={showConfirm}
        onClose={() => setShowConfirm(false)}
        title="Confirm Fax"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-warm-gray dark:text-gray-300">
            Please review the details below before sending.
          </p>

          <div className="bg-off-white dark:bg-gray-700 rounded-lg p-4 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Pharmacy</span>
              <span className="font-medium text-charcoal dark:text-white">{form.pharmacyName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Fax Number</span>
              <span className="font-medium text-charcoal dark:text-white">{form.pharmacyFax}</span>
            </div>
            <hr className="border-light-gray dark:border-gray-600" />
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Medication</span>
              <span className="font-medium text-charcoal dark:text-white">{form.rxDetails.medication}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Dosage</span>
              <span className="font-medium text-charcoal dark:text-white">{form.rxDetails.dosage}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Directions</span>
              <span className="font-medium text-charcoal dark:text-white text-right max-w-[60%]">{form.rxDetails.directions}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Quantity</span>
              <span className="font-medium text-charcoal dark:text-white">{form.rxDetails.quantity}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Refills</span>
              <span className="font-medium text-charcoal dark:text-white">{form.rxDetails.refills}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-warm-gray dark:text-gray-400">Prescriber</span>
              <span className="font-medium text-charcoal dark:text-white">{form.rxDetails.prescriberName}</span>
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="ghost" onClick={() => setShowConfirm(false)} disabled={sendMutation.isPending}>
              Go Back
            </Button>
            <Button
              onClick={() => sendMutation.mutate()}
              loading={sendMutation.isPending}
              icon={<Send size={18} />}
            >
              Confirm &amp; Send
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
