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

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { DefRef } from '../camperships/kit/DefinitionNotes'
import { formatSignedCount, formatValue } from '../../utils/numberFormat'

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
   * Color semantics for trend direction. 'default': up is green. 'inverse': up is red.
   * 'neutral': either way is blue. 'muted': either way is grey, for a change that is neither
   * good nor bad news (the waitlist, decision 16); the arrow still shows the direction.
   */
  sentiment?: 'default' | 'inverse' | 'neutral' | 'muted' | undefined
  /** Click handler for drilldown functionality */
  onClick?: (() => void) | undefined
  /** The number of the page's numbered note that defines this figure. */
  note?: number | undefined
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
}: MetricCardProps) {
  const trendColors =
    sentiment === 'muted'
      ? {
          up: 'text-muted-foreground',
          down: 'text-muted-foreground',
          neutral: 'text-muted-foreground',
        }
      : sentiment === 'neutral'
        ? {
            up: 'text-blue-600 dark:text-blue-400',
            down: 'text-blue-600 dark:text-blue-400',
            neutral: 'text-muted-foreground',
          }
        : {
            up: 'text-emerald-600 dark:text-emerald-400',
            down: 'text-red-600 dark:text-red-400',
            neutral: 'text-muted-foreground',
          }

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
    onClick ? 'cursor-pointer hover:bg-muted/30 transition-colors' : '',
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
        {displayTrend && displayTrendValue && (
          <span
            className={`flex items-center gap-0.5 text-sm font-medium ${trendColors[displayTrend]}`}
          >
            {(() => {
              const Icon = TrendIcon[displayTrend]
              return <Icon className="h-4 w-4" />
            })()}
            {displayTrendValue}
          </span>
        )}
      </div>
      {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
    </div>
  )
}
