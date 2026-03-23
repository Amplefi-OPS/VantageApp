import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import {
  signIn as cognitoSignIn,
  signUp as cognitoSignUp,
  confirmSignUp as cognitoConfirmSignUp,
  completeMfaChallenge,
  completeNewPasswordChallenge,
  changePassword as cognitoChangePassword,
  signOut as cognitoSignOut,
  getCurrentUser,
  isAuthenticated,
  getTokensAsync,
  getPendingUser,
  clearPendingUser,
  type AuthUser,
} from './cognito'
import { queryClient } from '../lib/queryClient'

// HIPAA: Inactivity timeout (5 minutes)
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000
const INACTIVITY_WARNING_MS = 3 * 60 * 1000

interface AuthContextValue {
  user: AuthUser | null
  isLoggedIn: boolean
  isLoading: boolean
  mfaRequired: boolean
  newPasswordRequired: boolean
  signUpMode: boolean
  confirmationPending: boolean
  showInactivityWarning: boolean
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  setNewPassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>
  verifyMfa: (code: string) => Promise<{ success: boolean; error?: string }>
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ success: boolean; error?: string }>
  confirmSignUp: (code: string) => Promise<{ success: boolean; error?: string }>
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  setSignUpMode: (mode: boolean) => void
  extendSession: () => void
  logout: () => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [mfaRequired, setMfaRequired] = useState(false)
  const [newPasswordRequired, setNewPasswordRequired] = useState(false)
  const [signUpMode, setSignUpMode] = useState(false)
  const [confirmationPending, setConfirmationPending] = useState(false)
  const [showInactivityWarning, setShowInactivityWarning] = useState(false)
  const [pendingSignUpEmail, setPendingSignUpEmail] = useState('')

  // Challenge context — challengeName for routing, pendingEmail for display
  const [challengeName, setChallengeName] = useState<string>('')
  const [pendingEmail, setPendingEmail] = useState('')

  // Inactivity tracking refs
  const inactivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const warningVisibleRef = useRef(false)

  // ── Inactivity Timeout (HIPAA requirement) ──
  const resetInactivityTimer = useCallback(() => {
    if (!user) return

    // Don't reset while warning is showing — user must click Stay/Sign Out
    if (warningVisibleRef.current) return

    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)

    // Show warning at 3 minutes
    warningTimerRef.current = setTimeout(() => {
      warningVisibleRef.current = true
      setShowInactivityWarning(true)
    }, INACTIVITY_WARNING_MS)

    // Auto-logout at 5 minutes
    inactivityTimerRef.current = setTimeout(() => {
      performLogout()
    }, INACTIVITY_TIMEOUT_MS)
  }, [user])

  useEffect(() => {
    if (!user) return

    const events = ['mousedown', 'keydown', 'touchstart', 'scroll']
    const handler = () => resetInactivityTimer()

    events.forEach((e) => window.addEventListener(e, handler, { passive: true }))
    resetInactivityTimer()

    return () => {
      events.forEach((e) => window.removeEventListener(e, handler))
      if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
      if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    }
  }, [user, resetInactivityTimer])

  // ── Token Refresh Interval ──
  useEffect(() => {
    if (!user) return

    // Check token validity every 5 minutes and auto-refresh if needed
    const interval = setInterval(async () => {
      const tokens = await getTokensAsync()
      if (!tokens) {
        // Refresh failed — session expired
        performLogout()
      }
    }, 5 * 60 * 1000)

    return () => clearInterval(interval)
  }, [user])

  // ── MFA Session Timeout (3 minutes) ──
  // If the user sits on the MFA screen too long, the Cognito challenge session
  // expires server-side. Clear local state and return to login.
  useEffect(() => {
    if (!mfaRequired) return

    const timeout = setTimeout(() => {
      clearPendingUser()
      setMfaRequired(false)
      setChallengeName('')
      setPendingEmail('')
    }, 3 * 60 * 1000) // 3 minutes

    return () => clearTimeout(timeout)
  }, [mfaRequired])

  // Check existing session on mount
  useEffect(() => {
    if (isAuthenticated()) {
      setUser(getCurrentUser())
    }
    setIsLoading(false)
  }, [])

  const performLogout = useCallback(async () => {
    warningVisibleRef.current = false
    if (warningTimerRef.current) clearTimeout(warningTimerRef.current)
    if (inactivityTimerRef.current) clearTimeout(inactivityTimerRef.current)
    await cognitoSignOut()
    queryClient.clear()
    setUser(null)
    setMfaRequired(false)
    setNewPasswordRequired(false)
    setSignUpMode(false)
    setConfirmationPending(false)
    setPendingSignUpEmail('')
    setPendingEmail('')
    setChallengeName('')
    setShowInactivityWarning(false)
    window.history.replaceState(null, '', '/dashboard')
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const result = await cognitoSignIn(email, password)

      if (result.type === 'NEW_PASSWORD_REQUIRED') {
        setNewPasswordRequired(true)
        setPendingEmail(email)
        setIsLoading(false)
        return { success: false, error: 'New password required' }
      }

      if (result.type === 'MFA_REQUIRED') {
        setMfaRequired(true)
        setChallengeName(result.challengeName || 'CUSTOM_CHALLENGE')
        setPendingEmail(email)
        setIsLoading(false)
        return { success: false, error: 'MFA required' }
      }

      if (result.type === 'ERROR') {
        setIsLoading(false)
        return { success: false, error: result.error }
      }

      // SUCCESS — should not happen (HIPAA: MFA mandatory), but handle gracefully
      setIsLoading(false)
      return { success: false, error: result.error || 'Unexpected authentication result.' }
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [])

  const setNewPassword = useCallback(async (newPassword: string) => {
    const pending = getPendingUser()
    if (!pending) return { success: false, error: 'Session expired \u2014 please sign in again.' }
    setIsLoading(true)
    try {
      const result = await completeNewPasswordChallenge(pending.email, newPassword, '')
      if (result.type === 'MFA_REQUIRED') {
        setNewPasswordRequired(false)
        setMfaRequired(true)
        setChallengeName(result.challengeName || 'CUSTOM_CHALLENGE')
        setIsLoading(false)
        return { success: false, error: 'MFA required' }
      }
      if (result.type === 'ERROR') {
        setIsLoading(false)
        return { success: false, error: result.error }
      }
      setIsLoading(false)
      return { success: false, error: result.error || 'Unexpected result.' }
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [])

  const verifyMfa = useCallback(async (code: string) => {
    // Read from module-level pendingCognitoUser (survives re-renders).
    const pending = getPendingUser()
    if (!pending) {
      setMfaRequired(false)
      setChallengeName('')
      setPendingEmail('')
      return { success: false, error: 'Session expired \u2014 please sign in again.' }
    }

    const activeChallenge = challengeName || 'CUSTOM_CHALLENGE'

    setIsLoading(true)
    try {
      const result = await completeMfaChallenge(pending.email, code, '', activeChallenge)
      if (result.success) {
        setUser(getCurrentUser())
        setMfaRequired(false)
        setNewPasswordRequired(false)
        setChallengeName('')
        setPendingEmail('')
      }
      setIsLoading(false)
      return result
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [challengeName])

  const signUp = useCallback(async (email: string, password: string, firstName: string, lastName: string) => {
    setIsLoading(true)
    try {
      const result = await cognitoSignUp(email, password, firstName, lastName)
      if (result.success) {
        setPendingSignUpEmail(email)
        setConfirmationPending(true)
        setSignUpMode(false)
      }
      setIsLoading(false)
      return result
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [])

  const confirmSignUp = useCallback(async (code: string) => {
    if (!pendingSignUpEmail) return { success: false, error: 'No pending sign-up' }
    setIsLoading(true)
    try {
      const result = await cognitoConfirmSignUp(pendingSignUpEmail, code)
      if (result.success) {
        setConfirmationPending(false)
        setPendingSignUpEmail('')
      }
      setIsLoading(false)
      return result
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [pendingSignUpEmail])

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    return cognitoChangePassword(oldPassword, newPassword)
  }, [])

  const extendSession = useCallback(() => {
    warningVisibleRef.current = false
    setShowInactivityWarning(false)
    resetInactivityTimer()
  }, [resetInactivityTimer])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoggedIn: !!user,
        isLoading,
        mfaRequired,
        newPasswordRequired,
        signUpMode,
        confirmationPending,
        showInactivityWarning,
        login,
        setNewPassword,
        verifyMfa,
        signUp,
        confirmSignUp,
        changePassword,
        setSignUpMode,
        extendSession,
        logout: performLogout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
