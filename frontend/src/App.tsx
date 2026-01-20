import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'react-hot-toast';
import { ThemeProvider } from './contexts/ThemeContext';
import { AuthProvider } from './contexts/AuthContext';
import { CurrentYearProvider } from './contexts/CurrentYearContext';
import { ScenarioProvider } from './contexts/ScenarioContext';
import { LockGroupProvider } from './contexts/LockGroupContext';
import { ProgramProvider, useProgram } from './contexts/ProgramContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { queryClient } from './utils/queryClient';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AdminRoute } from './components/AdminRoute';
import { AuthLayout } from './layouts/AuthLayout';
import { AppLayout } from './layouts/AppLayout';
import LoginPage from './pages/LoginPage';
import ProgramLandingPage from './pages/ProgramLandingPage';
import User from './components/User';
import Users from './components/Users';
import './styles/fonts.css';

// Lazy-loaded components for code splitting
// Heavy pages that benefit from separate chunks
const SessionView = lazy(() => import('./components/SessionView'));
const SessionList = lazy(() => import('./components/SessionList'));
const AllCampersView = lazy(() => import('./components/AllCampersView'));
const CamperDetail = lazy(() => import('./components/CamperDetail'));
const AdminConfig = lazy(() => import('./components/AdminConfig').then(m => ({ default: m.AdminConfig })));
const FamilyCampDashboard = lazy(() => import('./pages/FamilyCampDashboard'));
const ScenarioComparisonPage = lazy(() => import('./pages/ScenarioComparisonPage'));
const DebugPage = lazy(() => import('./pages/summer/DebugPage'));
const RegistrationMetricsPage = lazy(() => import('./pages/metrics/RegistrationMetricsPage').then(m => ({ default: m.RegistrationMetricsPage })));

// Loading skeleton component for route transitions
function PageSkeleton() {
  return (
    <div className="animate-pulse space-y-6 p-6">
      {/* Header skeleton */}
      <div className="card-lodge p-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-muted rounded-xl" />
          <div className="space-y-2 flex-1">
            <div className="h-6 bg-muted rounded-lg w-48" />
            <div className="h-4 bg-muted rounded-lg w-32" />
          </div>
        </div>
      </div>
      {/* Content skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="card-lodge p-4 space-y-3">
            <div className="h-5 bg-muted rounded-lg w-3/4" />
            <div className="h-4 bg-muted rounded-lg w-1/2" />
            <div className="space-y-2">
              <div className="h-3 bg-muted rounded-lg" />
              <div className="h-3 bg-muted rounded-lg w-5/6" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Root redirect component - auto-routes to saved program or shows picker
function RootRedirect() {
  const { currentProgram } = useProgram();

  // If user has a saved program preference, go directly there
  if (currentProgram === 'summer') {
    return <Navigate to="/summer/sessions" replace />;
  }
  if (currentProgram === 'family') {
    return <Navigate to="/family" replace />;
  }
  if (currentProgram === 'metrics') {
    return <Navigate to="/metrics" replace />;
  }

  // First-time users see the program picker
  return <ProgramLandingPage />;
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
                          <Route path="sessions" element={
                            <Suspense fallback={<PageSkeleton />}>
                              <SessionList />
                            </Suspense>
                          } />
                          <Route path="session/:sessionId/*" element={
                            <Suspense fallback={<PageSkeleton />}>
                              <SessionView />
                            </Suspense>
                          } />
                          <Route path="session/:sessionId/compare" element={
                            <Suspense fallback={<PageSkeleton />}>
                              <ScenarioComparisonPage />
                            </Suspense>
                          } />
                          <Route path="campers" element={
                            <Suspense fallback={<PageSkeleton />}>
                              <AllCampersView />
                            </Suspense>
                          } />
                          <Route path="camper/:camperId" element={
                            <Suspense fallback={<PageSkeleton />}>
                              <CamperDetail />
                            </Suspense>
                          } />
                          <Route path="user" element={<User />} />
                          <Route path="users" element={<Users />} />
                          <Route path="admin" element={
                            <Suspense fallback={<PageSkeleton />}>
                              <AdminConfig />
                            </Suspense>
                          } />
                          <Route path="debug" element={
                            <AdminRoute>
                              <Suspense fallback={<PageSkeleton />}>
                                <DebugPage />
                              </Suspense>
                            </AdminRoute>
                          } />
                        </Route>

                        {/* Metrics routes - top-level program */}
                        <Route path="/metrics" element={<AppLayout />}>
                          <Route index element={
                            <Suspense fallback={<PageSkeleton />}>
                              <RegistrationMetricsPage />
                            </Suspense>
                          } />
                        </Route>

                        {/* Family Camp routes - with app layout */}
                        <Route path="/family" element={<AppLayout />}>
                          <Route index element={
                            <Suspense fallback={<PageSkeleton />}>
                              <FamilyCampDashboard />
                            </Suspense>
                          } />
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
                    boxShadow: '0 4px 24px hsl(var(--shadow-color) / 0.12), 0 2px 8px hsl(var(--shadow-color) / 0.08)',
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
  );
}

export default App;