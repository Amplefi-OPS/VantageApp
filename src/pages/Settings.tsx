import { useState, useEffect } from 'react'
import { Sun, Moon, Lock } from 'lucide-react'
import { Card, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../auth/AuthProvider'

type Theme = 'light' | 'dark'

function getStoredTheme(): Theme {
  return (localStorage.getItem('vantage-theme') as Theme) || 'light'
}

function applyTheme(theme: Theme) {
  localStorage.setItem('vantage-theme', theme)
  if (theme === 'dark') {
    document.documentElement.classList.add('dark')
  } else {
    document.documentElement.classList.remove('dark')
  }
}

export default function Settings() {
  const [theme, setTheme] = useState<Theme>(getStoredTheme)
  const { changePassword } = useAuth()
  const { toast } = useToast()

  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast('error', 'New passwords do not match.')
      return
    }
    if (newPassword.length < 8) {
      toast('error', 'Password must be at least 8 characters.')
      return
    }
    setChangingPassword(true)
    const result = await changePassword(currentPassword, newPassword)
    setChangingPassword(false)
    if (result.success) {
      toast('success', 'Password changed successfully.')
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } else {
      toast('error', result.error || 'Failed to change password.')
    }
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal dark:text-gray-100 mb-6">Settings</h1>

      {/* Security */}
      <Card className="mb-6">
        <CardTitle className="mb-4">Security</CardTitle>
        <p className="text-sm text-warm-gray dark:text-gray-400 mb-4">Change your account password.</p>
        <div className="space-y-3 max-w-md">
          <Input
            label="Current Password"
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder="Enter current password"
          />
          <Input
            label="New Password"
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="Enter new password"
          />
          <Input
            label="Confirm New Password"
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Confirm new password"
          />
          <Button
            onClick={handleChangePassword}
            loading={changingPassword}
            disabled={!currentPassword || !newPassword || !confirmPassword}
            icon={<Lock size={18} />}
          >
            Change Password
          </Button>
        </div>
      </Card>

      {/* Appearance */}
      <Card>
        <CardTitle className="mb-4">Appearance</CardTitle>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-charcoal dark:text-gray-100">Dark Mode</p>
            <p className="text-sm text-warm-gray dark:text-gray-400">Switch between light and dark themes</p>
          </div>
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors ${
              theme === 'dark' ? 'bg-slate-blue' : 'bg-light-gray'
            }`}
            role="switch"
            aria-checked={theme === 'dark'}
            aria-label="Toggle dark mode"
          >
            <span
              className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow-sm transition-transform ${
                theme === 'dark' ? 'translate-x-6' : 'translate-x-1'
              }`}
            >
              {theme === 'dark' ? (
                <Moon size={12} className="text-slate-blue" />
              ) : (
                <Sun size={12} className="text-warm-gray" />
              )}
            </span>
          </button>
        </div>
      </Card>
    </div>
  )
}
