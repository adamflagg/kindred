/**
 * PhaseHeader - Polished phase title + description header for detail panels.
 *
 * Shows the phase name (from PHASE_LABELS), description (from PHASE_DESCRIPTIONS),
 * and an optional status badge or metrics strip.
 */

import type { PipelinePhase } from '../types'
import { PHASE_LABELS, PHASE_DESCRIPTIONS } from '../phaseDescriptions'
import { Badge } from './DataRow'

interface PhaseHeaderProps {
  phase: PipelinePhase
  status?: 'ran' | 'skipped' | 'error' | 'not_run'
  statusLabel?: string
  metrics?: React.ReactNode
}

const statusColors: Record<string, 'green' | 'gray' | 'red' | 'amber'> = {
  ran: 'green',
  skipped: 'gray',
  error: 'red',
  not_run: 'gray',
}

export function PhaseHeader({ phase, status, statusLabel, metrics }: PhaseHeaderProps) {
  return (
    <div className="border-b border-gray-100 pb-4 dark:border-gray-700/50">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            {PHASE_LABELS[phase]}
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
            {PHASE_DESCRIPTIONS[phase]}
          </p>
        </div>
        {status && <Badge label={statusLabel ?? status} color={statusColors[status] ?? 'gray'} />}
      </div>
      {metrics && <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1">{metrics}</div>}
    </div>
  )
}
