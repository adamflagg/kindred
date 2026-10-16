/**
 * MetricCard - Display a single metric with optional trend indicator.
 *
 * Supports two modes for showing change:
 * 1. Manual mode: Pass trend ('up'/'down'/'neutral') and trendValue string
 * 2. Auto mode: Pass compareValue and compareYear for automatic delta calculation
 *
 * A number is shown with thousands separators and a change with the true minus sign, through
 * the app-wide `utils/numberFormat` (decision 43). `note` marks the title with a numbered note
 * the page lists at its foot (decision 11): never a hover tooltip.
 */

import type { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus, ChevronRight } from 'lucide-react'
import { DefRef } from '../camperships/kit/DefinitionNotes'
import { formatSignedCount, formatValue } from '../../utils/numberFormat'
import { DELTA_INK } from '../../utils/deltaTokens'

interface MetricCardProps {
  title: string
  value: string | number
  subtitle?: string | undefined
  /** Manual trend direction */
  trend?: 'up' | 'down' | 'neutral' | undefined
  /** Manual trend value string (e.g., "+15%") */
  trendValue?: string | undefined
  /** Comparison value for auto-calculated delta badge */
  compareValue?: number | undefined
  /** Year for comparison label (e.g., "vs 2024") */
  compareYear?: number | undefined
  className?: string | undefined
  /**
   * Color semantics for trend direction, in the app-wide delta tokens (`utils/deltaTokens`). 'default':
   * up is good (forest). 'inverse': up is bad (red). 'neutral' and 'muted': either way is grey, for a
   * change that is neither good nor bad news (New Campers, ruling #17; the waitlist, decision 16); the
   * arrow still shows the direction.
   */
  sentiment?: 'default' | 'inverse' | 'neutral' | 'muted' | undefined
  /** Click handler for drilldown functionality */
  onClick?: (() => void) | undefined
  /** The number of the page's numbered note that defines this figure. */
  note?: number | undefined
  /** A change chip of the page's own, shown in place of the trend chip (Retention's "▲ +1.9 pts", #3207 PR 11). */
  badge?: ReactNode
  /** A muted line under the subtitle (Retention's "2025 had N by this day"). */
  detail?: ReactNode
}

export function MetricCard({
  title,
  value,
  subtitle,
  trend,
  trendValue,
  compareValue,
  compareYear,
  className = '',
  sentiment,
  onClick,
  note,
  badge,
  detail,
}: MetricCardProps) {
  // The app-wide delta tokens (#3207 PR 8, rulings #16, #17): 'neutral' and 'muted' are both grey now.
  const trendColors =
    sentiment === 'muted' || sentiment === 'neutral'
      ? { up: DELTA_INK.neutral, down: DELTA_INK.neutral, neutral: DELTA_INK.neutral }
      : { up: DELTA_INK.good, down: DELTA_INK.bad, neutral: DELTA_INK.neutral }

  const TrendIcon = {
    up: TrendingUp,
    down: TrendingDown,
    neutral: Minus,
  }

  // Calculate auto delta if compareValue is provided
  let autoTrend: 'up' | 'down' | 'neutral' | undefined
  let autoTrendValue: string | undefined

  if (compareValue !== undefined && typeof value === 'number') {
    const delta = value - compareValue
    autoTrend = delta > 0 ? 'up' : delta < 0 ? 'down' : 'neutral'
    autoTrendValue = formatSignedCount(delta)
    if (compareYear) {
      autoTrendValue += ` vs ${compareYear}`
    }
  }

  // Apply sentiment inversion
  const resolvedTrend =
    sentiment === 'inverse' && autoTrend
      ? autoTrend === 'up'
        ? 'down'
        : autoTrend === 'down'
          ? 'up'
          : 'neutral'
      : autoTrend

  // Use manual values if provided, otherwise use auto-calculated
  const displayTrend = trend ?? resolvedTrend
  const displayTrendValue = trendValue ?? autoTrendValue

  // Handle keyboard events for accessibility
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (onClick && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      onClick()
    }
  }

  // Build className with optional interactive styles
  const cardClassName = [
    'card-lodge p-4',
    onClick ? 'group cursor-pointer hover:bg-muted/30 transition-colors' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div
      className={cardClassName}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <p className="text-muted-foreground text-sm font-medium">
        {title}
        {note !== undefined && <DefRef n={note} />}
      </p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-foreground text-2xl font-bold tabular-nums">{formatValue(value)}</p>
        {badge ? (
          <span className="flex items-center text-sm font-medium tabular-nums">{badge}</span>
        ) : (
          displayTrend &&
          displayTrendValue && (
            <span
              className={`flex items-center gap-0.5 text-sm font-medium ${trendColors[displayTrend]}`}
            >
              {(() => {
                const Icon = TrendIcon[displayTrend]
                return <Icon className="h-4 w-4" />
              })()}
              {displayTrendValue}
            </span>
          )
        )}
        {onClick && (
          // D-CUE (owner, 2026-10-15): a card that opens a list says so, always; forest on hover.
          <ChevronRight className="text-muted-foreground group-hover:text-forest-700 dark:group-hover:text-forest-300 ml-auto h-4 w-4 flex-shrink-0 self-center" />
        )}
      </div>
      {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
      {detail && <p className="text-muted-foreground mt-0.5 text-xs tabular-nums">{detail}</p>}
    </div>
  )
}
