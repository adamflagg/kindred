/**
 * ExpansionDetail - Detail panel for Placeholder Expansion.
 *
 * Input:   Resolved requests containing placeholder types (bunkmates, sibling, etc.)
 * Action:  Expands placeholders into individual named requests
 * Output:  Expanded targets list
 */

import type { PlaceholderExpansionTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'
import { PhaseHeader } from './PhaseHeader'

interface ExpansionDetailProps {
  data: PlaceholderExpansionTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean | undefined
}

export function ExpansionDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: ExpansionDetailProps) {
  const status = data.triggered ? 'ran' : 'skipped'

  return (
    <div className="space-y-5">
      <PhaseHeader
        phase="expansion"
        status={status}
        statusLabel={data.triggered ? 'expanded' : 'skipped'}
        metrics={null}
      />

      {/* ACTION */}
      <PanelSection label="Action">
        <DataRow
          label="Triggered"
          value={
            <Badge
              label={data.triggered ? 'Yes' : 'No'}
              color={data.triggered ? 'green' : 'gray'}
            />
          }
        />
        {data.type && <DataRow label="Placeholder Type" value={data.type} />}
        <DataRow label="Expanded Count" value={String(data.expanded_count)} />
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        {data.expanded_targets.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">No expansion performed</p>
        ) : (
          <div className="space-y-1">
            {data.expanded_targets.map((target, idx) => (
              <div key={idx} className="bg-muted text-foreground rounded-md px-3 py-1.5 text-sm">
                {String(
                  (target as Record<string, string | undefined>)['name'] ?? JSON.stringify(target)
                )}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
