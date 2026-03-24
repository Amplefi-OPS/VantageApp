import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from './lib/queryClient'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider, useAuth } from './auth/AuthProvider'
import { ConfirmDialog } from './components/ui/ConfirmDialog'
import { Layout } from './components/Layout'
import LoginPage from './auth/LoginPage'
import Dashboard from './pages/Dashboard'
import Voicemails from './pages/Voicemails'
import Todos from './pages/Todos'
import Appointments from './pages/Appointments'
import Dictations from './pages/Dictations'
import Patients from './pages/Patients'
import PatientProfile from './pages/PatientProfile'
import Fax from './pages/Fax'
import StripeDashboard from './pages/stripe/StripeDashboard'
import ScheduleAppointment from './pages/ScheduleAppointment'
import Settings from './pages/Settings'

function ProviderRoute({ children }: { children: React.ReactNode }) {
  const { user } = useAuth()
  const isProvider = user?.role === 'provider' || user?.groups?.includes('providers')
  if (!isProvider) return <Navigate to="/dashboard" replace />
  return <>{children}</>
}

function InactivityWarning() {
  const { showInactivityWarning, extendSession, logout } = useAuth()
  return (
    <ConfirmDialog
      open={showInactivityWarning}
      onClose={extendSession}
      onConfirm={logout}
      title="Session Timeout"
      message="You will be logged out in 2 minutes due to inactivity. Click 'Stay Signed In' to continue."
      confirmLabel="Sign Out"
      cancelLabel="Stay Signed In"
    />
  )
}

function AppRoutes() {
  const { isLoggedIn, isLoading } = useAuth()

  if (isLoading) {
    return (
      <div className="min-h-screen bg-off-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-slate-blue border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!isLoggedIn) {
    return <LoginPage />
  }

  return (
    <>
      <InactivityWarning />
      <Routes>
        <Route element={<Layout />}>
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/voicemails" element={<Voicemails />} />
          <Route path="/todos" element={<Todos />} />
          <Route path="/appointments" element={<Appointments />} />
          <Route path="/appointments/new" element={<ScheduleAppointment />} />
          <Route path="/dictations" element={<Dictations />} />
          <Route path="/patients" element={<Patients />} />
          <Route path="/patients/:id" element={<PatientProfile />} />
          <Route path="/fax" element={<Fax />} />
          <Route path="/billing" element={<ProviderRoute><StripeDashboard /></ProviderRoute>} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>
      </Routes>
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <AuthProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  )
}
