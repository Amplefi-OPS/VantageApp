import { useState, useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { reportLoginFailure } from '../api/endpoints'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { Shield, KeyRound, UserPlus, Mail } from 'lucide-react'

export default function LoginPage() {
  const {
    login, setNewPassword, verifyMfa, signUp, confirmSignUp, setSignUpMode,
    mfaRequired, newPasswordRequired, signUpMode, confirmationPending, isLoading,
  } = useAuth()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Force light mode on login page
  useEffect(() => {
    const html = document.documentElement
    const wasDark = html.classList.contains('dark')
    html.classList.remove('dark')
    return () => {
      if (wasDark) html.classList.add('dark')
    }
  }, [])

  // Sign-up fields
  const [suFirstName, setSuFirstName] = useState('')
  const [suLastName, setSuLastName] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [suPassword, setSuPassword] = useState('')
  const [suConfirmPwd, setSuConfirmPwd] = useState('')
  const [confirmCode, setConfirmCode] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setSuccessMsg('')
    const result = await login(email, password)
    if (!result.success && result.error !== 'MFA required' && result.error !== 'New password required') {
      setError(result.error || 'Login failed')
      reportLoginFailure(email, result.error || 'Login failed')
    }
  }

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPwd !== confirmPwd) {
      setError('Passwords do not match')
      return
    }
    if (newPwd.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    const result = await setNewPassword(newPwd)
    if (!result.success && result.error !== 'MFA required') {
      setError(result.error || 'Failed to set new password')
    }
  }

  async function handleMfa(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const result = await verifyMfa(mfaCode)
    if (!result.success) {
      setError(result.error || 'Verification failed')
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const emailDomain = suEmail.split('@')[1]?.toLowerCase()
    if (!emailDomain || !['vantagerefinery.com', 'amplefi.com'].includes(emailDomain)) {
      setError('Only @vantagerefinery.com and @amplefi.com email addresses are allowed.')
      return
    }
    if (suPassword !== suConfirmPwd) {
      setError('Passwords do not match')
      return
    }
    if (suPassword.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    const result = await signUp(suEmail, suPassword, suFirstName, suLastName)
    if (!result.success) {
      setError(result.error || 'Sign up failed')
    }
  }

  async function handleConfirmSignUp(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const result = await confirmSignUp(confirmCode)
    if (!result.success) {
      setError(result.error || 'Verification failed')
    } else {
      // Account verified — return to login with success message
      setSuccessMsg('Email verified! You can now sign in.')
      setSignUpMode(false)
    }
  }

  function switchToSignUp() {
    setError('')
    setSuccessMsg('')
    setSignUpMode(true)
  }

  function switchToLogin() {
    setError('')
    setSuccessMsg('')
    setSignUpMode(false)
  }

  // Determine which form to show
  const showNewPassword = newPasswordRequired
  const showMfa = mfaRequired && !newPasswordRequired
  const showConfirmation = confirmationPending
  const showSignUp = signUpMode && !showNewPassword && !showMfa && !showConfirmation

  return (
    <div className="min-h-screen bg-off-white flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-slate-blue rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-charcoal">Vantage</h1>
          <p className="text-warm-gray mt-1">Physician Portal</p>
        </div>

        <Card>
          {showNewPassword ? (
            <form onSubmit={handleNewPassword} className="space-y-4">
              <div className="text-center mb-2">
                <KeyRound className="w-8 h-8 text-slate-blue mx-auto mb-2" />
                <h2 className="text-lg font-semibold text-charcoal">
                  Set New Password
                </h2>
                <p className="text-sm text-warm-gray">
                  Your temporary password has expired. Please create a new one.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">
                  New Password
                </label>
                <Input
                  type="password"
                  value={newPwd}
                  onChange={(e) => setNewPwd(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">
                  Confirm Password
                </label>
                <Input
                  type="password"
                  value={confirmPwd}
                  onChange={(e) => setConfirmPwd(e.target.value)}
                  placeholder="Re-enter new password"
                  required
                  autoComplete="new-password"
                />
              </div>
              <p className="text-xs text-warm-gray">
                Must include: 8+ characters, uppercase, lowercase, number, and symbol.
              </p>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Setting password...' : 'Set Password'}
              </Button>
            </form>

          ) : showMfa ? (
            <form onSubmit={handleMfa} className="space-y-4">
              <div className="text-center mb-2">
                <Shield className="w-8 h-8 text-slate-blue mx-auto mb-2" />
                <h2 className="text-lg font-semibold text-charcoal">
                  MFA Verification
                </h2>
                <p className="text-sm text-warm-gray">
                  Enter the 6-digit code sent to your email from noreply@vantagerefinery.com
                </p>
              </div>
              <div>
                <Input
                  type="text"
                  value={mfaCode}
                  onChange={(e) => setMfaCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Verifying...' : 'Verify'}
              </Button>
            </form>

          ) : showConfirmation ? (
            <form onSubmit={handleConfirmSignUp} className="space-y-4">
              <div className="text-center mb-2">
                <Mail className="w-8 h-8 text-slate-blue mx-auto mb-2" />
                <h2 className="text-lg font-semibold text-charcoal">
                  Verify Your Email
                </h2>
                <p className="text-sm text-warm-gray">
                  Enter the confirmation code sent to your email from noreply@vantagerefinery.com
                </p>
              </div>
              <div>
                <Input
                  type="text"
                  value={confirmCode}
                  onChange={(e) => setConfirmCode(e.target.value)}
                  placeholder="000000"
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  pattern="[0-9]*"
                />
              </div>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Verifying...' : 'Verify Account'}
              </Button>
            </form>

          ) : showSignUp ? (
            <form onSubmit={handleSignUp} className="space-y-4">
              <div className="text-center mb-2">
                <UserPlus className="w-8 h-8 text-slate-blue mx-auto mb-2" />
                <h2 className="text-lg font-semibold text-charcoal">
                  Create Account
                </h2>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-charcoal mb-1">
                    First Name
                  </label>
                  <Input
                    type="text"
                    value={suFirstName}
                    onChange={(e) => setSuFirstName(e.target.value)}
                    placeholder="Jane"
                    required
                    autoComplete="given-name"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-charcoal mb-1">
                    Last Name
                  </label>
                  <Input
                    type="text"
                    value={suLastName}
                    onChange={(e) => setSuLastName(e.target.value)}
                    placeholder="Smith"
                    required
                    autoComplete="family-name"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">
                  Email
                </label>
                <Input
                  type="email"
                  value={suEmail}
                  onChange={(e) => setSuEmail(e.target.value)}
                  placeholder="name@vantagerefinery.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">
                  Password
                </label>
                <Input
                  type="password"
                  value={suPassword}
                  onChange={(e) => setSuPassword(e.target.value)}
                  placeholder="At least 8 characters"
                  required
                  autoComplete="new-password"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">
                  Confirm Password
                </label>
                <Input
                  type="password"
                  value={suConfirmPwd}
                  onChange={(e) => setSuConfirmPwd(e.target.value)}
                  placeholder="Re-enter password"
                  required
                  autoComplete="new-password"
                />
              </div>
              <p className="text-xs text-warm-gray">
                Only @vantagerefinery.com and @amplefi.com emails.
                <br />
                Password: 8+ characters, uppercase, lowercase, number, and symbol.
              </p>
              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Creating account...' : 'Create Account'}
              </Button>
              <p className="text-xs text-warm-gray text-center mt-3">
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={switchToLogin}
                  className="text-slate-blue font-medium hover:underline"
                >
                  Sign In
                </button>
              </p>
            </form>

          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">
                  Email
                </label>
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@vantagerefinery.com"
                  required
                  autoComplete="email"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-charcoal mb-1">
                  Password
                </label>
                <Input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter password"
                  required
                  autoComplete="current-password"
                />
              </div>
              {successMsg && (
                <p className="text-sm text-green-700 bg-green-50 p-2 rounded">{successMsg}</p>
              )}
              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
              <p className="text-xs text-warm-gray text-center mt-3">
                Forgot your password? Contact your administrator.
              </p>
              <p className="text-xs text-warm-gray text-center mt-1">
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={switchToSignUp}
                  className="text-slate-blue font-medium hover:underline"
                >
                  Create one
                </button>
              </p>
            </form>
          )}
        </Card>

        <p className="text-xs text-warm-gray text-center mt-6">
          HIPAA-compliant secure access.
          <br />
          All sessions are encrypted and audited.
        </p>
      </div>
    </div>
  )
}
