import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster, ToastBar, toast } from 'react-hot-toast'
import { ThemeProvider } from './contexts/ThemeContext'
import { AuthProvider } from './contexts/AuthContext'
import { CurrentYearProvider } from './contexts/CurrentYearContext'
import { ScenarioProvider } from './contexts/ScenarioContext'
import { LockGroupProvider } from './contexts/LockGroupContext'
import { ProgramProvider, useProgram } from './contexts/ProgramContext'
import { ErrorBoundary } from './components/ErrorBoundary'
import { queryClient } from './utils/queryClient'
import { getProgramHomeUrl } from './utils/programUrls'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AdminRoute } from './components/AdminRoute'
import { RequirePermission } from './components/RequirePermission'
import { Permission } from './constants/permissions'
import { usePermissions } from './hooks/usePermissions'
import { useAuth } from './contexts/AuthContext'
import { MANAGE_TABS, canSeeTab } from './config/manageTabs'
import { AuthLayout } from './layouts/AuthLayout'
import { AppLayout } from './layouts/AppLayout'
import LoginPage from './pages/LoginPage'
import ProgramLandingPage from './pages/ProgramLandingPage'
import './styles/fonts.css'

// Lazy-loaded components for code splitting
// Heavy pages that benefit from separate chunks
const User = lazy(() => import('./components/User'))
const Users = lazy(() => import('./components/Users'))
const SessionView = lazy(() => import('./components/SessionView'))
const SessionList = lazy(() => import('./components/SessionList'))
const AllCampersView = lazy(() => import('./components/AllCampersView'))
const CamperDetail = lazy(() => import('./components/CamperDetail'))
const SyncTab = lazy(() =>
  import('./components/admin/SyncTab').then((m) => ({ default: m.SyncTab }))
)
const ConfigTab = lazy(() =>
  import('./components/admin/ConfigTab').then((m) => ({ default: m.ConfigTab }))
)
const LodgingSettingsTab = lazy(() =>
  import('./components/admin/lodging/LodgingSettingsTab').then((m) => ({
    default: m.LodgingSettingsTab,
  }))
)
const SheetsTab = lazy(() =>
  import('./components/admin/SheetsTab').then((m) => ({ default: m.SheetsTab }))
)
const GeoDataTab = lazy(() =>
  import('./components/admin/GeoDataTab').then((m) => ({ default: m.GeoDataTab }))
)
const ManageLayout = lazy(() =>
  import('./components/ManageLayout').then((m) => ({ default: m.ManageLayout }))
)
const ManageRegistrationPage = lazy(() =>
  import('./components/manage/ManageRegistrationPage').then((m) => ({
    default: m.ManageRegistrationPage,
  }))
)
const WeekendSessionList = lazy(() => import('./pages/WeekendSessionList'))
const WeekendRosterPage = lazy(() => import('./pages/WeekendRosterPage'))
const ScenarioComparisonPage = lazy(() => import('./pages/ScenarioComparisonPage'))
const PipelineDebugPage = lazy(() => import('./pages/summer/PipelineDebugPage'))
const ParseAnalysisPage = lazy(() => import('./pages/summer/ParseAnalysisPage'))
const PromptEditorPage = lazy(() => import('./pages/summer/PromptEditorPage'))
const SolverDebugPage = lazy(() => import('./pages/summer/SolverDebugPage'))
// Camp Analytics module - hierarchical navigation
const MetricsLayout = lazy(() => import('./pages/metrics/MetricsLayout'))
const RegistrationOverview = lazy(() => import('./pages/metrics/registration/RegistrationOverview'))
const GeoAnalysis = lazy(() => import('./pages/metrics/registration/GeoAnalysis'))
const WaitlistAnalysis = lazy(() => import('./pages/metrics/registration/WaitlistAnalysis'))
const SessionAvailability = lazy(() => import('./pages/metrics/registration/SessionAvailability'))
const ForecastPage = lazy(() => import('./pages/metrics/registration/ForecastPage'))
const CancellationAnalysis = lazy(() => import('./pages/metrics/registration/CancellationAnalysis'))
const Day1Page = lazy(() => import('./pages/metrics/registration/Day1Page'))
const RetentionOverview = lazy(() => import('./pages/metrics/retention/RetentionOverview'))
const SessionFlowPage = lazy(() => import('./pages/metrics/retention/SessionFlowPage'))
const BunkRetentionPage = lazy(() => import('./pages/metrics/retention/BunkRetentionPage'))
const StaffCabinAnalysisPage = lazy(
  () => import('./pages/metrics/retention/StaffCabinAnalysisPage')
)
const TrendsOverview = lazy(() => import('./pages/metrics/trends/TrendsOverview'))
const VelocityPage = lazy(() => import('./pages/metrics/trends/VelocityPage'))
const CancellationVelocityPage = lazy(
  () => import('./pages/metrics/trends/CancellationVelocityPage')
)
const PostCheckPopout = lazy(() => import('./pages/PostCheckPopout'))
const CamperPopout = lazy(() => import('./pages/CamperPopout'))

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
  if (currentProgram) {
    return <Navigate to={getProgramHomeUrl(currentProgram)} replace />
  }

  // First-time users see the program picker
  return <ProgramLandingPage />
}

