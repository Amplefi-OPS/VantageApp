import { useState } from 'react'
import { Search, CreditCard, DollarSign, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { lookupPatient, chargePatient, chargeNoShow } from '../../api/endpoints'
import type { BillingPatient } from '../../api/endpoints'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Modal } from '../../components/ui/Modal'

export default function StripeDashboard() {
  const [query, setQuery] = useState('')
  const [patient, setPatient] = useState<BillingPatient | null>(null)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')

  // Charge modal state
  const [showCharge, setShowCharge] = useState(false)
  const [chargeAmount, setChargeAmount] = useState('')
  const [chargeDesc, setChargeDesc] = useState('')
  const [charging, setCharging] = useState(false)
  const [chargeResult, setChargeResult] = useState<{ paymentIntentId: string; amount: number } | null>(null)
  const [chargeError, setChargeError] = useState('')

  // No-show modal state
  const [showNoShow, setShowNoShow] = useState(false)
  const [noShowLoading, setNoShowLoading] = useState(false)
  const [noShowResult, setNoShowResult] = useState(false)
  const [noShowError, setNoShowError] = useState('')

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearchError('')
    setPatient(null)
    try {
      const result = await lookupPatient(query.trim())
      setPatient(result)
    } catch (err: any) {
      setSearchError(err?.message || 'No patient found with that email or phone.')
    } finally {
      setSearching(false)
    }
  }

  const handleCharge = async () => {
    if (!patient?.paymentMethod) return
    const dollars = parseFloat(chargeAmount)
    if (isNaN(dollars) || dollars <= 0) return
    const cents = Math.round(dollars * 100)

    setCharging(true)
    setChargeError('')
    try {
      const result = await chargePatient(
        patient.customerId,
        patient.paymentMethod.id,
        cents,
        chargeDesc || undefined,
      )
      setChargeResult({ paymentIntentId: result.paymentIntentId, amount: cents })
    } catch (err: any) {
      setChargeError(err?.message || 'Payment failed. Please try again.')
    } finally {
      setCharging(false)
    }
  }

  const handleNoShow = async () => {
    if (!patient?.paymentMethod) return
    setNoShowLoading(true)
    setNoShowError('')
    try {
      await chargeNoShow(patient.customerId, patient.paymentMethod.id)
      setNoShowResult(true)
    } catch (err: any) {
      setNoShowError(err?.message || 'Failed to charge no-show fee.')
    } finally {
      setNoShowLoading(false)
    }
  }

  const resetChargeModal = () => {
    setShowCharge(false)
    setChargeAmount('')
    setChargeDesc('')
    setChargeResult(null)
    setChargeError('')
    setCharging(false)
  }

  const resetNoShowModal = () => {
    setShowNoShow(false)
    setNoShowResult(false)
    setNoShowError('')
    setNoShowLoading(false)
  }

  const parsedAmount = parseFloat(chargeAmount)
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal dark:text-white mb-6">Billing</h1>

      {/* Patient Search */}
      <form onSubmit={handleSearch} className="flex gap-3 mb-6">
        <div className="flex-1 relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-gray" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find patient by email or phone\u2026"
            className="w-full pl-10 pr-4 py-3 rounded-lg border border-light-gray dark:border-gray-600 text-base bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-slate-blue min-h-[48px]"
          />
        </div>
        <Button type="submit" disabled={searching || !query.trim()} icon={<Search size={18} />}>
          {searching ? 'Searching\u2026' : 'Search'}
        </Button>
      </form>

      {/* Loading */}
      {searching && (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={32} className="text-slate-blue animate-spin" />
        </div>
      )}

      {/* Search Error */}
      {searchError && !searching && (
        <Card>
          <div className="flex items-start gap-3 text-warm-gray dark:text-gray-400">
            <AlertCircle size={20} className="shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-charcoal dark:text-white">No patient found with that email or phone.</p>
              <p className="text-sm mt-1">Have them complete the booking form at vantagerefinery.com first.</p>
            </div>
          </div>
        </Card>
      )}

      {/* Patient Card */}
      {patient && !searching && (
        <Card>
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-charcoal dark:text-white">
                {patient.firstName} {patient.lastName}
              </h2>
              <div className="mt-2 space-y-1 text-sm text-warm-gray dark:text-gray-300">
                <p>Email: {patient.email}</p>
                <p>Phone: {patient.phone}</p>
              </div>
            </div>

            {patient.paymentMethod ? (
              <div className="flex items-center gap-2 p-3 bg-light-gray dark:bg-gray-700 rounded-lg">
                <CreditCard size={18} className="text-slate-blue" />
                <span className="text-sm text-charcoal dark:text-white font-medium">
                  {patient.paymentMethod.brand} ending in {patient.paymentMethod.last4}
                </span>
                <span className="text-xs text-warm-gray dark:text-gray-400 ml-1">
                  (exp {patient.paymentMethod.expMonth}/{patient.paymentMethod.expYear})
                </span>
              </div>
            ) : (
              <div className="flex items-center gap-2 p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg text-sm text-yellow-700 dark:text-yellow-300">
                <AlertCircle size={16} />
                No card on file
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button
                onClick={() => setShowCharge(true)}
                icon={<DollarSign size={18} />}
                disabled={!patient.paymentMethod}
              >
                Charge Patient
              </Button>
              <Button
                variant="ghost"
                onClick={() => setShowNoShow(true)}
                disabled={!patient.paymentMethod}
              >
                No-Show ($30)
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Charge Modal ── */}
      <Modal open={showCharge} onClose={resetChargeModal} title="Charge Patient" size="sm">
        {chargeResult ? (
          <div className="text-center py-4">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-charcoal dark:text-white">
              Payment of ${(chargeResult.amount / 100).toFixed(2)} processed successfully
            </p>
            <p className="text-xs text-warm-gray dark:text-gray-400 mt-2">
              {chargeResult.paymentIntentId}
            </p>
            <Button className="mt-4" onClick={resetChargeModal}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="text-sm text-warm-gray dark:text-gray-300">
              <p className="font-medium text-charcoal dark:text-white">
                {patient?.firstName} {patient?.lastName}
              </p>
              {patient?.paymentMethod && (
                <p className="mt-1">
                  Card: {patient.paymentMethod.brand} {'\u2022\u2022\u2022\u2022'} {patient.paymentMethod.last4}
                </p>
              )}
            </div>

            <Input
              label="Amount ($)"
              type="number"
              step="0.01"
              min="0.01"
              placeholder="0.00"
              value={chargeAmount}
              onChange={(e) => setChargeAmount(e.target.value)}
            />

            <Input
              label="Description (optional)"
              placeholder="e.g. Initial Consultation, Follow-up Visit"
              value={chargeDesc}
              onChange={(e) => setChargeDesc(e.target.value)}
            />

            {chargeError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{chargeError}</p>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={resetChargeModal} disabled={charging}>Cancel</Button>
              <Button
                onClick={handleCharge}
                loading={charging}
                disabled={!isValidAmount}
                icon={<DollarSign size={16} />}
              >
                Charge ${isValidAmount ? parsedAmount.toFixed(2) : '0.00'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* ── No-Show Modal ── */}
      <Modal open={showNoShow} onClose={resetNoShowModal} title="Charge No-Show Fee" size="sm">
        {noShowResult ? (
          <div className="text-center py-4">
            <CheckCircle size={48} className="text-green-500 mx-auto mb-3" />
            <p className="text-lg font-semibold text-charcoal dark:text-white">
              No-show fee of $30 charged to {patient?.firstName} {patient?.lastName}.
            </p>
            <Button className="mt-4" onClick={resetNoShowModal}>Done</Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="text-sm text-warm-gray dark:text-gray-300">
              A <strong className="text-charcoal dark:text-white">$30 no-show fee</strong> will be charged to{' '}
              <strong className="text-charcoal dark:text-white">{patient?.firstName} {patient?.lastName}</strong>&rsquo;s card on file:
            </p>
            {patient?.paymentMethod && (
              <div className="flex items-center gap-2 p-3 bg-light-gray dark:bg-gray-700 rounded-lg text-sm">
                <CreditCard size={16} className="text-slate-blue" />
                <span className="text-charcoal dark:text-white">
                  {patient.paymentMethod.brand} {'\u2022\u2022\u2022\u2022'} {patient.paymentMethod.last4}
                </span>
              </div>
            )}

            {noShowError && (
              <p className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 p-2 rounded">{noShowError}</p>
            )}

            <div className="flex gap-3 justify-end pt-2">
              <Button variant="ghost" onClick={resetNoShowModal} disabled={noShowLoading}>Cancel</Button>
              <Button
                variant="danger"
                onClick={handleNoShow}
                loading={noShowLoading}
              >
                Charge $30
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
