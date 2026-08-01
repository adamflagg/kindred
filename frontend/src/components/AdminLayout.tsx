import { Link, Outlet, useLocation } from 'react-router'
import { Settings, AlertCircle } from 'lucide-react'
import { ErrorBoundary } from './ErrorBoundary'
import { useIsAdmin } from '../hooks/useIsAdmin'
import { ADMIN_TABS, type AdminTabConfig } from '../config/adminTabs'
import PermissionDeniedPage from '../pages/PermissionDeniedPage'

function AdminLayoutInner() {
  const location = useLocation()
  const isAdmin = useIsAdmin()

  // Filtering the tab list never stopped anyone typing the URL (#1895). The
  // /manage routes each carry a RequirePermission; /admin has no equivalent,
  // so the layout every admin route shares is where the guard belongs.
  //
  // Gating on isAdmin rather than "has at least one visible tab": those are the
  // same test only because `AdminTabConfig.requiredPermission` is the literal
  // 'admin'. Writing it as the tab count would read as a per-route check while
  // actually being an any-route one — a user who could see tab A would reach
  // tab B's URL. See the type's own comment for why that case is a compile
  // error now rather than a comment nobody reads.
  if (!isAdmin) {
    return <PermissionDeniedPage />
  }

  const isTabActive = (tab: AdminTabConfig) => location.pathname.startsWith(tab.path)

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="from-forest-700 to-forest-800 rounded-xl bg-gradient-to-r px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="rounded-lg bg-white/10 p-1.5 sm:p-2">
            <Settings className="h-5 w-5 text-amber-400 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-white sm:text-xl">
              Admin Control Center
            </h1>
            <p className="text-forest-200 text-xs sm:text-sm">
              Sync operations and optimizer settings
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-muted/50 dark:bg-muted flex w-full gap-1.5 rounded-lg p-1.5 sm:w-fit">
        {ADMIN_TABS.map((tab) => {
          const Icon = tab.icon
          return (
            <Link
              key={tab.id}
              to={tab.path}
              className={`flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-semibold transition-colors sm:flex-none sm:px-5 sm:text-base ${
                isTabActive(tab)
                  ? 'bg-card text-forest-800 dark:text-forest-200 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="h-4 w-4 sm:h-5 sm:w-5" />
              {tab.label}
            </Link>
          )
        })}
      </div>

      {/* Tab Content */}
      <Outlet />
    </div>
  )
}

export function AdminLayout() {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="mx-auto max-w-7xl p-4 sm:p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 sm:p-6 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-sm font-bold text-red-800 sm:text-base dark:text-red-200">
                  Failed to load Admin Configuration
                </h3>
                <p className="mt-1 text-sm text-red-600 dark:text-red-400">{error.message}</p>
                <button
                  onClick={reset}
                  className="mt-4 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                >
                  Try Again
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    >
      <AdminLayoutInner />
    </ErrorBoundary>
  )
}
