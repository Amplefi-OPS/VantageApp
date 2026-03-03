import { useState, useEffect } from 'react'
import { Sun, Moon } from 'lucide-react'
import { Card, CardTitle } from '../components/ui/Card'

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

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  return (
    <div>
      <h1 className="text-2xl font-bold text-charcoal mb-6">Settings</h1>

      <Card>
        <CardTitle className="mb-4">Appearance</CardTitle>
        <p className="text-sm text-warm-gray mb-4">Choose your preferred theme.</p>
        <div className="flex gap-3">
          <button
            onClick={() => setTheme('light')}
            className={`flex items-center gap-3 px-5 py-3 rounded-xl border-2 transition-colors min-h-[48px] ${
              theme === 'light'
                ? 'border-slate-blue bg-slate-blue/5 text-slate-blue'
                : 'border-light-gray text-warm-gray hover:border-warm-gray'
            }`}
          >
            <Sun size={20} />
            <span className="font-medium">Light Mode</span>
          </button>
          <button
            onClick={() => setTheme('dark')}
            className={`flex items-center gap-3 px-5 py-3 rounded-xl border-2 transition-colors min-h-[48px] ${
              theme === 'dark'
                ? 'border-slate-blue bg-slate-blue/5 text-slate-blue'
                : 'border-light-gray text-warm-gray hover:border-warm-gray'
            }`}
          >
            <Moon size={20} />
            <span className="font-medium">Dark Mode</span>
          </button>
        </div>
      </Card>
    </div>
  )
}
