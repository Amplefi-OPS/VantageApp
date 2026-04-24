import { NavLink } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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
import { listTodos } from '../api/endpoints'
import { getSettings } from '../lib/settings'

const links = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/voicemails', label: 'Voicemails', icon: Phone },
  { to: '/todos', label: 'To-Do List', icon: ClipboardList, todosBadge: true },
  { to: '/appointments', label: 'Appointments', icon: Calendar },
  { to: '/patients', label: 'Patients', icon: Users },
  { to: '/fax', label: 'Fax', icon: Send },
  { to: '/billing', label: 'Billing', icon: CreditCard, providerOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings },
]

/**
 * Best-effort: map the logged-in user to a display name in staffList.
 * Returns the matching entry (e.g. "Lori") or null if no match — in which
 * case the badge stays hidden.
 */
function resolveMyStaffName(givenName?: string, familyName?: string): string | null {
  if (!givenName) return null
  const staff = getSettings().staffList
  const first = givenName.trim().toLowerCase()
  const full = `${givenName} ${familyName || ''}`.trim().toLowerCase()
  return (
    staff.find((s) => s.toLowerCase() === first) ??
    staff.find((s) => s.toLowerCase().endsWith(first)) ??
    staff.find((s) => s.toLowerCase() === full) ??
    null
  )
}

export function Sidebar() {
  const { user, logout } = useAuth()
  const isProvider = user?.role === 'provider' || user?.groups?.includes('providers')
  const visibleLinks = links.filter((l) => !l.providerOnly || isProvider)

  const myStaffName = resolveMyStaffName(user?.givenName, user?.familyName)
  const { data: myTodos } = useQuery({
    queryKey: ['todos', 'mine', myStaffName],
    queryFn: () => listTodos({ assignedTo: myStaffName!, status: 'Open' }),
    enabled: !!myStaffName,
    refetchInterval: 60000,
  })
  const myTodoCount = myTodos?.length ?? 0

  return (
    <aside className="hidden lg:flex lg:flex-col lg:fixed lg:inset-y-0 lg:w-64 bg-white dark:bg-gray-800 border-r border-light-gray dark:border-gray-700 z-30">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 h-16 border-b border-light-gray dark:border-gray-700">
        <div className="w-9 h-9 rounded-lg bg-slate-blue flex items-center justify-center">
          <span className="text-white font-bold text-lg">V</span>
        </div>
        <span className="text-lg font-semibold text-charcoal dark:text-white">Vantage</span>
      </div>

      {/* Nav links */}
      <nav className="flex-1 px-3 py-4 space-y-1" aria-label="Main navigation">
        {visibleLinks.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors',
                'min-h-[48px]',
                isActive
                  ? 'bg-slate-blue/10 text-slate-blue'
                  : 'text-warm-gray hover:bg-light-gray dark:hover:bg-gray-700 hover:text-charcoal dark:hover:text-gray-100',
              )
            }
          >
            <link.icon size={22} />
            <span className="flex-1">{link.label}</span>
            {link.todosBadge && myTodoCount > 0 && (
              <span className="ml-auto inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-full text-xs font-semibold bg-slate-blue text-white">
                {myTodoCount}
              </span>
            )}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-6 py-4 border-t border-light-gray dark:border-gray-700">
        {user && (
          <div className="flex items-center justify-between">
            <div className="min-w-0">
              <p className="text-sm font-medium text-charcoal dark:text-white truncate">
                {user.givenName} {user.familyName}
              </p>
              <p className="text-xs text-warm-gray dark:text-gray-300 truncate">{user.email}</p>
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
