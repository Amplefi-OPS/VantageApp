import { Outlet } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { BottomNav } from './BottomNav'

export function Layout() {
  return (
    <div className="min-h-screen bg-off-white dark:bg-gray-900">
      {/* Beta notice */}
      <div className="lg:ml-64 bg-amber-50 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-700 px-4 py-2 text-center text-xs text-amber-800 dark:text-amber-300">
        Dev update in progress — some features are being upgraded. Questions? Contact John.
      </div>

      {/* Desktop sidebar */}
      <Sidebar />

      {/* Main content */}
      <main className="lg:ml-64 pb-20 lg:pb-0 min-h-screen">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
          <Outlet />
        </div>
      </main>

      {/* Mobile bottom nav */}
      <BottomNav />
    </div>
  )
}
