/**
 * HistoricalDetail - Detail panel for Phase 2.5 (Historical Verification).
 *
 * Shows: ran flag, boost applied, original confidence, boosted confidence.
 */

import type { HistoricalVerificationTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge } from './DataRow'

interface HistoricalDetailProps {
  data: HistoricalVerificationTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean
}

export function HistoricalDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: HistoricalDetailProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
        P2.5 Historical Verification
      </h3>

      <div className="space-y-1">
        <DataRow
          label="Ran"
          value={<Badge label={data.ran ? 'Yes' : 'No'} color={data.ran ? 'green' : 'gray'} />}
        />
        <DataRow
          label="Boost Applied"
          value={
            <Badge
              label={data.boost_applied ? 'Boost Applied' : 'No Boost'}
              color={data.boost_applied ? 'green' : 'gray'}
            />
          }
        />
      </div>

      {data.ran && (
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
          <DataRow
            label="Original Confidence"
            value={data.original_confidence !== null ? String(data.original_confidence) : '-'}
          />
          <DataRow
            label="Boosted Confidence"
            value={data.boosted_confidence !== null ? String(data.boosted_confidence) : '-'}
          />
          {data.boost_applied &&
            data.original_confidence !== null &&
            data.boosted_confidence !== null && (
              <DataRow
                label="Boost Amount"
                value={`+${(data.boosted_confidence - data.original_confidence).toFixed(2)}`}
              />
            )}
        </div>
      )}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
