import { useState, useEffect } from 'react'
import { Sun, Moon, Lock, Plus, Trash2 } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card, CardTitle } from '../components/ui/Card'
import { Input } from '../components/ui/Input'
import { Button } from '../components/ui/Button'
import { useToast } from '../components/ui/Toast'
import { useAuth } from '../auth/AuthProvider'
import { getPracticeSettings, updatePracticeSettings } from '../api/endpoints'
import type { AppointmentType } from '../api/types'

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
  const queryClient = useQueryClient()

  // ── Appointment types ──
  const { data: practiceSettings } = useQuery({
    queryKey: ['practice-settings'],
    queryFn: getPracticeSettings,
  })
  const [apptTypes, setApptTypes] = useState<AppointmentType[]>([])
  useEffect(() => {
    if (practiceSettings) setApptTypes(practiceSettings.appointmentTypes)
  }, [practiceSettings])

  const saveMutation = useMutation({
    mutationFn: () => updatePracticeSettings({ appointmentTypes: apptTypes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['practice-settings'] })
      toast('success', 'Appointment types saved.')
    },
    onError: () => toast('error', 'Failed to save.'),
  })

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
    if (newPassword.length < 12) {
      toast('error', 'Password must be at least 12 characters.')
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
      <h1 className="text-2xl font-bold text-charcoal dark:text-white mb-6">Settings</h1>

      {/* Security */}
      <Card className="mb-6">
        <CardTitle className="mb-4">Security</CardTitle>
        <p className="text-sm text-warm-gray dark:text-gray-300 mb-4">Change your account password.</p>
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

      {/* Appointment Types */}
      <Card className="mb-6">
        <CardTitle className="mb-1">Appointment Types</CardTitle>
        <p className="text-sm text-warm-gray dark:text-gray-300 mb-4">
          Set the name and price for each visit type. These are used to auto-charge when Dr. Joseph saves a dictation note.
        </p>
        <div className="space-y-2 mb-3">
          {apptTypes.map((t, i) => (
            <div key={i} className="flex items-center gap-2">
              <input
                type="text"
                value={t.name}
                onChange={(e) => {
                  const next = [...apptTypes]
                  next[i] = { ...next[i], name: e.target.value }
                  setApptTypes(next)
                }}
                placeholder="e.g. New Patient"
                className="flex-1 px-3 py-2 rounded-md border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-charcoal dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue"
              />
              <div className="relative w-32">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-warm-gray text-sm">$</span>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={t.amountCents / 100}
                  onChange={(e) => {
                    const next = [...apptTypes]
                    next[i] = { ...next[i], amountCents: Math.round(Number(e.target.value) * 100) }
                    setApptTypes(next)
                  }}
                  className="w-full pl-7 pr-3 py-2 rounded-md border border-light-gray dark:border-gray-600 bg-white dark:bg-gray-700 text-charcoal dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-slate-blue"
                />
              </div>
              <button
                onClick={() => setApptTypes(apptTypes.filter((_, j) => j !== i))}
                className="p-2 text-warm-gray hover:text-red-500 transition-colors"
                aria-label="Remove"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setApptTypes([...apptTypes, { name: '', amountCents: 0 }])}
            className="flex items-center gap-1.5 text-sm text-slate-blue hover:underline"
          >
            <Plus size={15} /> Add type
          </button>
          <Button
            onClick={() => saveMutation.mutate()}
            loading={saveMutation.isPending}
            disabled={apptTypes.some((t) => !t.name.trim())}
            size="sm"
          >
            Save
          </Button>
        </div>
      </Card>

      {/* Appearance */}
      <Card>
        <CardTitle className="mb-4">Appearance</CardTitle>
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-charcoal dark:text-white">Dark Mode</p>
            <p className="text-sm text-warm-gray dark:text-gray-300">Switch between light and dark themes</p>
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
