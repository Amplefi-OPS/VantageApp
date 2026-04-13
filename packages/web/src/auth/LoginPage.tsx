import { useState, useEffect, useRef } from 'react'
import { useAuth } from './AuthProvider'
import { reportLoginFailure } from '../api/endpoints'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { Shield, KeyRound, UserPlus, Mail, LockKeyhole } from 'lucide-react'

export default function LoginPage() {
  const {
    login, setNewPassword, verifyMfa, signUp, confirmSignUp, setSignUpMode,
    forgotPassword, confirmForgotPassword, loginAsDemo,
    mfaRequired, newPasswordRequired, signUpMode, confirmationPending, isLoading,
  } = useAuth()

  // Forgot password state
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotStep, setForgotStep] = useState<'request' | 'reset'>('request')
  const [forgotEmail, setForgotEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [resetPwd, setResetPwd] = useState('')
  const [resetConfirmPwd, setResetConfirmPwd] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')
  const isMounted = useRef(false)

  // Force light mode on login page
  useEffect(() => {
    const html = document.documentElement
    const wasDark = html.classList.contains('dark')
    html.classList.remove('dark')
    return () => {
      if (wasDark) html.classList.add('dark')
    }
  }, [])

  // Show messages from session expiry / inactivity logout
  useEffect(() => {
    const msg = sessionStorage.getItem('vantage-auth-msg')
    if (msg) {
      sessionStorage.removeItem('vantage-auth-msg')
      setError(msg)
    }
  }, [])

  // Clear stale errors when the active form changes (skip initial mount)
  useEffect(() => {
    if (!isMounted.current) {
      isMounted.current = true
      return
    }
    setError('')
  }, [mfaRequired, newPasswordRequired, signUpMode, confirmationPending])

  // Sign-up fields
  const [suFirstName, setSuFirstName] = useState('')
  const [suLastName, setSuLastName] = useState('')
  const [suEmail, setSuEmail] = useState('')
  const [suPhone, setSuPhone] = useState('')
  const [suPassword, setSuPassword] = useState('')
  const [suConfirmPwd, setSuConfirmPwd] = useState('')
  const [confirmCode, setConfirmCode] = useState('')

  async function handleForgotRequest(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setForgotLoading(true)
    const result = await forgotPassword(forgotEmail)
    setForgotLoading(false)
    if (result.success) {
      setForgotStep('reset')
    } else {
      setError(result.error || 'Failed to send reset code.')
    }
  }

  async function handleResendCode() {
    setError('')
    setForgotLoading(true)
    const result = await forgotPassword(forgotEmail)
    setForgotLoading(false)
    if (!result.success) {
      setError(result.error || 'Failed to resend reset code.')
    }
  }

  async function handleForgotReset(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (resetPwd !== resetConfirmPwd) {
      setError('Passwords do not match.')
      return
    }
    if (resetPwd.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    setForgotLoading(true)
    const result = await confirmForgotPassword(forgotEmail, resetCode, resetPwd)
    setForgotLoading(false)
    if (result.success) {
      setForgotMode(false)
      setForgotStep('request')
      setForgotEmail('')
      setResetCode('')
      setResetPwd('')
      setResetConfirmPwd('')
      setSuccessMsg('Password reset! You can now sign in with your new password.')
    } else {
      setError(result.error || 'Failed to reset password.')
    }
  }

  function openForgotMode() {
    setError('')
    setSuccessMsg('')
    setForgotMode(true)
    setForgotStep('request')
  }

  function closeForgotMode() {
    setError('')
    setForgotMode(false)
    setForgotStep('request')
  }

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
    if (suPhone.length !== 10) {
      setError('Please enter a valid 10-digit US phone number.')
      return
    }
    const result = await signUp(suEmail, suPassword, suFirstName, suLastName, '+1' + suPhone)
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
  const showForgot = forgotMode && !showNewPassword && !showMfa && !showConfirmation && !showSignUp

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
                  Enter the 6-digit code sent via SMS to your mobile phone.
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
                  Mobile Phone
                </label>
                <div className="flex">
                  <span className="flex items-center px-3 bg-light-gray border border-r-0 border-light-gray rounded-l-lg text-charcoal text-sm font-medium select-none">
                    +1
                  </span>
                  <input
                    type="tel"
                    inputMode="numeric"
                    value={suPhone.length === 0 ? '' : suPhone.length <= 3 ? suPhone : suPhone.length <= 6 ? `(${suPhone.slice(0,3)}) ${suPhone.slice(3)}` : `(${suPhone.slice(0,3)}) ${suPhone.slice(3,6)}-${suPhone.slice(6)}`}
                    onChange={(e) => setSuPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                    placeholder="(555) 123-4567"
                    required
                    autoComplete="tel-national"
                    className="flex-1 px-4 py-3 rounded-r-lg border border-light-gray bg-white text-charcoal placeholder:text-warm-gray focus:outline-none focus:ring-2 focus:ring-slate-blue focus:border-transparent min-h-[48px] text-base transition-colors"
                  />
                </div>
                <p className="text-xs text-warm-gray mt-1">
                  SMS verification codes will be sent here every time you sign in.
                </p>
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

          ) : showForgot ? (
            forgotStep === 'request' ? (
              <form onSubmit={handleForgotRequest} className="space-y-4">
                <div className="text-center mb-2">
                  <LockKeyhole className="w-8 h-8 text-slate-blue mx-auto mb-2" />
                  <h2 className="text-lg font-semibold text-charcoal">Reset Password</h2>
                  <p className="text-sm text-warm-gray">
                    Enter your email and we'll send a reset code.
                  </p>
                </div>
                <Input
                  type="email"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  placeholder="name@vantagerefinery.com"
                  required
                  autoComplete="email"
                />
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={forgotLoading}>
                  {forgotLoading ? 'Sending code...' : 'Send Reset Code'}
                </Button>
                <p className="text-xs text-warm-gray text-center mt-2">
                  <button type="button" onClick={closeForgotMode} className="text-slate-blue font-medium hover:underline">
                    Back to Sign In
                  </button>
                </p>
              </form>
            ) : (
              <form onSubmit={handleForgotReset} className="space-y-4">
                <div className="text-center mb-2">
                  <LockKeyhole className="w-8 h-8 text-slate-blue mx-auto mb-2" />
                  <h2 className="text-lg font-semibold text-charcoal">Set New Password</h2>
                  <p className="text-sm text-warm-gray">
                    Enter the code sent to <strong>{forgotEmail}</strong> and choose a new password.
                  </p>
                </div>
                <Input
                  type="text"
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  placeholder="Reset code"
                  maxLength={6}
                  className="text-center text-2xl tracking-widest"
                  required
                  autoComplete="one-time-code"
                  inputMode="numeric"
                />
                <Input
                  type="password"
                  value={resetPwd}
                  onChange={(e) => setResetPwd(e.target.value)}
                  placeholder="New password"
                  required
                  autoComplete="new-password"
                />
                <Input
                  type="password"
                  value={resetConfirmPwd}
                  onChange={(e) => setResetConfirmPwd(e.target.value)}
                  placeholder="Confirm new password"
                  required
                  autoComplete="new-password"
                />
                <p className="text-xs text-warm-gray">
                  8+ characters, uppercase, lowercase, number, and symbol.
                </p>
                {error && (
                  <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
                )}
                <Button type="submit" className="w-full" disabled={forgotLoading}>
                  {forgotLoading ? 'Resetting...' : 'Reset Password'}
                </Button>
                <p className="text-xs text-warm-gray text-center mt-2">
                  <button type="button" onClick={handleResendCode} disabled={forgotLoading} className="text-slate-blue font-medium hover:underline disabled:opacity-50">
                    Resend code
                  </button>
                  {' · '}
                  <button type="button" onClick={closeForgotMode} className="text-slate-blue font-medium hover:underline">
                    Back to Sign In
                  </button>
                </p>
              </form>
            )

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
                <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <svg className="w-4 h-4 text-red-500 shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm-1-9v4a1 1 0 102 0V9a1 1 0 10-2 0zm0-4a1 1 0 112 0 1 1 0 01-2 0z" clipRule="evenodd" />
                  </svg>
                  <p className="text-sm text-red-700 font-medium">{error}</p>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
              <p className="text-xs text-warm-gray text-center mt-3">
                <button
                  type="button"
                  onClick={openForgotMode}
                  className="text-slate-blue font-medium hover:underline"
                >
                  Forgot your password?
                </button>
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

        {!mfaRequired && !newPasswordRequired && !signUpMode && !confirmationPending && (
          <div className="text-center mt-4">
            <button
              type="button"
              onClick={loginAsDemo}
              className="text-xs text-warm-gray hover:text-slate-blue underline underline-offset-2 transition-colors"
            >
              Enter Demo Mode
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
