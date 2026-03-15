/**
 * ExpansionDetail - Detail panel for Placeholder Expansion.
 *
 * Shows: triggered flag, type, count, expanded targets list.
 */

import type { PlaceholderExpansionTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge } from './DataRow'

interface ExpansionDetailProps {
  data: PlaceholderExpansionTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean
}

export function ExpansionDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: ExpansionDetailProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        Placeholder Expansion
      </h3>

      <div className="space-y-1">
        <DataRow
          label="Triggered"
          value={
            <Badge
              label={data.triggered ? 'Yes' : 'No'}
              color={data.triggered ? 'green' : 'gray'}
            />
          }
        />
        {data.type && <DataRow label="Type" value={data.type} />}
        <DataRow label="Expanded Count" value={String(data.expanded_count)} />
      </div>

      {data.expanded_targets.length > 0 && (
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
            Expanded Targets
          </p>
          <div className="space-y-1">
            {data.expanded_targets.map((target, idx) => (
              <div
                key={idx}
                className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
              >
                <span>
                  {String((target as Record<string, unknown>).name ?? JSON.stringify(target))}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
