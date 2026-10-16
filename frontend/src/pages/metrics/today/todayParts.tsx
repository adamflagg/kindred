/**
 * Analytics › Today (#3207 PR 8): the small pieces every card shares.
 */
import { Fragment, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { HELP_HEADER } from '../../../components/camperships/kit/kitStyles'
import { Tooltip } from '../../../components/ui/Tooltip'
import type { ApiTodayPriorPart } from '../../../types/api-types'
import { MetricsBusy, MetricsLoadError } from '../../../components/metrics/MetricsQueryGuard'
import { formatCount } from '../../../utils/numberFormat'
import { DELTA_INK, deltaInk, type DeltaKind } from '../../../utils/deltaTokens'
import { PRIORITY_DAY_PENDING, PRIORITY_DAY_PENDING_CLASS } from '../../../utils/priorityDay'
import { foldedLine } from './todayModel'

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

/**
 * A prior-year figure (PR 8b). With nothing folded in it is plain text. When embedded sessions folded into
 * it (#15) it is the kit's dotted-underline trigger (HELP_HEADER), and hover, focus or a click-to-pin opens
 * ui/Tooltip's bubble with the breakdown on one line (#50, wording A, the round-5 mock):
 * "2026: Session 2 268 · Taste of Camp 2 58 · 2b 66".
 */
export function FoldedFigure({
  parts,
  priorYear,
  children,
}: {
  parts: readonly ApiTodayPriorPart[] | null
  priorYear: number
  children: ReactNode
}) {
  if (!parts) return <>{children}</>
  return (
    <Tooltip
      className={`${HELP_HEADER} rounded-sm p-0 font-normal tabular-nums`}
      content={
        <>
          <div>
            <span className="text-foreground font-semibold">{String(priorYear)}:</span>{' '}
            {foldedLine(parts).map(([name, n], i) => (
              <Fragment key={`${name}-${String(i)}`}>
                {i > 0 && ' · '}
                {name} <span className="font-semibold tabular-nums">{formatCount(n)}</span>
              </Fragment>
            ))}
          </div>
          <div className="text-muted-foreground mt-1">
            Sessions with no {String(priorYear + 1)} match are added to the session that contains
            them. Today only.
          </div>
        </>
      }
    >
      {children}
    </Tooltip>
  )
}
