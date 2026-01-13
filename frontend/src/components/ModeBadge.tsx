/**
 * Compact mode indicator badge
 * Replaces the full-width ModeIndicatorBanner for space efficiency
 */

import { Package, FlaskConical } from 'lucide-react';

interface ModeBadgeProps {
  isProductionMode: boolean;
  scenarioName?: string | undefined;
}

export default function ModeBadge({ isProductionMode, scenarioName }: ModeBadgeProps) {
  if (isProductionMode) {
    return (
      <span
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-300 dark:border-amber-700 w-[70px] justify-center"
        title="Viewing live CampMinder data"
        aria-label="Viewing live CampMinder data"
      >
        <Package className="w-3.5 h-3.5 flex-shrink-0" />
        Live
      </span>
    );
  }

  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 w-[70px] justify-center"
      title={`Draft mode: ${scenarioName || 'Untitled Scenario'}`}
      aria-label={`Draft mode: ${scenarioName || 'Untitled Scenario'}`}
    >
      <FlaskConical className="w-3.5 h-3.5 flex-shrink-0" />
      Draft
    </span>
  );
}
