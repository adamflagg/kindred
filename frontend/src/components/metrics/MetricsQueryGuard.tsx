/**
 * MetricsQueryGuard - Loading/error/empty state handler for metrics pages.
 *
 * Eliminates boilerplate loading/error/empty state patterns that were
 * repeated across 5+ metrics page components (~25 lines each).
 */

import type { ReactNode } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'

interface MetricsQueryGuardProps<T> {
  isLoading: boolean
  error: Error | null
  data: T | undefined
  label: string
  emptyMessage?: string
  children: (data: T) => ReactNode
}

export function MetricsQueryGuard<T>({
  isLoading,
  error,
  data,
  label,
  emptyMessage,
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
    return (
      <div className="flex items-center justify-center py-12 text-red-600 dark:text-red-400">
        <AlertCircle className="mr-2 h-6 w-6" />
        <span>
          Failed to load {label} data: {error.message}
        </span>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="text-muted-foreground flex items-center justify-center py-12">
        {emptyMessage ?? 'No data available'}
      </div>
    )
  }

  return <>{children(data)}</>
}
