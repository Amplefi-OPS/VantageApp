import { useState } from 'react'
import { useAuth } from './AuthProvider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { Shield, KeyRound } from 'lucide-react'

export default function LoginPage() {
  const { login, setNewPassword, verifyMfa, mfaRequired, newPasswordRequired, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const result = await login(email, password)
    if (!result.success && result.error !== 'MFA required' && result.error !== 'New password required') {
      setError(result.error || 'Login failed')
    }
  }

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (newPwd !== confirmPwd) {
      setError('Passwords do not match')
      return
    }
    if (newPwd.length < 12) {
      setError('Password must be at least 12 characters')
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

  // Determine which form to show
  const showNewPassword = newPasswordRequired
  const showMfa = mfaRequired && !newPasswordRequired

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
                  placeholder="At least 12 characters"
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
                Must include: 12+ characters, uppercase, lowercase, number, and symbol.
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
                  Verification Required
                </h2>
                <p className="text-sm text-warm-gray">
                  Enter the code sent to your device
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
                  placeholder="dr.smith@clinic.com"
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
              {error && (
                <p className="text-sm text-red-600 bg-red-50 p-2 rounded">{error}</p>
              )}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
              <p className="text-xs text-warm-gray text-center mt-3">
                MFA is required for all accounts.
                <br />
                Contact your administrator for access.
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
