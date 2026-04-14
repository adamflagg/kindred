/**
 * ActionButtons - Shared phase-replay buttons for detail panels.
 *
 * Both buttons are dry-run-only developer/staff iteration tools. Production
 * writes are exclusively handled by "Reprocess from source" (run-full-trace).
 *
 * - "Rerun this phase": isolated single-phase execution (uses stop_at_phase
 *   on the backend). Downstream phases are unchanged. Useful for prompt
 *   engineering or A/B testing a single phase's logic.
 * - "Run From Here": cascade from this phase through the end of the pipeline.
 *   Useful for vetting how a logic change ripples through downstream phases.
 */

import { Play, FastForward } from 'lucide-react'

export interface ActionButtonsProps {
  onRerunPhase: () => void
  onRunFromHere: () => void
  isRunning?: boolean | undefined
}

export function ActionButtons({
  onRerunPhase,
  onRunFromHere,
  isRunning = false,
}: ActionButtonsProps) {
  return (
    <div className="border-border flex flex-wrap items-center gap-3 border-t pt-4">
      <button
        onClick={onRerunPhase}
        disabled={isRunning}
        className="inline-flex items-center gap-1.5 rounded-lg bg-blue-50 px-3 py-1.5 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50"
        aria-label="Rerun this phase"
      >
        <Play className="h-3.5 w-3.5" />
        Rerun this phase
      </button>

      <button
        onClick={onRunFromHere}
        disabled={isRunning}
        className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50 dark:bg-amber-900/30 dark:text-amber-300 dark:hover:bg-amber-900/50"
        aria-label="Run From Here"
      >
        <FastForward className="h-3.5 w-3.5" />
        Run From Here
      </button>
    </div>
  )
}
