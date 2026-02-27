import type { AppSettings } from '../api/types'

const STORAGE_KEY = 'vantage-settings'

const defaults: AppSettings = {
  officeName: 'Vantage Medical Office',
  timezone: 'America/New_York',
  staffList: ['Dr. Sarah Chen', 'Dr. James Park', 'Nurse Amy', 'Front Desk Maria'],
  apiBaseUrl: '',
  s3BucketName: 'vantage-uploads',
  s3Region: 'us-east-1',
  zoomPhoneNumber: '(555) 100-2000',
  ivrMapping: {
    '1': 'Scheduling',
    '2': 'Refills',
    '3': 'Basic Questions',
    '4': 'Everything Else',
  },
}

export function getSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return { ...defaults, ...JSON.parse(raw) }
  } catch {
    // ignore
  }
  return defaults
}

export function saveSettings(settings: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated = { ...current, ...settings }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
  return updated
}
