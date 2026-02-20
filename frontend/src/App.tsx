import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { CurrentYearProvider } from './contexts/CurrentYearContext'
import { ScenarioProvider } from './contexts/ScenarioContext'
import { LockGroupProvider } from './contexts/LockGroupContext'
import { ProgramProvider, useProgram } from './contexts/ProgramContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { queryClient } from './utils/queryClient'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminRoute } from './components/AdminRoute'
import { AuthLayout } from './layouts/AuthLayout'
import { AppLayout } from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'
import ProgramLandingPage from './pages/ProgramLandingPage'
import User from './components/User'
import Users from './components/Users'
import './styles/fonts.css'

// Lazy-loaded components for code splitting
// Heavy pages that benefit from separate chunks
const SessionView = lazy(() => import('./components/SessionView'))
const SessionList = lazy(() => import('./components/SessionList'))
const AllCampersView = lazy(() => import('./components/AllCampersView'))
const CamperDetail = lazy(() => import('./components/CamperDetail'))
const AdminConfig = lazy(() =>
  import('./components/AdminConfig').then((m) => ({ default: m.AdminConfig }))
)
const FamilyCampDashboard = lazy(() => import('./pages/FamilyCampDashboard'))
const ScenarioComparisonPage = lazy(() => import('./pages/ScenarioComparisonPage'))
const DebugPage = lazy(() => import('./pages/summer/DebugPage'))
// Metrics module - hierarchical navigation
const MetricsLayout = lazy(() => import('./pages/metrics/MetricsLayout'))
const RegistrationOverview = lazy(() => import('./pages/metrics/registration/RegistrationOverview'))
const GeoAnalysis = lazy(() => import('./pages/metrics/registration/GeoAnalysis'))
const WaitlistAnalysis = lazy(() => import('./pages/metrics/registration/WaitlistAnalysis'))
const SessionAvailability = lazy(
  () => import('./pages/metrics/registration/SessionAvailability')
)
const RetentionOverview = lazy(() => import('./pages/metrics/retention/RetentionOverview'))
const SessionFlowPage = lazy(() => import('./pages/metrics/retention/SessionFlowPage'))
const BunkRetentionPage = lazy(() => import('./pages/metrics/retention/BunkRetentionPage'))
const StaffCabinAnalysisPage = lazy(
  () => import('./pages/metrics/retention/StaffCabinAnalysisPage')
)
const TrendsOverview = lazy(() => import('./pages/metrics/trends/TrendsOverview'))

