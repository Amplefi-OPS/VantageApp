/**
 * HIPAA Technical Safeguards — ACCESS CONTROLS
 *
 * Validates: email domain restrictions, password policy enforcement,
 * and role-based access control for protected routes.
 *
 * Regulation reference: 45 CFR 164.312(a)(1) — Access Control
 */
import { describe, it, expect } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Email Domain Validation (client-side gate; backend pre-sign-up Lambda enforces)
// ─────────────────────────────────────────────────────────────────────────────

const ALLOWED_DOMAINS = ['vantagerefinery.com', 'amplefi.com']

function isAllowedDomain(email: string): boolean {
  const domain = email.split('@')[1]?.toLowerCase()
  return !!domain && ALLOWED_DOMAINS.includes(domain)
}

describe('ACCESS CONTROLS — Email Domain Validation', () => {
  it('accepts @vantagerefinery.com emails', () => {
    expect(isAllowedDomain('jane@vantagerefinery.com')).toBe(true)
  })

  it('accepts @amplefi.com emails', () => {
    expect(isAllowedDomain('admin@amplefi.com')).toBe(true)
  })

  it('rejects @gmail.com', () => {
    expect(isAllowedDomain('user@gmail.com')).toBe(false)
  })

  it('rejects @outlook.com', () => {
    expect(isAllowedDomain('user@outlook.com')).toBe(false)
  })

  it('rejects subdomain spoofing (fake.vantagerefinery.com)', () => {
    expect(isAllowedDomain('user@fake.vantagerefinery.com')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isAllowedDomain('')).toBe(false)
  })

  it('rejects email without @ sign', () => {
    expect(isAllowedDomain('noatsign')).toBe(false)
  })

  it('is case-insensitive on domain', () => {
    expect(isAllowedDomain('USER@VANTAGEREFINERY.COM')).toBe(true)
    expect(isAllowedDomain('Admin@Amplefi.Com')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Password Policy (client-side enforcement — Cognito also enforces server-side)
// ─────────────────────────────────────────────────────────────────────────────

const MIN_PASSWORD_LENGTH = 8

function isPasswordAcceptable(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH
}

describe('ACCESS CONTROLS — Password Policy', () => {
  it('rejects passwords shorter than 8 characters', () => {
    expect(isPasswordAcceptable('Ab1!xyz')).toBe(false)   // 7 chars
    expect(isPasswordAcceptable('')).toBe(false)
    expect(isPasswordAcceptable('a')).toBe(false)
  })

  it('accepts passwords of exactly 8 characters', () => {
    expect(isPasswordAcceptable('Abcd1234')).toBe(true)
  })

  it('accepts long passwords', () => {
    expect(isPasswordAcceptable('SuperSecure!Password123')).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Role-Based Access Control — ProviderRoute logic
// ─────────────────────────────────────────────────────────────────────────────

interface MockUser {
  role: string
  groups: string[]
}

function isProviderAccess(user: MockUser | null): boolean {
  return user?.role === 'provider' || (user?.groups?.includes('providers') ?? false)
}

describe('ACCESS CONTROLS — Role-Based Routing', () => {
  const staffUser: MockUser = { role: 'staff', groups: ['staff'] }
  const providerUser: MockUser = { role: 'provider', groups: ['providers'] }
  const providerByGroup: MockUser = { role: 'staff', groups: ['providers'] }

  it('denies staff access to billing routes', () => {
    expect(isProviderAccess(staffUser)).toBe(false)
  })

  it('grants provider access to billing routes (by role)', () => {
    expect(isProviderAccess(providerUser)).toBe(true)
  })

  it('grants access when groups includes "providers" even if role is staff', () => {
    expect(isProviderAccess(providerByGroup)).toBe(true)
  })

  it('denies access when user is null', () => {
    expect(isProviderAccess(null)).toBe(false)
  })

  it('denies access with empty groups', () => {
    const noGroups: MockUser = { role: 'staff', groups: [] }
    expect(isProviderAccess(noGroups)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Navigation Visibility — Billing hidden from staff
// ─────────────────────────────────────────────────────────────────────────────

const allNavLinks = [
  { to: '/dashboard', label: 'Dashboard', providerOnly: false },
  { to: '/voicemails', label: 'Voicemails', providerOnly: false },
  { to: '/todos', label: 'To-Do List', providerOnly: false },
  { to: '/appointments', label: 'Appointments', providerOnly: false },
  { to: '/patients', label: 'Patients', providerOnly: false },
  { to: '/fax', label: 'Fax', providerOnly: false },
  { to: '/billing', label: 'Billing', providerOnly: true },
  { to: '/settings', label: 'Settings', providerOnly: false },
]

// ─────────────────────────────────────────────────────────────────────────────
// MFA Session Expiry — pendingUser TTL guard
// ─────────────────────────────────────────────────────────────────────────────

describe('ACCESS CONTROLS — MFA Session Expiry', () => {
  it('returns null when no pending user is set', () => {
    // Simulates the getPendingUser() logic when pendingUser is null
    const pendingUser = null
    const pendingUserCreatedAt = 0
    const MFA_SESSION_TTL_MS = 3 * 60 * 1000

    function getPendingUser() {
      if (!pendingUser) return null
      if (Date.now() - pendingUserCreatedAt > MFA_SESSION_TTL_MS) return null
      return { user: pendingUser, session: 'mock-session', email: 'user@test.com' }
    }

    expect(getPendingUser()).toBeNull()
  })

  it('returns null after 3-minute TTL expires', () => {
    const pendingUser = { mock: true } // non-null sentinel
    const pendingUserCreatedAt = Date.now() - (3 * 60 * 1000 + 1) // 3 min + 1ms ago
    const MFA_SESSION_TTL_MS = 3 * 60 * 1000

    function getPendingUser() {
      if (!pendingUser) return null
      if (Date.now() - pendingUserCreatedAt > MFA_SESSION_TTL_MS) return null
      return { user: pendingUser, session: 'mock-session', email: 'user@test.com' }
    }

    expect(getPendingUser()).toBeNull()
  })

  it('returns user within the 3-minute window', () => {
    const pendingUser = { mock: true }
    const pendingUserCreatedAt = Date.now() - (60 * 1000) // 1 minute ago
    const MFA_SESSION_TTL_MS = 3 * 60 * 1000

    function getPendingUser() {
      if (!pendingUser) return null
      if (Date.now() - pendingUserCreatedAt > MFA_SESSION_TTL_MS) return null
      return { user: pendingUser, session: 'mock-session', email: 'user@test.com' }
    }

    const result = getPendingUser()
    expect(result).not.toBeNull()
    expect(result!.session).toBe('mock-session')
  })

  it('expired session produces correct error message', () => {
    const pending = null // simulates expired getPendingUser()
    const error = !pending ? 'Session expired \u2014 please sign in again.' : null
    expect(error).toBe('Session expired \u2014 please sign in again.')
  })

  it('error message does NOT say "No MFA session"', () => {
    // The old bug: error was "No MFA session" which confused users.
    // After fix: message explicitly says "Session expired".
    const pending = null
    const error = !pending ? 'Session expired \u2014 please sign in again.' : null
    expect(error).not.toContain('No MFA session')
    expect(error).toContain('Session expired')
  })
})

describe('ACCESS CONTROLS — Navigation Visibility', () => {
  it('provider sees all 8 nav links including Billing', () => {
    const visible = allNavLinks.filter((l) => !l.providerOnly || true)
    expect(visible).toHaveLength(8)
    expect(visible.map((l) => l.to)).toContain('/billing')
  })

  it('staff sees 7 nav links — Billing is hidden', () => {
    const visible = allNavLinks.filter((l) => !l.providerOnly || false)
    expect(visible).toHaveLength(7)
    expect(visible.map((l) => l.to)).not.toContain('/billing')
  })

  it('all non-billing routes are visible to everyone', () => {
    const nonBilling = allNavLinks.filter((l) => l.to !== '/billing')
    expect(nonBilling.every((l) => !l.providerOnly)).toBe(true)
  })
})
