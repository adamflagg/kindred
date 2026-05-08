/**
 * HistoricalDetail - Detail panel for Phase 2.5 (Historical Verification).
 *
 * Input:   Multiple resolved targets from Phase 2
 * Action:  Checks if targets were in the same bunk last year
 * Output:  Confidence boost applied (or not)
 */

import type { HistoricalVerificationTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'
import { PhaseHeader } from './PhaseHeader'

interface HistoricalDetailProps {
  data: HistoricalVerificationTrace
  onRerunPhase: () => void
  onRunFromHere: () => void
  isRunning?: boolean | undefined
}

export function HistoricalDetail({
  data,
  onRerunPhase,
  onRunFromHere,
  isRunning,
}: HistoricalDetailProps) {
  const status = data.ran ? 'ran' : 'skipped'
  let statusLabel: string
  if (!data.ran) statusLabel = 'skipped'
  else if (data.boost_applied) statusLabel = 'boosted'
  else statusLabel = 'no boost'

  return (
    <div className="space-y-5">
      <PhaseHeader
        phase="historical"
        status={status}
        statusLabel={statusLabel}
        metrics={
          data.ran &&
          data.boost_applied &&
          data.original_confidence !== null &&
          data.boosted_confidence !== null ? (
            <DataRow
              label="Boost"
              value={`+${(data.boosted_confidence - data.original_confidence).toFixed(2)}`}
            />
          ) : null
        }
      />

      {/* ACTION */}
      <PanelSection label="Action">
        <DataRow
          label="Ran"
          value={<Badge label={data.ran ? 'Yes' : 'No'} color={data.ran ? 'green' : 'gray'} />}
        />
        <DataRow
          label="Boost Applied"
          value={
            <Badge
              label={data.boost_applied ? 'Yes' : 'No'}
              color={data.boost_applied ? 'green' : 'gray'}
            />
          }
        />
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        {!data.ran ? (
          <p className="text-muted-foreground text-sm italic">Historical check did not run</p>
        ) : (
          <div className="bg-muted rounded-lg p-3">
            <DataRow
              label="Original Confidence"
              value={data.original_confidence !== null ? String(data.original_confidence) : '—'}
            />
            <DataRow
              label="Boosted Confidence"
              value={data.boosted_confidence !== null ? String(data.boosted_confidence) : '—'}
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
      </PanelSection>

      <ActionButtons
        onRerunPhase={onRerunPhase}
        onRunFromHere={onRunFromHere}
        isRunning={isRunning}
      />
    </div>
  )
}