// Redirect helper for parameterized camper routes
function CamperRedirect() {
  const { camperId } = useParams()
  return <Navigate to={`/camper/${camperId}`} replace />
}

// Redirect helper for /admin/config/:category — a bare Navigate can't forward
// the param, so this small component reads it and rebuilds the /manage path.
function AdminConfigCategoryRedirect() {
  const { category } = useParams()
  return <Navigate to={`/manage/config/${category}`} replace />
}

// Smart redirect to first permitted manage tab
function ManageRedirect() {
  const { isLoading } = useAuth()
  const { hasPermission, isAdmin } = usePermissions()

  if (isLoading) return null // parent Suspense shows skeleton

  const firstPermitted = MANAGE_TABS.find((tab) =>
    canSeeTab(tab.access, { hasPermission, isAdmin })
  )
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- MANAGE_TABS is a compile-time constant, always non-empty
  return <Navigate to={firstPermitted?.path ?? MANAGE_TABS[0]!.path} replace />
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

                          {/* Global routes — program context preserved via ProgramContext */}
                          <Route element={<AppLayout />}>
                            <Route
                              path="/campers"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <AllCampersView />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="/camper/:camperId"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <CamperDetail />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="/users"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <Users />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="/user"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <User />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                          </Route>

                          {/* Admin routes - permanent redirects into /manage (#1895, #450) */}
                          <Route path="/admin" element={<Navigate to="/manage" replace />} />
                          <Route
                            path="/admin/sync"
                            element={<Navigate to="/manage/sync" replace />}
                          />
                          <Route
                            path="/admin/config"
                            element={<Navigate to="/manage/config/solver" replace />}
                          />
                          <Route
                            path="/admin/config/:category"
                            element={<AdminConfigCategoryRedirect />}
                          />

                          {/* Manage routes - staff-facing management tools. Each tab route
                              below carries its own guard (RequirePermission or AdminRoute) —
                              the layout has no blanket check, since the tabs it hosts have
                              mixed access requirements (see manageTabs.ts TabAccess). */}
                          <Route path="/manage" element={<AppLayout />}>
                            <Route index element={<ManageRedirect />} />
                            <Route
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <ManageLayout />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            >
                              <Route
                                path="geo/*"
                                element={
                                  <RequirePermission permission={Permission.METRICS_GEO}>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <GeoDataTab />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </RequirePermission>
                                }
                              />
                              <Route
                                path="registration"
                                element={
                                  <RequirePermission permission={Permission.REGISTRATION_MANAGE}>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <ManageRegistrationPage />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </RequirePermission>
                                }
                              />
                              <Route
                                path="sheets"
                                element={
                                  <RequirePermission permission={Permission.SHEETS_EXPORT}>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <SheetsTab />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </RequirePermission>
                                }
                              />
                              <Route
                                path="lodging"
                                element={<Navigate to="/manage/lodging/units" replace />}
                              />
                              <Route
                                path="lodging/:section"
                                element={
                                  <RequirePermission permission={Permission.BUNKING_MANAGE}>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <LodgingSettingsTab />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </RequirePermission>
                                }
                              />
                              <Route
                                path="sync"
                                element={
                                  <AdminRoute>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <SyncTab />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </AdminRoute>
                                }
                              />
                              <Route
                                path="config"
                                element={<Navigate to="/manage/config/solver" replace />}
                              />
                              <Route
                                path="config/:category"
                                element={
                                  <AdminRoute>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <ConfigTab />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </AdminRoute>
                                }
                              />
                            </Route>
                          </Route>

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
                            {/* Redirects for routes moved to global */}
                            <Route path="campers" element={<Navigate to="/campers" replace />} />
                            <Route path="camper/:camperId" element={<CamperRedirect />} />
                            <Route path="user" element={<Navigate to="/user" replace />} />
                            <Route path="users" element={<Navigate to="/users" replace />} />
                            <Route path="admin" element={<Navigate to="/manage" replace />} />
                            {/* Debug routes — pipeline trace tool + prompt editor */}
                            <Route path="debug">
                              <Route
                                index
                                element={<Navigate to="/summer/debug/pipeline" replace />}
                              />
                              <Route
                                path="pipeline"
                                element={
                                  <AdminRoute>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <PipelineDebugPage />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </AdminRoute>
                                }
                              />
                              <Route
                                path="pipeline/:traceId"
                                element={
                                  <AdminRoute>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <PipelineDebugPage />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </AdminRoute>
                                }
                              />
                              <Route
                                path="prompts"
                                element={<Navigate to="/summer/debug/parse-analysis" replace />}
                              />
                              <Route
                                path="parse-analysis"
                                element={
                                  <AdminRoute>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <ParseAnalysisPage />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </AdminRoute>
                                }
                              />
                              <Route
                                path="prompt-editor"
                                element={
                                  <AdminRoute>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <PromptEditorPage />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </AdminRoute>
                                }
                              />
                              <Route
                                path="solver"
                                element={
                                  <AdminRoute>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <SolverDebugPage />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </AdminRoute>
                                }
                              />
                            </Route>
                          </Route>

                          {/* Camp Analytics routes - hierarchical navigation */}
                          <Route path="/analytics" element={<AppLayout />}>
                            {/* Redirect /analytics to /analytics/registration */}
                            <Route
                              index
                              element={<Navigate to="/analytics/registration" replace />}
                            />

                            {/* Camp Analytics layout with nested routes */}
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
                                element={<Navigate to="/analytics/registration/overview" replace />}
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
                              <Route
                                path="registration/forecast"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <ForecastPage />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="registration/cancellations"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <CancellationAnalysis />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="registration/day1"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <Day1Page />
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
                                  <RequirePermission permission={Permission.STAFF_HIRING}>
                                    <ErrorBoundary>
                                      <Suspense fallback={<PageSkeleton />}>
                                        <StaffCabinAnalysisPage />
                                      </Suspense>
                                    </ErrorBoundary>
                                  </RequirePermission>
                                }
                              />
                              {/* Redirect old retention sub-routes */}
                              <Route
                                path="retention/overview"
                                element={<Navigate to="/analytics/retention" replace />}
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
                              <Route
                                path="trends/velocity"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <VelocityPage />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                              <Route
                                path="trends/cancellations"
                                element={
                                  <ErrorBoundary>
                                    <Suspense fallback={<PageSkeleton />}>
                                      <CancellationVelocityPage />
                                    </Suspense>
                                  </ErrorBoundary>
                                }
                              />
                            </Route>

                            {/* Redirects for routes moved to global */}
                            <Route path="user" element={<Navigate to="/user" replace />} />
                            <Route path="users" element={<Navigate to="/users" replace />} />
                          </Route>

                          {/* Weekend Housing routes - with app layout */}
                          <Route path="/weekend" element={<AppLayout />}>
                            <Route index element={<Navigate to="/weekend/sessions" replace />} />
                            <Route
                              path="sessions"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <WeekendSessionList />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            <Route
                              path="session/:sessionCmId"
                              element={
                                <ErrorBoundary>
                                  <Suspense fallback={<PageSkeleton />}>
                                    <WeekendRosterPage />
                                  </Suspense>
                                </ErrorBoundary>
                              }
                            />
                            {/* Redirects for routes moved to global */}
                            <Route path="user" element={<Navigate to="/user" replace />} />
                            <Route path="users" element={<Navigate to="/users" replace />} />
                          </Route>

                          {/* Popout routes — bare windows with no app shell */}
                          <Route
                            path="/session/:sessionId/post-check"
                            element={
                              <ErrorBoundary>
                                <Suspense fallback={<PageSkeleton />}>
                                  <PostCheckPopout />
                                </Suspense>
                              </ErrorBoundary>
                            }
                          />
                          {/* Camper details popout — /camper/:camperId/popout must be registered
                              outside AppLayout and BEFORE the catch-all so React Router matches
                              it as a top-level route. More-specific paths like
                              /camper/123/popout beat the AppLayout-nested /camper/:camperId
                              because this route is matched first in the ProtectedRoute branch. */}
                          <Route
                            path="/camper/:camperId/popout"
                            element={
                              <ErrorBoundary>
                                <Suspense fallback={<PageSkeleton />}>
                                  <CamperPopout />
                                </Suspense>
                              </ErrorBoundary>
                            }
                          />

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
            >
              {(t) => (
                <ToastBar toast={t}>
                  {({ icon, message }) => (
                    <>
                      {icon}
                      {message}
                      {t.type !== 'loading' && (
                        <button
                          onClick={() => toast.dismiss(t.id)}
                          className="ml-1 flex-shrink-0 rounded p-0.5 opacity-40 transition-opacity hover:opacity-100"
                          aria-label="Dismiss"
                        >
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        </button>
                      )}
                    </>
                  )}
                </ToastBar>
              )}
            </Toaster>
          </ProgramProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  )
}

export default App
