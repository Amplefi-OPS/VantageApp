import type { RxDetails } from '../api/types'

export interface RxErrors {
  medication?: string
  dosage?: string
  directions?: string
  quantity?: string
  refills?: string
  prescriberName?: string
}

export function validateRx(rx: RxDetails): RxErrors {
  const errors: RxErrors = {}
  if (!rx.medication || rx.medication.trim().length < 2) {
    errors.medication = 'Medication name is required (min 2 characters)'
  }
  if (!rx.dosage || !rx.dosage.trim()) {
    errors.dosage = 'Dosage is required'
  }
  if (!rx.directions || !rx.directions.trim()) {
    errors.directions = 'Directions are required'
  }
  if (!rx.quantity || !rx.quantity.trim()) {
    errors.quantity = 'Quantity is required'
  } else if (!/^\d+$/.test(rx.quantity.trim())) {
    errors.quantity = 'Quantity must be a number'
  }
  if (rx.refills === undefined || rx.refills === null || rx.refills.toString().trim() === '') {
    errors.refills = 'Refills is required'
  } else {
    const refillNum = Number(rx.refills)
    if (!Number.isInteger(refillNum) || refillNum < 0 || refillNum > 12) {
      errors.refills = 'Refills must be 0\u201312'
    }
  }
  if (!rx.prescriberName || !rx.prescriberName.trim()) {
    errors.prescriberName = 'Prescriber name is required'
  }
  return errors
}
