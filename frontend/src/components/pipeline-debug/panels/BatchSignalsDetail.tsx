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
      <div className="border-b border-gray-100 pb-4 dark:border-gray-700/50">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Batch Signals</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Detects reciprocal pairs and household co-requests across all BRs in the batch
        </p>
      </div>

      <PanelSection label="Reciprocal Detection">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Reciprocal</p>
            <Badge
              label={data.reciprocal.detected ? 'Detected' : 'None'}
              color={data.reciprocal.detected ? 'blue' : 'gray'}
            />
          </div>
          {data.reciprocal.detected && (
            <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
              <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Pair</p>
              <span className="font-mono text-xs text-gray-700 dark:text-gray-300">
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
              <div
                key={idx}
                className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-400"
              >
                <Badge label="reciprocal" color="blue" />
                <span>{br.requested_name ?? 'unknown'}</span>
                <span className="text-gray-400">·</span>
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
