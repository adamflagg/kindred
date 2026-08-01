import { Link, Outlet, useLocation } from 'react-router'
import { ClipboardList, AlertCircle } from 'lucide-react'
import { ErrorBoundary } from './ErrorBoundary'
import { usePermissions } from '../hooks/usePermissions'
import { MANAGE_TABS, canSeeTab, type ManageTabConfig } from '../config/manageTabs'

function ManageLayoutInner() {
  const location = useLocation()
  const { hasPermission, isAdmin } = usePermissions()

  // No blanket admin check here (§2 of the nav-consolidation plan) — this
  // layout hosts tabs with mixed access requirements (four permission-gated,
  // two admin-only), so each tab route guards itself in App.tsx instead
  // (RequirePermission or AdminRoute). A blanket isAdmin check here would
  // lock every non-admin out of Geo/Sheets/Registration/Lodging too — the
  // exact regression #450 fixed. Do not add one back.
  const visibleTabs = MANAGE_TABS.filter((tab) => canSeeTab(tab.access, { hasPermission, isAdmin }))

  const isTabActive = (tab: ManageTabConfig) => location.pathname.startsWith(tab.path)
  const showTabs = visibleTabs.length > 1

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* Header */}
      <div className="from-forest-700 to-forest-800 rounded-xl bg-gradient-to-r px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex items-center gap-2.5 sm:gap-3">
          <div className="rounded-lg bg-white/10 p-1.5 sm:p-2">
            <ClipboardList className="h-5 w-5 text-amber-400 sm:h-6 sm:w-6" />
          </div>
          <div>
            <h1 className="font-display text-lg font-bold text-white sm:text-xl">Management</h1>
            <p className="text-forest-200 text-xs sm:text-sm">
              Staff tools, sync operations and configuration
            </p>
          </div>
        </div>
      </div>

      {/* Tabs — only shown if user has access to 2+ sections */}
      {showTabs && (
        <div className="bg-muted/50 dark:bg-muted flex w-full flex-wrap gap-1.5 rounded-lg p-1.5 sm:w-fit">
          {visibleTabs.map((tab) => {
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
      )}

      {/* Tab Content */}
      <Outlet />
    </div>
  )
}

export function ManageLayout() {
  return (
    <ErrorBoundary
      fallback={(error, reset) => (
        <div className="mx-auto max-w-7xl p-4 sm:p-6">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 sm:p-6 dark:border-red-800 dark:bg-red-950/30">
            <div className="flex items-start gap-3">
              <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-red-600 dark:text-red-400" />
              <div className="min-w-0 flex-1">
                <h3 className="font-display text-sm font-bold text-red-800 sm:text-base dark:text-red-200">
                  Failed to load Management
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
      <ManageLayoutInner />
    </ErrorBoundary>
  )
}
