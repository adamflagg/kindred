import type { DispositionTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { Badge, PanelSection } from './DataRow'

interface DispositionDetailProps {
  data: DispositionTrace
  onRerunPhase: () => void
  onRunFromHere: () => void
  isRunning?: boolean
}

function statusColor(status: string): 'green' | 'amber' | 'red' | 'gray' {
  switch (status.toUpperCase()) {
    case 'RESOLVED':
      return 'green'
    case 'PENDING':
      return 'amber'
    case 'DECLINED':
      return 'red'
    default:
      return 'gray'
  }
}

export function DispositionDetail({
  data,
  onRerunPhase,
  onRunFromHere,
  isRunning,
}: DispositionDetailProps) {
  const brs = data.final_bunk_requests

  return (
    <div className="space-y-5">
      <div className="border-border border-b pb-4">
        <h3 className="text-foreground text-base font-semibold">Disposition</h3>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          Priority-ordered rules assign RESOLVED, PENDING, or DECLINED status to each BR
        </p>
      </div>

      <PanelSection label="Disposition Results">
        {brs.length === 0 ? (
          <p className="text-muted-foreground text-sm italic">No bunk requests generated</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-border text-muted-foreground border-b text-left text-xs font-medium">
                  <th className="pr-3 pb-2">Target</th>
                  <th className="pr-3 pb-2">Status</th>
                  <th className="pr-3 pb-2">Reason</th>
                  <th className="pr-3 pb-2">Confidence</th>
                  <th className="pr-3 pb-2">Method</th>
                </tr>
              </thead>
              <tbody>
                {brs.map((br, idx) => (
                  <tr key={idx} className="border-border border-b">
                    <td className="text-foreground py-2 pr-3 font-medium">
                      {br.requested_name ?? '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge label={br.status} color={statusColor(br.status)} />
                    </td>
                    <td className="text-muted-foreground py-2 pr-3 text-xs">
                      {br.disposition_reason !== ''
                        ? br.disposition_reason
                        : (br.declined_reason ?? '—')}
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{br.confidence}</td>
                    <td className="py-2 pr-3 text-xs">{br.resolution_method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
