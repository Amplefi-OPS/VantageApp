import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Phone,
  ClipboardList,
  Users,
  Send,
  CreditCard,
  Settings,
  Calendar,
  LogOut,
} from 'lucide-react'
import { cn } from '../lib/utils'
import { useAuth } from '../auth/AuthProvider'

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/voicemails', label: 'Voicemails', icon: Phone },
  { to: '/todos', label: 'To-Do List', icon: ClipboardList },
  { to: '/appointments', label: 'Appointments', icon: Calendar },
  { to: '/patients', label: 'Patients', icon: Users },
  { to: '/fax', label: 'Fax', icon: Send },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function Sidebar() {
  const { user, logout } = useAuth()

  return (
    <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 bg-white border-r border-light-gray z-30">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 h-16 border-b border-light-gray">
        <div className="w-9 h-9 rounded-lg bg-slate-blue flex items-center justify-center">
          <span className="text-white font-bold text-lg">V</span>
        </div>
        <span className="text-lg font-semibold text-charcoal">Vantage</span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors',
                'min-h-[48px]',
                isActive
                  ? 'bg-slate-blue/10 text-slate-blue'
                  : 'text-warm-gray hover:bg-light-gray hover:text-charcoal',
              )
            }
          >
            <link.icon size={22} />
            <span>{link.label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-light-gray">
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-charcoal truncate">
                {user.givenName} {user.familyName}
              </p>
              <p className="text-xs text-warm-gray truncate">{user.email}</p>
            </div>
            <button
              onClick={logout}
              className="p-2 text-warm-gray hover:text-red-500 transition-colors"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
