/**
 * ValidationDetail - Detail panel for the Validation stage.
 *
 * Input:   Parsed intents from Phase 1
 * Action:  Enforces field→type rules, removes temporal conflicts, catches hallucinated names
 * Output:  Validated intents — rejected items, filtered conflicts, flagged names
 */

import type { ValidationTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'
import { PhaseHeader } from './PhaseHeader'

interface ValidationDetailProps {
  data: ValidationTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean | undefined
}

export function ValidationDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: ValidationDetailProps) {
  const hasRejections =
    !data.type_validation.passed ||
    data.source_text_validation.rejected > 0 ||
    data.temporal_conflicts.filtered > 0

  const status = !data.type_validation.passed ? 'error' : 'ran'
  const statusLabel = !data.type_validation.passed
    ? 'invalid'
    : hasRejections
      ? 'filtered'
      : 'clean'

  const totalRejected =
    data.type_validation.rejected.length +
    data.source_text_validation.rejected +
    data.temporal_conflicts.filtered

  return (
    <div className="space-y-5">
      <PhaseHeader
        phase="validation"
        status={status}
        statusLabel={statusLabel}
        metrics={<DataRow label="Total Filtered" value={String(totalRejected)} />}
      />

      {/* ACTION */}
      <PanelSection label="Action">
        {/* Type validation */}
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Type Validation
            </span>
            <Badge
              label={data.type_validation.passed ? 'Passed' : 'Failed'}
              color={data.type_validation.passed ? 'green' : 'red'}
            />
          </div>
          {data.type_validation.rejected.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-sm text-red-700 dark:text-red-300">
              {data.type_validation.rejected.map((item, idx) => (
                <li key={idx}>{String(item)}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Temporal conflicts */}
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Temporal Conflicts
            </span>
            <Badge
              label={`${data.temporal_conflicts.filtered} filtered`}
              color={data.temporal_conflicts.filtered > 0 ? 'amber' : 'green'}
            />
          </div>
          {data.temporal_conflicts.details.length > 0 && (
            <ul className="mt-1 list-inside list-disc text-sm text-gray-700 dark:text-gray-300">
              {data.temporal_conflicts.details.map((detail, idx) => (
                <li key={idx}>{String(detail)}</li>
              ))}
            </ul>
          )}
        </div>

        {/* Source text validation */}
        <div className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
              Source Text Validation
            </span>
            <Badge
              label={`${data.source_text_validation.rejected} rejected`}
              color={data.source_text_validation.rejected > 0 ? 'red' : 'green'}
            />
          </div>
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
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        {totalRejected === 0 ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            All intents passed validation
          </p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.type_validation.rejected.length > 0 && (
              <Badge label={`${data.type_validation.rejected.length} type-rejected`} color="red" />
            )}
            {data.temporal_conflicts.filtered > 0 && (
              <Badge
                label={`${data.temporal_conflicts.filtered} temporal-filtered`}
                color="amber"
              />
            )}
            {data.source_text_validation.rejected > 0 && (
              <Badge
                label={`${data.source_text_validation.rejected} source-rejected`}
                color="red"
              />
            )}
          </div>
        )}
      </PanelSection>

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
