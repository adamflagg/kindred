/**
 * ValidationDetail - Detail panel for the Validation stage.
 *
 * Shows: type validation pass/fail + rejected, temporal conflicts + details,
 * source text rejections + hallucinated/unit names.
 */

import type { ValidationTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge } from './DataRow'

interface ValidationDetailProps {
  data: ValidationTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean
}

export function ValidationDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: ValidationDetailProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Validation</h3>

      {/* Type validation */}
      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">Type Validation</p>
        <DataRow
          label="Status"
          value={
            <Badge
              label={data.type_validation.passed ? 'Passed' : 'Failed'}
              color={data.type_validation.passed ? 'green' : 'red'}
            />
          }
        />
        {data.type_validation.rejected.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Rejected:</p>
            <ul className="mt-1 list-inside list-disc text-sm text-red-700 dark:text-red-300">
              {data.type_validation.rejected.map((item, idx) => (
                <li key={idx}>{String(item)}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Temporal conflicts */}
      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          Temporal Conflicts
        </p>
        <DataRow
          label="Filtered"
          value={
            <Badge
              label={`${data.temporal_conflicts.filtered} filtered`}
              color={data.temporal_conflicts.filtered > 0 ? 'amber' : 'green'}
            />
          }
        />
        {data.temporal_conflicts.details.length > 0 && (
          <ul className="mt-2 list-inside list-disc text-sm text-gray-700 dark:text-gray-300">
            {data.temporal_conflicts.details.map((detail, idx) => (
              <li key={idx}>{String(detail)}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Source text validation */}
      <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
        <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
          Source Text Validation
        </p>
        <DataRow
          label="Rejected"
          value={
            <Badge
              label={String(data.source_text_validation.rejected)}
              color={data.source_text_validation.rejected > 0 ? 'red' : 'green'}
            />
          }
        />
        {data.source_text_validation.hallucinated_names.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Hallucinated Names:</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {data.source_text_validation.hallucinated_names.map((name, idx) => (
                <Badge key={idx} label={name} color="red" />
              ))}
            </div>
          </div>
        )}
        {data.source_text_validation.unit_names.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">Unit Names:</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {data.source_text_validation.unit_names.map((name, idx) => (
                <Badge key={idx} label={name} color="amber" />
              ))}
            </div>
          </div>
        )}
      </div>

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
