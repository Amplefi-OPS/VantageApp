import { useState } from 'react'
import { useAuth } from './AuthProvider'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { Shield } from 'lucide-react'

export default function LoginPage() {
  const { login, verifyMfa, mfaRequired, isLoading } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mfaCode, setMfaCode] = useState('')
  const [error, setError] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    const result = await login(email, password)
    if (!result.success && result.error !== 'MFA required') {
      setError(result.error || 'Login failed')
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
          {!mfaRequired ? (
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
          ) : (
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
