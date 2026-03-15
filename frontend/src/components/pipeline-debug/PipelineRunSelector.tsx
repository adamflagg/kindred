/**
 * PipelineRunSelector - Dropdown to select pipeline debug runs with metadata display.
 *
 * Shows a dropdown of recent runs with: timestamp, session, source_fields,
 * trace count, status breakdown (resolved/pending/declined), pinned status.
 * Pin toggle button for the selected run.
 */

import { Pin, PinOff, Loader2 } from 'lucide-react'
import type { PipelineRun } from './types'

interface PipelineRunSelectorProps {
  runs: PipelineRun[]
  selectedRunId: string | null
  onSelectRun: (runId: string | null) => void
  onTogglePin: (runId: string) => void
  isPinning: boolean
}

/** Format an ISO date string for display in the run list. */
function formatRunDate(isoDate: string): string {
  try {
    const d = new Date(isoDate)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoDate
  }
}

export function PipelineRunSelector({
  runs,
  selectedRunId,
  onSelectRun,
  onTogglePin,
  isPinning,
}: PipelineRunSelectorProps) {
  const selectedRun = runs.find((r) => r.run_id === selectedRunId)

  if (runs.length === 0) {
    return (
      <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 p-4 text-center">
        <p className="text-muted-foreground text-sm">
          No pipeline runs found. Process requests with trace collection enabled to generate runs.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Dropdown + Pin button row */}
      <div className="flex items-center gap-2">
        <select
          role="combobox"
          value={selectedRunId ?? ''}
          onChange={(e) => onSelectRun(e.target.value || null)}
          className="border-bark-300 bg-parchment-50 text-foreground dark:border-bark-600 dark:bg-bark-800 flex-1 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500/50 focus:outline-none"
        >
          <option value="">Select a run...</option>
          {runs.map((run) => (
            <option key={run.run_id} value={run.run_id}>
              {formatRunDate(run.created)} — Session: {run.session} — {run.trace_count} traces
              {run.pinned ? ' (pinned)' : ''}
            </option>
          ))}
        </select>

        {selectedRun && (
          <button
            onClick={() => onTogglePin(selectedRun.run_id)}
            disabled={isPinning}
            aria-label={selectedRun.pinned ? 'Unpin this run' : 'Pin this run'}
            className={`flex-shrink-0 rounded-lg p-2 transition-all duration-200 ${
              selectedRun.pinned
                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-900/40 dark:text-amber-400 dark:hover:bg-amber-900/60'
                : 'bg-bark-100 text-bark-500 hover:bg-bark-200 dark:bg-bark-700 dark:text-bark-400 dark:hover:bg-bark-600'
            } disabled:opacity-50`}
          >
            {isPinning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : selectedRun.pinned ? (
              <PinOff className="h-4 w-4" />
            ) : (
              <Pin className="h-4 w-4" />
            )}
          </button>
        )}
      </div>

      {/* Metadata panel for selected run */}
      {selectedRun && (
        <div className="card-lodge bg-parchment-100/30 dark:bg-bark-900/20 p-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
            {/* Status breakdown */}
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                {selectedRun.status_breakdown.resolved}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:bg-amber-900/40 dark:text-amber-400">
                {selectedRun.status_breakdown.pending}
              </span>
              <span className="inline-flex items-center gap-1 rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-400">
                {selectedRun.status_breakdown.declined}
              </span>
            </div>

            {/* Source fields */}
            <div className="flex items-center gap-1.5">
              <span className="text-muted-foreground text-xs">Fields:</span>
              {selectedRun.source_fields.map((field) => (
                <span
                  key={field}
                  className="bg-bark-100 text-bark-600 dark:bg-bark-700 dark:text-bark-300 rounded px-1.5 py-0.5 text-xs"
                >
                  {field}
                </span>
              ))}
            </div>

            {/* Force indicator */}
            {selectedRun.force && (
              <span className="rounded-md bg-rose-100 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:bg-rose-900/40 dark:text-rose-400">
                Force
              </span>
            )}

            {/* Limit indicator */}
            {selectedRun.limit_param > 0 && (
              <span className="text-muted-foreground text-xs">
                Limit: {selectedRun.limit_param}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
