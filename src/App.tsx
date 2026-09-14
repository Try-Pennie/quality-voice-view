import { lazy, type ReactNode } from 'react'
import { Toaster as Sonner } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query'
import { Navigate, BrowserRouter, Route, Routes } from 'react-router-dom'
import { toast } from 'sonner'
import { DashboardLayout } from './components/DashboardLayout'
import { ProtectedRoute } from './components/ProtectedRoute'
import { RouteBoundary } from './components/RouteBoundary'
import { AuthProvider } from './hooks/useAuth'
import DashboardPage from './pages/DashboardPage'

const AdminPage = lazy(() => import('./pages/AdminPage'))
const AchievePortalPage = lazy(() => import('./pages/AchievePortalPage'))
const AgentProfilePage = lazy(() => import('./pages/AgentProfilePage'))
const AlertsPage = lazy(() => import('./pages/AlertsPage'))
const CallDetailPage = lazy(() => import('./pages/CallDetailPage'))
const DispositionAuditPage = lazy(() => import('./pages/DispositionAuditPage'))
const GotaAdoptionPage = lazy(() => import('./pages/GotaAdoptionPage'))
const HelpPage = lazy(() => import('./pages/HelpPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const NotFound = lazy(() => import('./pages/NotFound'))
const SalesFloorInsightsPage = lazy(
  () => import('./pages/SalesFloorInsightsPage'),
)
const TeamPage = lazy(() => import('./pages/TeamPage'))

// Backstop so no read failure is ever fully silent, even on a surface we
// don't individually wire. Inline <ErrorState> remains the primary
// treatment; this dedupes bursts to one toast per few seconds.
let lastErrorToastAt = 0
const queryCache = new QueryCache({
  onError: () => {
    const now = Date.now()
    if (now - lastErrorToastAt < 4000) return
    lastErrorToastAt = now
    toast.error('Something went wrong loading data. Try again in a moment.')
  },
})

const queryClient = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      // Cross-page navigation hits the cache without refetching for a minute.
      staleTime: 60_000,
      // Hold cached results for 10 minutes after their last subscriber unmounts
      // so back-navigating still feels instant.
      gcTime: 10 * 60_000,
      // We invalidate explicitly on data changes; refetching when the tab
      // regains focus or the network reconnects creates surprise reloads.
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: 1,
    },
  },
})

function ProtectedDashboardRoute({ children }: { children: ReactNode }) {
  return (
    <ProtectedRoute>
      <DashboardLayout>
        <RouteBoundary>{children}</RouteBoundary>
      </DashboardLayout>
    </ProtectedRoute>
  )
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route
              path="/login"
              element={
                <RouteBoundary>
                  <LoginPage />
                </RouteBoundary>
              }
            />
            <Route
              path="/achieve"
              element={
                <RouteBoundary>
                  <AchievePortalPage />
                </RouteBoundary>
              }
            />

            <Route
              path="/dashboard"
              element={
                <ProtectedDashboardRoute>
                  <DashboardPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/team"
              element={
                <ProtectedDashboardRoute>
                  <TeamPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/team/:agentEmail"
              element={
                <ProtectedDashboardRoute>
                  <AgentProfilePage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/calls/:callId"
              element={
                <ProtectedDashboardRoute>
                  <CallDetailPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/insights"
              element={
                <ProtectedDashboardRoute>
                  <SalesFloorInsightsPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/gota"
              element={
                <ProtectedDashboardRoute>
                  <GotaAdoptionPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/alerts"
              element={
                <ProtectedDashboardRoute>
                  <AlertsPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/alerts/:callId/:moduleName"
              element={
                <ProtectedDashboardRoute>
                  <AlertsPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/disposition-audit"
              element={
                <ProtectedDashboardRoute>
                  <DispositionAuditPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/help"
              element={
                <ProtectedDashboardRoute>
                  <HelpPage />
                </ProtectedDashboardRoute>
              }
            />
            <Route
              path="/dashboard/admin"
              element={
                <ProtectedDashboardRoute>
                  <AdminPage />
                </ProtectedDashboardRoute>
              }
            />

            <Route path="/" element={<Navigate to="/login" replace />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route
              path="*"
              element={
                <RouteBoundary>
                  <NotFound />
                </RouteBoundary>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
)

export default App
