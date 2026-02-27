import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from 'react'
import {
  signIn as cognitoSignIn,
  completeMfaChallenge,
  completeNewPasswordChallenge,
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
  mfaSession: string | null
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>
  setNewPassword: (newPassword: string) => Promise<{ success: boolean; error?: string }>
  verifyMfa: (code: string) => Promise<{ success: boolean; error?: string }>
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

  const logout = useCallback(() => {
    cognitoSignOut()
    setUser(null)
    setMfaRequired(false)
    setNewPasswordRequired(false)
    setMfaSession(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoggedIn: !!user,
        isLoading,
        mfaRequired,
        newPasswordRequired,
        mfaSession,
        login,
        setNewPassword,
        verifyMfa,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}
