import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
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
  type AuthUser,
} from './cognito'

interface AuthContextValue {
  user: AuthUser | null
  isLoggedIn: boolean
  isLoading: boolean
  mfaRequired: boolean
  newPasswordRequired: boolean
  signUpMode: boolean
  confirmationPending: boolean
  mfaSession: string | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  setNewPassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>
  verifyMfa: (code: string) => Promise<{ success: boolean; error?: string }>
  signUp: (email: string, password: string, firstName: string, lastName: string) => Promise<{ success: boolean; error?: string }>
  confirmSignUp: (code: string) => Promise<{ success: boolean; error?: string }>
  changePassword: (oldPassword: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  setSignUpMode: (mode: boolean) => void
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
  const [pendingSignUpEmail, setPendingSignUpEmail] = useState('')
  const [pendingSignUpPassword, setPendingSignUpPassword] = useState('')
  const [mfaSession, setMfaSession] = useState<string | null>(null)

  // Check existing session on mount
  useEffect(() => {
    if (isAuthenticated()) {
      setUser(getCurrentUser())
    }
    setIsLoading(false)
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    setIsLoading(true)
    try {
      const result = await cognitoSignIn(email, password)
      if (result.newPasswordRequired) {
        setNewPasswordRequired(true)
        setMfaSession(result.session || null)
        setIsLoading(false)
        return { success: false, error: 'New password required' }
      }
      if (result.mfaRequired) {
        setMfaRequired(true)
        setMfaSession(result.session || null)
        setIsLoading(false)
        return { success: false, error: 'MFA required' }
      }
      if (result.success) {
        setUser(getCurrentUser())
        setMfaRequired(false)
        setNewPasswordRequired(false)
        setMfaSession(null)
      }
      setIsLoading(false)
      return { success: result.success, error: result.error }
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [])

  const setNewPassword = useCallback(async (newPassword: string) => {
    if (!mfaSession) return { success: false, error: 'No session' }
    setIsLoading(true)
    try {
      const result = await completeNewPasswordChallenge(newPassword, mfaSession)
      if (result.mfaRequired) {
        setNewPasswordRequired(false)
        setMfaRequired(true)
        setMfaSession(result.session || null)
        setIsLoading(false)
        return { success: false, error: 'MFA required' }
      }
      if (result.success) {
        setUser(getCurrentUser())
        setNewPasswordRequired(false)
        setMfaRequired(false)
        setMfaSession(null)
      }
      setIsLoading(false)
      return { success: result.success, error: result.error }
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [mfaSession])

  const verifyMfa = useCallback(async (code: string) => {
    if (!mfaSession) return { success: false, error: 'No MFA session' }
    setIsLoading(true)
    try {
      const result = await completeMfaChallenge(code, mfaSession)
      if (result.success) {
        setUser(getCurrentUser())
        setMfaRequired(false)
        setNewPasswordRequired(false)
        setMfaSession(null)
      }
      setIsLoading(false)
      return result
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [mfaSession])

  const signUp = useCallback(async (email: string, password: string, firstName: string, lastName: string) => {
    setIsLoading(true)
    try {
      const result = await cognitoSignUp(email, password, firstName, lastName)
      if (result.success) {
        setPendingSignUpEmail(email)
        setPendingSignUpPassword(password)
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
        // Auto-login: sign in immediately so the user goes straight to MFA
        // instead of having to re-enter email/password
        if (pendingSignUpPassword) {
          const email = pendingSignUpEmail
          const password = pendingSignUpPassword
          setPendingSignUpEmail('')
          setPendingSignUpPassword('')
          const loginResult = await cognitoSignIn(email, password)
          if (loginResult.mfaRequired) {
            setMfaRequired(true)
            setMfaSession(loginResult.session || null)
            setIsLoading(false)
            return { success: true }
          }
          if (loginResult.success) {
            setUser(getCurrentUser())
            setIsLoading(false)
            return { success: true }
          }
          // If auto-login fails for any reason, fall through gracefully
          setIsLoading(false)
          return { success: true }
        }
        setPendingSignUpEmail('')
        setPendingSignUpPassword('')
      }
      setIsLoading(false)
      return result
    } catch (err) {
      setIsLoading(false)
      return { success: false, error: String(err) }
    }
  }, [pendingSignUpEmail, pendingSignUpPassword])

  const changePassword = useCallback(async (oldPassword: string, newPassword: string) => {
    return cognitoChangePassword(oldPassword, newPassword)
  }, [])

  const logout = useCallback(() => {
    cognitoSignOut()
    setUser(null)
    setMfaRequired(false)
    setNewPasswordRequired(false)
    setSignUpMode(false)
    setConfirmationPending(false)
    setPendingSignUpEmail('')
    setPendingSignUpPassword('')
    setMfaSession(null)
    // Reset URL so next login starts at dashboard
    window.history.replaceState(null, '', '/dashboard')
  }, [])

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
        mfaSession,
        login,
        setNewPassword,
        verifyMfa,
        signUp,
        confirmSignUp,
        changePassword,
        setSignUpMode,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
