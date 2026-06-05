import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  QueryClient,
  QueryClientProvider,
  QueryCache,
} from "@tanstack/react-query";
import { toast } from "sonner";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./hooks/useAuth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { DashboardLayout } from "./components/DashboardLayout";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import CallDetailPage from "./pages/CallDetailPage";
import AlertsPage from "./pages/AlertsPage";
import TeamPage from "./pages/TeamPage";
import AgentProfilePage from "./pages/AgentProfilePage";
import HelpPage from "./pages/HelpPage";
import NotFound from "./pages/NotFound";

// Backstop so no read failure is ever fully silent, even on a surface we
// don't individually wire. Inline <ErrorState> remains the primary
// treatment; this dedupes bursts to one toast per few seconds.
let lastErrorToastAt = 0;
const queryCache = new QueryCache({
  onError: () => {
    const now = Date.now();
    if (now - lastErrorToastAt < 4000) return;
    lastErrorToastAt = now;
    toast.error("Something went wrong loading data. Try again in a moment.");
  },
});

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
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <AuthProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            
            <Route
              path="/dashboard"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <DashboardPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard/team"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <TeamPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard/team/:agentEmail"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <AgentProfilePage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard/calls/:callId"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <CallDetailPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard/alerts"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <AlertsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard/alerts/:callId/:moduleName"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <AlertsPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            <Route
              path="/dashboard/help"
              element={
                <ProtectedRoute>
                  <DashboardLayout>
                    <HelpPage />
                  </DashboardLayout>
                </ProtectedRoute>
              }
            />

            <Route path="/" element={<Navigate to="/login" replace />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
