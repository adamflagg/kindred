/**
 * MetricsQueryGuard - Loading/error/empty state handler for metrics pages.
 *
 * Eliminates boilerplate loading/error/empty state patterns that were
 * repeated across 5+ metrics page components (~25 lines each).
 *
 * D-UNCOVERED (owner, 2026-10-15; #3207): an error offers "Try again" (React Query has already
 * retried three times by itself), and while the previous result stands in for the next one
 * (`keepPreviousData`) the old numbers dim and go inert under "Loading 2025…", so a new season's
 * label never sits over the old season's numbers unmarked. Pages that handle their states inline
 * use `MetricsLoadError` and `MetricsBusy` directly.
 */

import type { ReactNode } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { CS_BTN } from '../camperships/kit/csType'

/** The red error line, with "Try again" when the page can refetch. */
export function MetricsLoadError({
  label,
  error,
  onRetry,
}: {
  label: string
  error: Error
  onRetry?: (() => void) | undefined
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-12">
      <div className="flex items-center text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>
          Failed to load {label} data: {error.message}
        </span>
      </div>
      {onRetry && (
        <button type="button" className={CS_BTN} onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  )
}

/** The busy cue: while `busy`, the children dim and go inert under "Loading {what}…". */
export function MetricsBusy({
  busy,
  what,
  children,
}: {
  busy: boolean | undefined
  what: string | undefined
  children: ReactNode
}) {
  if (!busy) return <>{children}</>
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
        <Loader2 className="text-primary h-4 w-4 animate-spin" />
        {what ? `Loading ${what}…` : 'Loading…'}
      </p>
      <div inert className="pointer-events-none opacity-50 transition-opacity select-none">
        {children}
      </div>
    </div>
  )
}

interface MetricsQueryGuardProps<T> {
  isLoading: boolean
  error: Error | null
  data: T | undefined
  label: string
  emptyMessage?: string
  /** Refetch, offered as "Try again" on an error. */
  onRetry?: (() => void) | undefined
  /** The query is showing the previous result while the next loads. */
  isPlaceholderData?: boolean | undefined
  /** What is loading, for "Loading 2025…": the season (or scope) being fetched. */
  loadingLabel?: string | undefined
  children: (data: T) => ReactNode
}

export function MetricsQueryGuard<T>({
  isLoading,
  error,
  data,
  label,
  emptyMessage,
  onRetry,
  isPlaceholderData,
  loadingLabel,
  children,
}: MetricsQueryGuardProps<T>) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="text-primary h-8 w-8 animate-spin" />
        <span className="text-muted-foreground ml-2">Loading {label} data...</span>
      </div>
    )
  }

  if (error) {
    return <MetricsLoadError label={label} error={error} onRetry={onRetry} />
  }

  if (!data) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        {emptyMessage ?? 'No data available'}
      </div>
    )
  }

  return (
    <MetricsBusy busy={isPlaceholderData} what={loadingLabel}>
      {children(data)}
    </MetricsBusy>
  )
}
