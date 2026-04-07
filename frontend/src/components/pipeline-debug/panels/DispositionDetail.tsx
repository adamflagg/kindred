import type { PostPipelineTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { Badge, PanelSection } from './DataRow'

interface DispositionDetailProps {
  data: PostPipelineTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
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
  onRunAgain,
  onRunFromHere,
  isRunning,
}: DispositionDetailProps) {
  const brs = data.final_bunk_requests

  return (
    <div className="space-y-5">
      <div className="border-b border-gray-100 pb-4 dark:border-gray-700/50">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Disposition</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Priority-ordered rules assign RESOLVED, PENDING, or DECLINED status to each BR
        </p>
      </div>

      <PanelSection label="Disposition Results">
        {brs.length === 0 ? (
          <p className="text-sm text-gray-400 italic">No bunk requests generated</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pr-3 pb-2">Target</th>
                  <th className="pr-3 pb-2">Status</th>
                  <th className="pr-3 pb-2">Reason</th>
                  <th className="pr-3 pb-2">Confidence</th>
                  <th className="pr-3 pb-2">Method</th>
                </tr>
              </thead>
              <tbody>
                {brs.map((br, idx) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200">
                      {br.requested_name ?? '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge label={br.status} color={statusColor(br.status)} />
                    </td>
                    <td className="py-2 pr-3 text-xs text-gray-600 dark:text-gray-400">
                      {br.disposition_reason || br.declined_reason || '—'}
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

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
