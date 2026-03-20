/**
 * HIPAA Technical Safeguards — INPUT VALIDATION
 *
 * Validates: Rx field validation (every field, every edge case),
 * sign-up form validation, and password confirmation matching.
 *
 * Regulation reference: 45 CFR 164.312(c)(1) — Integrity
 *                       45 CFR 164.312(e)(2)(i) — Integrity Controls
 */
import { describe, it, expect } from 'vitest'
import { validateRx } from '../lib/validateRx'
import type { RxDetails } from '../api/types'

// Helper: creates a valid Rx then overrides specific fields
function makeRx(overrides: Partial<RxDetails> = {}): RxDetails {
  return {
    medication: 'Lisinopril',
    dosage: '10mg',
    directions: 'Take one tablet daily',
    quantity: '30',
    refills: '3',
    prescriberName: 'Dr. Sarah Chen',
    ...overrides,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// validateRx — Medication
// ─────────────────────────────────────────────────────────────────────────────

describe('INPUT VALIDATION — Medication Field', () => {
  it('rejects empty medication', () => {
    const errors = validateRx(makeRx({ medication: '' }))
    expect(errors.medication).toBeDefined()
  })

  it('rejects single-character medication (min 2)', () => {
    const errors = validateRx(makeRx({ medication: 'X' }))
    expect(errors.medication).toBeDefined()
  })

  it('rejects whitespace-only medication', () => {
    const errors = validateRx(makeRx({ medication: '   ' }))
    expect(errors.medication).toBeDefined()
  })

  it('accepts 2-character medication name', () => {
    const errors = validateRx(makeRx({ medication: 'Rx' }))
    expect(errors.medication).toBeUndefined()
  })

  it('accepts normal medication name', () => {
    const errors = validateRx(makeRx({ medication: 'Amoxicillin' }))
    expect(errors.medication).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateRx — Dosage
// ─────────────────────────────────────────────────────────────────────────────

describe('INPUT VALIDATION — Dosage Field', () => {
  it('rejects empty dosage', () => {
    const errors = validateRx(makeRx({ dosage: '' }))
    expect(errors.dosage).toBeDefined()
  })

  it('rejects whitespace-only dosage', () => {
    const errors = validateRx(makeRx({ dosage: '   ' }))
    expect(errors.dosage).toBeDefined()
  })

  it('accepts valid dosage', () => {
    const errors = validateRx(makeRx({ dosage: '500mg' }))
    expect(errors.dosage).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateRx — Directions
// ─────────────────────────────────────────────────────────────────────────────

describe('INPUT VALIDATION — Directions Field', () => {
  it('rejects empty directions', () => {
    const errors = validateRx(makeRx({ directions: '' }))
    expect(errors.directions).toBeDefined()
  })

  it('rejects whitespace-only directions', () => {
    const errors = validateRx(makeRx({ directions: '  ' }))
    expect(errors.directions).toBeDefined()
  })

  it('accepts valid directions', () => {
    const errors = validateRx(makeRx({ directions: 'Take twice daily with food' }))
    expect(errors.directions).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateRx — Quantity
// ─────────────────────────────────────────────────────────────────────────────

describe('INPUT VALIDATION — Quantity Field', () => {
  it('rejects empty quantity', () => {
    const errors = validateRx(makeRx({ quantity: '' }))
    expect(errors.quantity).toBeDefined()
  })

  it('rejects non-numeric quantity ("thirty")', () => {
    const errors = validateRx(makeRx({ quantity: 'thirty' }))
    expect(errors.quantity).toBeDefined()
  })

  it('rejects mixed alphanumeric ("30pills")', () => {
    const errors = validateRx(makeRx({ quantity: '30pills' }))
    expect(errors.quantity).toBeDefined()
  })

  it('rejects decimal quantity ("30.5")', () => {
    const errors = validateRx(makeRx({ quantity: '30.5' }))
    expect(errors.quantity).toBeDefined()
  })

  it('rejects negative quantity', () => {
    const errors = validateRx(makeRx({ quantity: '-10' }))
    expect(errors.quantity).toBeDefined()
  })

  it('accepts valid numeric quantity', () => {
    const errors = validateRx(makeRx({ quantity: '90' }))
    expect(errors.quantity).toBeUndefined()
  })

  it('accepts single-digit quantity', () => {
    const errors = validateRx(makeRx({ quantity: '1' }))
    expect(errors.quantity).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateRx — Refills
// ─────────────────────────────────────────────────────────────────────────────

describe('INPUT VALIDATION — Refills Field', () => {
  it('rejects empty refills', () => {
    const errors = validateRx(makeRx({ refills: '' }))
    expect(errors.refills).toBeDefined()
  })

  it('rejects refills = 13 (max is 12)', () => {
    const errors = validateRx(makeRx({ refills: '13' }))
    expect(errors.refills).toBeDefined()
  })

  it('rejects refills = 99', () => {
    const errors = validateRx(makeRx({ refills: '99' }))
    expect(errors.refills).toBeDefined()
  })

  it('rejects negative refills', () => {
    const errors = validateRx(makeRx({ refills: '-1' }))
    expect(errors.refills).toBeDefined()
  })

  it('rejects fractional refills ("2.5")', () => {
    const errors = validateRx(makeRx({ refills: '2.5' }))
    expect(errors.refills).toBeDefined()
  })

  it('rejects non-numeric refills', () => {
    const errors = validateRx(makeRx({ refills: 'three' }))
    expect(errors.refills).toBeDefined()
  })

  it('accepts refills = 0 (no refills)', () => {
    const errors = validateRx(makeRx({ refills: '0' }))
    expect(errors.refills).toBeUndefined()
  })

  it('accepts refills = 12 (maximum)', () => {
    const errors = validateRx(makeRx({ refills: '12' }))
    expect(errors.refills).toBeUndefined()
  })

  it('accepts refills = 6 (mid-range)', () => {
    const errors = validateRx(makeRx({ refills: '6' }))
    expect(errors.refills).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateRx — Prescriber Name
// ─────────────────────────────────────────────────────────────────────────────

describe('INPUT VALIDATION — Prescriber Name Field', () => {
  it('rejects empty prescriber name', () => {
    const errors = validateRx(makeRx({ prescriberName: '' }))
    expect(errors.prescriberName).toBeDefined()
  })

  it('rejects whitespace-only prescriber name', () => {
    const errors = validateRx(makeRx({ prescriberName: '   ' }))
    expect(errors.prescriberName).toBeDefined()
  })

  it('accepts valid prescriber name', () => {
    const errors = validateRx(makeRx({ prescriberName: 'Dr. Jane Smith' }))
    expect(errors.prescriberName).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// validateRx — Full Valid Submission
// ─────────────────────────────────────────────────────────────────────────────

describe('INPUT VALIDATION — Valid Rx Returns Zero Errors', () => {
  it('fully valid Rx produces no errors', () => {
    const errors = validateRx(makeRx())
    expect(Object.keys(errors)).toHaveLength(0)
  })

  it('valid Rx with boundary values (refills=0, quantity=1, medication=2 chars)', () => {
    const errors = validateRx(makeRx({
      medication: 'Rx',
      quantity: '1',
      refills: '0',
    }))
    expect(Object.keys(errors)).toHaveLength(0)
  })

  it('valid Rx with upper-boundary refills (12)', () => {
    const errors = validateRx(makeRx({ refills: '12' }))
    expect(Object.keys(errors)).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Sign-Up Form Validation — Domain + Password
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = ['vantagerefinery.com', 'amplefi.com']

interface SignUpValidation {
  email: string
  password: string
  confirmPassword: string
}

function validateSignUp(input: SignUpValidation): string | null {
  const domain = input.email.split('@')[1]?.toLowerCase()
  if (!domain || !ALLOWED_DOMAINS.includes(domain)) {
    return 'Only @vantagerefinery.com and @amplefi.com email addresses are allowed.'
  }
  if (input.password !== input.confirmPassword) {
    return 'Passwords do not match'
  }
  if (input.password.length < 8) {
    return 'Password must be at least 8 characters'
  }
  return null // valid
}

describe('INPUT VALIDATION — Sign-Up Form', () => {
  it('rejects unauthorized email domain', () => {
    const err = validateSignUp({ email: 'user@gmail.com', password: 'Test1234!', confirmPassword: 'Test1234!' })
    expect(err).toContain('Only @vantagerefinery.com')
  })

  it('rejects mismatched passwords', () => {
    const err = validateSignUp({ email: 'user@vantagerefinery.com', password: 'Test1234!', confirmPassword: 'Different1!' })
    expect(err).toBe('Passwords do not match')
  })

  it('rejects short password (< 8 chars)', () => {
    const err = validateSignUp({ email: 'user@vantagerefinery.com', password: 'Abc1!', confirmPassword: 'Abc1!' })
    expect(err).toBe('Password must be at least 8 characters')
  })

  it('accepts valid sign-up input', () => {
    const err = validateSignUp({ email: 'jane@amplefi.com', password: 'Secure99!', confirmPassword: 'Secure99!' })
    expect(err).toBeNull()
  })

  it('domain check runs before password check', () => {
    // Bad domain AND short password — domain error should surface first
    const err = validateSignUp({ email: 'user@evil.com', password: 'short', confirmPassword: 'short' })
    expect(err).toContain('Only @vantagerefinery.com')
  })
})
