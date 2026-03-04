import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Phone,
  ClipboardList,
  Users,
  MoreHorizontal,
  Send,
  CreditCard,
  Settings,
  X,
} from 'lucide-react'
import { cn } from '../lib/utils'

const mainLinks = [
  { to: '/dashboard', label: 'Home', icon: LayoutDashboard },
  { to: '/voicemails', label: 'Voicemails', icon: Phone },
  { to: '/todos', label: 'To-Dos', icon: ClipboardList },
  { to: '/patients', label: 'Patients', icon: Users },
]

const moreLinks = [
  { to: '/fax', label: 'Fax', icon: Send },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)

  return (
    <>
      {/* More menu overlay */}
      {moreOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-charcoal/30"
          onClick={() => setMoreOpen(false)}
        >
          <div
            className="absolute bottom-16 left-0 right-0 bg-white dark:bg-gray-800 border-t border-light-gray dark:border-gray-700 rounded-t-2xl p-4 space-y-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2 px-2">
              <span className="font-semibold text-charcoal dark:text-gray-100">More</span>
              <button
                onClick={() => setMoreOpen(false)}
                className="p-2 rounded-lg hover:bg-light-gray dark:hover:bg-gray-700"
                aria-label="Close menu"
              >
                <X size={20} />
              </button>
            </div>
            {moreLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                onClick={() => setMoreOpen(false)}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 px-4 py-3 rounded-lg text-base font-medium transition-colors min-h-[48px]',
                    isActive
                      ? 'bg-slate-blue/10 text-slate-blue'
                      : 'text-warm-gray hover:bg-light-gray dark:hover:bg-gray-700 hover:text-charcoal dark:hover:text-gray-100',
                  )
                }
              >
                <link.icon size={22} />
                <span>{link.label}</span>
              </NavLink>
            ))}
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <nav
        className="lg:hidden fixed bottom-0 left-0 right-0 z-30 bg-white dark:bg-gray-800 border-t border-light-gray dark:border-gray-700 safe-bottom"
        aria-label="Mobile navigation"
      >
        <div className="flex items-center justify-around h-16">
          {mainLinks.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                cn(
                  'flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs font-medium transition-colors min-w-[64px]',
                  isActive ? 'text-slate-blue' : 'text-warm-gray',
                )
              }
            >
              <link.icon size={22} />
              <span>{link.label}</span>
            </NavLink>
          ))}
          <button
            onClick={() => setMoreOpen(!moreOpen)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 flex-1 h-full text-xs font-medium transition-colors min-w-[64px]',
              moreOpen ? 'text-slate-blue' : 'text-warm-gray',
            )}
            aria-label="More options"
          >
            <MoreHorizontal size={22} />
            <span>More</span>
          </button>
        </div>
      </nav>
    </>
  )
}
