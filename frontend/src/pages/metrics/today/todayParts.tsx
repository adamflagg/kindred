/**
 * Analytics › Today (#3207 PR 8): the small pieces every card shares.
 */
import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'
import { formatCount } from '../../../utils/numberFormat'
import { DELTA_INK, deltaInk, type DeltaKind } from '../../../utils/deltaTokens'
import { PRIORITY_DAY_PENDING, PRIORITY_DAY_PENDING_CLASS } from '../../../utils/priorityDay'

/**
 * A change against last year in the app-wide delta tokens: "▲ 5", "▼ 22", "level", or "—" when last
 * year's figure can't be had. On the priority date itself a same-point change waits a day (ruling 9).
 */
export function Change({
  now,
  prior,
  kind = 'up-good',
  pending = false,
  testId,
}: {
  now: number
  prior: number | null | undefined
  kind?: DeltaKind
  pending?: boolean
  testId?: string
}) {
  if (pending) {
    return (
      <span data-testid={testId} className={PRIORITY_DAY_PENDING_CLASS}>
        {PRIORITY_DAY_PENDING}
      </span>
    )
  }
  if (prior == null) {
    return (
      <span data-testid={testId} className={DELTA_INK.neutral}>
        —
      </span>
    )
  }
  const delta = now - prior
  if (delta === 0) {
    return (
      <span data-testid={testId} className={`${DELTA_INK.neutral} font-semibold`}>
        level
      </span>
    )
  }
  return (
    <span data-testid={testId} className={`font-semibold tabular-nums ${deltaInk(delta, kind)}`}>
      {delta > 0 ? '▲' : '▼'} {formatCount(Math.abs(delta))}
    </span>
  )
}

/** The card's own loading, error ("Try again") and busy states, so one card never takes another down. */
export function CardState<T>({
  label,
  query,
  onRetry,
  busyWhat,
  children,
}: {
  label: string
  query: {
    data: T | undefined
    isLoading: boolean
    error: Error | null
    isPlaceholderData?: boolean
  }
  onRetry: () => void
  busyWhat: string
  children: (data: T) => ReactNode
}) {
  if (query.isLoading) {
    return (
      <div className="text-muted-foreground flex items-center justify-center gap-2 py-8 text-sm">
        <Loader2 className="text-primary h-5 w-5 animate-spin" />
        Loading {label}…
      </div>
    )
  }
  if (query.error) return <MetricsLoadError label={label} error={query.error} onRetry={onRetry} />
  if (query.data === undefined) {
    return <div className="text-muted-foreground py-8 text-center text-sm">No {label} data yet</div>
  }
  return (
    <MetricsBusy busy={query.isPlaceholderData} what={busyWhat}>
      {children(query.data)}
    </MetricsBusy>
  )
}
