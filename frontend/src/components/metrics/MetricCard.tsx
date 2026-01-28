/**
 * MetricCard - Display a single metric with optional trend indicator.
 *
 * Supports two modes for showing change:
 * 1. Manual mode: Pass trend ('up'/'down'/'neutral') and trendValue string
 * 2. Auto mode: Pass compareValue and compareYear for automatic delta calculation
 */

import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  subtitle?: string | undefined;
  /** Manual trend direction */
  trend?: 'up' | 'down' | 'neutral' | undefined;
  /** Manual trend value string (e.g., "+15%") */
  trendValue?: string | undefined;
  /** Comparison value for auto-calculated delta badge */
  compareValue?: number | undefined;
  /** Year for comparison label (e.g., "vs 2024") */
  compareYear?: number | undefined;
  className?: string | undefined;
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
}: MetricCardProps) {
  const trendColors = {
    up: 'text-emerald-600 dark:text-emerald-400',
    down: 'text-red-600 dark:text-red-400',
    neutral: 'text-muted-foreground',
  };

  const TrendIcon = {
    up: TrendingUp,
    down: TrendingDown,
    neutral: Minus,
  };

  // Calculate auto delta if compareValue is provided
  let autoTrend: 'up' | 'down' | 'neutral' | undefined;
  let autoTrendValue: string | undefined;

  if (compareValue !== undefined && typeof value === 'number') {
    const delta = value - compareValue;
    if (delta > 0) {
      autoTrend = 'up';
      autoTrendValue = `+${delta}`;
    } else if (delta < 0) {
      autoTrend = 'down';
      autoTrendValue = `${delta}`;
    } else {
      autoTrend = 'neutral';
      autoTrendValue = '0';
    }
    if (compareYear) {
      autoTrendValue += ` vs ${compareYear}`;
    }
  }

  // Use manual values if provided, otherwise use auto-calculated
  const displayTrend = trend ?? autoTrend;
  const displayTrendValue = trendValue ?? autoTrendValue;

  return (
    <div className={`card-lodge p-4 ${className}`}>
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="text-2xl font-bold text-foreground">{value}</p>
        {displayTrend && displayTrendValue && (
          <span className={`flex items-center gap-0.5 text-sm font-medium ${trendColors[displayTrend]}`}>
            {(() => {
              const Icon = TrendIcon[displayTrend];
              return <Icon className="w-4 h-4" />;
            })()}
            {displayTrendValue}
          </span>
        )}
      </div>
      {subtitle && (
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
      )}
    </div>
  );
}
