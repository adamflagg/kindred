/**
 * Compact mode indicator badge
 * Replaces the full-width ModeIndicatorBanner for space efficiency
 */

import { Package, FlaskConical } from 'lucide-react'

interface ModeBadgeProps {
  isProductionMode: boolean
  scenarioName?: string | undefined
}

export default function ModeBadge({ isProductionMode, scenarioName }: ModeBadgeProps) {
  if (isProductionMode) {
    return (
      <span
        className="inline-flex w-[70px] items-center justify-center gap-1.5 rounded-lg border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-700 dark:bg-amber-950/50 dark:text-amber-300"
        title="Viewing live CampMinder data"
        aria-label="Viewing live CampMinder data"
      >
        <Package className="h-3.5 w-3.5 flex-shrink-0" />
        Live
      </span>
    )
  }

  return (
    <span
      className="inline-flex w-[70px] items-center justify-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-700 dark:border-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
      title={`Draft mode: ${scenarioName ?? 'Untitled Scenario'}`}
      aria-label={`Draft mode: ${scenarioName ?? 'Untitled Scenario'}`}
    >
      <FlaskConical className="h-3.5 w-3.5 flex-shrink-0" />
      Draft
    </span>
  )
}
