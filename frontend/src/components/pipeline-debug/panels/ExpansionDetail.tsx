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
import { renderUnknownValue } from './panelUtils'

interface ExpansionDetailProps {
  data: PlaceholderExpansionTrace
  onRerunPhase: () => void
  onRunFromHere: () => void
  isRunning?: boolean | undefined
}

export function ExpansionDetail({
  data,
  onRerunPhase,
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
            {data.expanded_targets.map((target, idx) => {
              // Primitives: render directly
              if (typeof target !== 'object' || target === null) {
                return (
                  <div
                    key={idx}
                    className="bg-muted text-foreground rounded-md px-3 py-1.5 text-sm"
                  >
                    {renderUnknownValue(target)}
                  </div>
                )
              }
              // Objects: prefer name field, fall back to JSON
              const obj = target as Record<string, unknown>
              const name = obj['name'] ?? obj['first_name']
              if (typeof name === 'string') {
                const lastName = typeof obj['last_name'] === 'string' ? ` ${obj['last_name']}` : ''
                return (
                  <div
                    key={idx}
                    className="bg-muted text-foreground rounded-md px-3 py-1.5 text-sm"
                  >
                    {name + lastName}
                  </div>
                )
              }
              return (
                <div key={idx} className="bg-muted text-foreground rounded-md px-3 py-1.5 text-sm">
                  <pre className="font-mono text-xs whitespace-pre-wrap">
                    {JSON.stringify(target, null, 2)}
                  </pre>
                </div>
              )
            })}
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
