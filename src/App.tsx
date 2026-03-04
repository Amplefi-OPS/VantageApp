import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ToastProvider } from './components/ui/Toast'
import { AuthProvider, useAuth } from './auth/AuthProvider'
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
import PatientLookup from './pages/stripe/PatientLookup'
import ChargePatient from './pages/stripe/ChargePatient'
import NoShowFee from './pages/stripe/NoShowFee'
import Settings from './pages/Settings'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

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
    <Routes>
      <Route element={<Layout />}>
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/voicemails" element={<Voicemails />} />
        <Route path="/todos" element={<Todos />} />
        <Route path="/appointments" element={<Appointments />} />
        <Route path="/dictations" element={<Dictations />} />
        <Route path="/patients" element={<Patients />} />
        <Route path="/patients/:id" element={<PatientProfile />} />
        <Route path="/fax" element={<Fax />} />
        <Route path="/billing" element={<StripeDashboard />} />
        <Route path="/billing/lookup" element={<PatientLookup />} />
        <Route path="/billing/charge" element={<ChargePatient />} />
        <Route path="/billing/no-show" element={<NoShowFee />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
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