// Loading skeleton component for route transitions
function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header skeleton */}
      <div className="card-lodge p-6">
        <div className="flex items-center gap-4">
          <div className="bg-muted h-12 w-12 rounded-xl" />
          <div className="flex-1 space-y-2">
            <div className="bg-muted h-6 w-48 rounded-lg" />
            <div className="bg-muted h-4 w-32 rounded-lg" />
          </div>
        </div>
      </div>
      {/* Content skeleton */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="card-lodge space-y-3 p-4">
            <div className="bg-muted h-5 w-3/4 rounded-lg" />
            <div className="bg-muted h-4 w-1/2 rounded-lg" />
            <div className="space-y-2">
              <div className="bg-muted h-3 rounded-lg" />
              <div className="bg-muted h-3 w-5/6 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// Root redirect component - auto-routes to saved program or shows picker
function RootRedirect() {
  const { currentProgram } = useProgram()

  // If user has a saved program preference, go directly there
  if (currentProgram === 'summer') {
    return <Navigate to="/summer/sessions" replace />
  }
  if (currentProgram === 'family') {
    return <Navigate to="/family" replace />
  }
  if (currentProgram === 'metrics') {
    return <Navigate to="/metrics" replace />
  }

  // First-time users see the program picker
  return <ProgramLandingPage />
}

function App() {
  // PocketBase auth is ready immediately since it's initialized synchronously

  return (
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ProgramProvider>
            <BrowserRouter>
              <CurrentYearProvider>
                <ScenarioProvider>
                  <LockGroupProvider>
                    <ErrorBoundary>
                      <Routes>
                        {/* Public routes - no app layout */}
                        <Route element={<AuthLayout />}>
                          <Route path="/login" element={<LoginPage />} />
                        </Route>

                        {/* Protected routes */}
                        <Route element={<ProtectedRoute />}>
                          {/* Program selection - with automatic redirect if already selected */}
                          <Route path="/" element={<RootRedirect />} />

                          {/* Summer Camp routes - with app layout */}
                          <Route path="/summer" element={<AppLayout />}>
                            <Route index element={<Navigate to="/summer/sessions" replace />} />
                            <Route
                              path="sessions"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <SessionList />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="session/:sessionId/*"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <SessionView />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="session/:sessionId/compare"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <ScenarioComparisonPage />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="campers"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <AllCampersView />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="camper/:camperId"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <CamperDetail />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route path="user" element={<User />} />
                            <Route path="users" element={<Users />} />
                            <Route
                              path="admin"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <AdminConfig />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="debug"
                              element={
                                <AdminRoute>
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <DebugPage />
                                    </Suspense>
                                  </ErrorBoundary>
                                </AdminRoute>
                              }
                            />
                          </Route>

                          {/* Metrics routes - hierarchical navigation */}
                          <Route path="/metrics" element={<AppLayout />}>
                            {/* Redirect /metrics to /metrics/registration */}
                            <Route
                              index
                              element={<Navigate to="/metrics/registration" replace />}
                            />

                            {/* Metrics layout with nested routes */}
                            <Route
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <MetricsLayout />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            >
                              {/* Registration section */}
                              <Route
                                path="registration"
                                element={<Navigate to="/metrics/registration/overview" replace />}
                              />
                              <Route
                                path="registration/overview"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <RegistrationOverview />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="registration/geo"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <GeoAnalysis />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="registration/waitlist"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <WaitlistAnalysis />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="registration/availability"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <SessionAvailability />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />

                              {/* Retention section */}
                              <Route
                                path="retention"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <RetentionOverview />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="retention/flow"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <SessionFlowPage />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="retention/bunks"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <BunkRetentionPage />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="retention/staff"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <StaffCabinAnalysisPage />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              {/* Redirect old retention sub-routes */}
                              <Route
                                path="retention/overview"
                                element={<Navigate to="/metrics/retention" replace />}
                              />

                              {/* Trends section */}
                              <Route
                                path="trends"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <TrendsOverview />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                            </Route>

                            <Route path="user" element={<User />} />
                            <Route path="users" element={<Users />} />
                          </Route>

                          {/* Family Camp routes - with app layout */}
                          <Route path="/family" element={<AppLayout />}>
                            <Route
                              index
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <FamilyCampDashboard />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route path="user" element={<User />} />
                            <Route path="users" element={<Users />} />
                          </Route>

                          {/* Legacy redirect for old /user route */}
                          <Route path="/user" element={<Navigate to="/summer/user" replace />} />

                          {/* Catch-all redirect */}
                          <Route path="*" element={<Navigate to="/" replace />} />
                        </Route>
                      </Routes>
                    </ErrorBoundary>
                  </LockGroupProvider>
                </ScenarioProvider>
              </CurrentYearProvider>
            </BrowserRouter>

            <Toaster
              position="top-center"
              gutter={12}
              containerStyle={{
                top: 24,
              }}
              toastOptions={{
                // Base duration increased for better readability
                duration: 6000,
                className: 'toast-lodge',
                style: {
                  background: 'hsl(var(--card))',
                  color: 'hsl(var(--card-foreground))',
                  border: '1px solid hsl(var(--border))',
                  borderRadius: '0.75rem',
                  padding: '1rem 1.25rem',
                  fontSize: '0.9375rem',
                  fontWeight: 500,
                  lineHeight: 1.5,
                  maxWidth: '420px',
                  boxShadow:
                    '0 4px 24px hsl(var(--shadow-color) / 0.12), 0 2px 8px hsl(var(--shadow-color) / 0.08)',
                },
                success: {
                  duration: 5000,
                  className: 'toast-lodge toast-lodge-success',
                  style: {
                    borderLeft: '4px solid hsl(160, 100%, 21%)',
                  },
                  iconTheme: {
                    primary: 'hsl(160, 100%, 21%)',
                    secondary: 'hsl(42, 35%, 97%)',
                  },
                },
                error: {
                  duration: 8000,
                  className: 'toast-lodge toast-lodge-error',
                  style: {
                    borderLeft: '4px solid hsl(0, 72%, 51%)',
                  },
                  iconTheme: {
                    primary: 'hsl(0, 72%, 51%)',
                    secondary: 'hsl(0, 0%, 100%)',
                  },
                },
                loading: {
                  className: 'toast-lodge toast-lodge-info',
                  style: {
                    borderLeft: '4px solid hsl(42, 92%, 62%)',
                  },
                },
              }}
            />
          </ProgramProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
