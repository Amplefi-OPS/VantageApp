import { useState, useEffect } from 'react'
import { Save, Plus, Trash2, ToggleLeft, ToggleRight } from 'lucide-react'
import { getSettings, saveSettings } from '../lib/settings'
import type { AppSettings } from '../api/types'
import { Card, CardTitle } from '../components/ui/Card'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Select } from '../components/ui/Select'
import { useToast } from '../components/ui/Toast'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
]

const IVR_LABELS: Record<string, string> = {
  '1': 'Option 1',
  '2': 'Option 2',
  '3': 'Option 3',
  '4': 'Option 4',
}

export default function Settings() {
  const { toast } = useToast()
  const [settings, setSettings] = useState<AppSettings>(getSettings())
  const [newStaff, setNewStaff] = useState('')

  const handleSave = () => {
    saveSettings(settings)
    toast('success', 'Settings saved!')
  }

  const addStaff = () => {
    if (!newStaff.trim()) return
    setSettings({
      ...settings,
      staffList: [...settings.staffList, newStaff.trim()],
    })
    setNewStaff('')
  }

  const removeStaff = (index: number) => {
    setSettings({
      ...settings,
      staffList: settings.staffList.filter((_, i) => i !== index),
    })
  }

  const updateIvr = (key: string, value: string) => {
    setSettings({
      ...settings,
      ivrMapping: { ...settings.ivrMapping, [key]: value },
    })
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-charcoal">Settings</h1>
        <Button onClick={handleSave} icon={<Save size={18} />}>
          Save All
        </Button>
      </div>

      <div className="space-y-6">
        {/* Demo Mode toggle */}
        <Card>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Demo Mode</CardTitle>
              <p className="text-sm text-warm-gray mt-1">
                When on, the app uses mock data instead of calling the real API.
              </p>
            </div>
            <button
              onClick={() =>
                setSettings({ ...settings, demoMode: !settings.demoMode })
              }
              className="text-slate-blue p-2"
              aria-label={settings.demoMode ? 'Turn off demo mode' : 'Turn on demo mode'}
            >
              {settings.demoMode ? (
                <ToggleRight size={36} />
              ) : (
                <ToggleLeft size={36} className="text-warm-gray" />
              )}
            </button>
          </div>
        </Card>

        {/* Office info */}
        <Card>
          <CardTitle className="mb-4">Office Information</CardTitle>
          <div className="space-y-4">
            <Input
              label="Office Name"
              value={settings.officeName}
              onChange={(e) =>
                setSettings({ ...settings, officeName: e.target.value })
              }
            />
            <Select
              label="Timezone"
              options={TIMEZONES}
              value={settings.timezone}
              onChange={(e) =>
                setSettings({ ...settings, timezone: e.target.value })
              }
            />
          </div>
        </Card>

        {/* Staff list */}
        <Card>
          <CardTitle className="mb-4">Staff</CardTitle>
          <div className="space-y-2 mb-4">
            {settings.staffList.map((name, i) => (
              <div
                key={i}
                className="flex items-center justify-between px-4 py-3 bg-off-white rounded-lg min-h-[48px]"
              >
                <span className="font-medium">{name}</span>
                <button
                  onClick={() => removeStaff(i)}
                  className="p-2 text-warm-gray hover:text-red-500 transition-colors"
                  aria-label={`Remove ${name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="Add staff member..."
              value={newStaff}
              onChange={(e) => setNewStaff(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addStaff()
              }}
            />
            <Button onClick={addStaff} variant="secondary" icon={<Plus size={18} />}>
              Add
            </Button>
          </div>
        </Card>

        {/* API config */}
        <Card>
          <CardTitle className="mb-4">API Configuration</CardTitle>
          <Input
            label="API Base URL"
            placeholder="https://api.yourbackend.com"
            value={settings.apiBaseUrl}
            onChange={(e) =>
              setSettings({ ...settings, apiBaseUrl: e.target.value })
            }
          />
          <p className="text-xs text-warm-gray mt-2">
            Leave empty while in Demo Mode. Backend engineer will provide this.
          </p>
        </Card>

        {/* AWS / S3 */}
        <Card>
          <CardTitle className="mb-4">AWS / S3 Configuration</CardTitle>
          <div className="grid sm:grid-cols-2 gap-4">
            <Input
              label="S3 Bucket Name"
              value={settings.s3BucketName}
              onChange={(e) =>
                setSettings({ ...settings, s3BucketName: e.target.value })
              }
            />
            <Select
              label="S3 Region"
              options={[
                { value: 'us-east-1', label: 'US East (N. Virginia)' },
                { value: 'us-east-2', label: 'US East (Ohio)' },
                { value: 'us-west-1', label: 'US West (N. California)' },
                { value: 'us-west-2', label: 'US West (Oregon)' },
              ]}
              value={settings.s3Region}
              onChange={(e) =>
                setSettings({ ...settings, s3Region: e.target.value })
              }
            />
          </div>
          <p className="text-xs text-warm-gray mt-2">
            These values are stored locally for reference. The backend will use environment variables.
          </p>
        </Card>

        {/* Zoom Phone */}
        <Card>
          <CardTitle className="mb-4">Zoom Phone</CardTitle>
          <div className="space-y-4">
            <Input
              label="Zoom Phone Number"
              value={settings.zoomPhoneNumber}
              onChange={(e) =>
                setSettings({ ...settings, zoomPhoneNumber: e.target.value })
              }
            />
            <div>
              <p className="text-sm font-medium text-charcoal mb-2">IVR Menu Mapping</p>
              <div className="space-y-2">
                {Object.keys(IVR_LABELS).map((key) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-sm text-warm-gray w-20">{IVR_LABELS[key]}:</span>
                    <Input
                      value={settings.ivrMapping[key] || ''}
                      onChange={(e) => updateIvr(key, e.target.value)}
                      className="flex-1"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Card>

        {/* Save button at bottom */}
        <div className="flex justify-end pb-8">
          <Button onClick={handleSave} icon={<Save size={18} />} size="lg">
            Save All Settings
          </Button>
        </div>
      </div>
    </div>
  )
}
