import type { PostPipelineTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'

interface BatchSignalsDetailProps {
  data: PostPipelineTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean
}

export function BatchSignalsDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: BatchSignalsDetailProps) {
  const reciprocalBRs = data.final_bunk_requests.filter((br) => br.is_reciprocal)

  return (
    <div className="space-y-5">
      <div className="border-border border-b pb-4">
        <h3 className="text-foreground text-base font-semibold">Batch Signals</h3>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          Detects reciprocal pairs and household co-requests across all BRs in the batch
        </p>
      </div>

      <PanelSection label="Reciprocal Detection">
        <div className="grid grid-cols-2 gap-2">
          <div className="border-border rounded-lg border p-2">
            <p className="text-muted-foreground mb-1 text-xs">Reciprocal</p>
            <Badge
              label={data.reciprocal.detected ? 'Detected' : 'None'}
              color={data.reciprocal.detected ? 'blue' : 'gray'}
            />
          </div>
          {data.reciprocal.detected && (
            <div className="border-border rounded-lg border p-2">
              <p className="text-muted-foreground mb-1 text-xs">Pair</p>
              <span className="text-foreground font-mono text-xs">
                CM {data.reciprocal.pair_cm_id}
              </span>
            </div>
          )}
        </div>

        {data.reciprocal.detected && data.reciprocal.boost_applied && (
          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
            <DataRow label="Boost Applied" value="Yes" />
            {data.reciprocal.boost_amount !== null && (
              <DataRow label="Boost Amount" value={`+${data.reciprocal.boost_amount}`} />
            )}
          </div>
        )}
      </PanelSection>

      {reciprocalBRs.length > 0 && (
        <PanelSection label="Reciprocal BRs in Batch">
          <div className="space-y-1">
            {reciprocalBRs.map((br, idx) => (
              <div key={idx} className="text-muted-foreground flex items-center gap-2 text-xs">
                <Badge label="reciprocal" color="blue" />
                <span>{br.requested_name ?? 'unknown'}</span>
                <span className="text-muted-foreground">·</span>
                <span className="font-mono">{br.confidence}</span>
              </div>
            ))}
          </div>
        </PanelSection>
      )}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
