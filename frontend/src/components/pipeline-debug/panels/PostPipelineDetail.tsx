/**
 * PostPipelineDetail - Detail panel for Post-Pipeline processing.
 *
 * Input:   Resolved requests from Phase 2/3
 * Action:  Conflict detection, self-reference check, reciprocal boost, deduplication
 * Output:  Final bunk_requests to be written to the database
 */

import type { PostPipelineTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'
import { PhaseHeader } from './PhaseHeader'

interface PostPipelineDetailProps {
  data: PostPipelineTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean | undefined
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

export function PostPipelineDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: PostPipelineDetailProps) {
  const requestCount = data.final_bunk_requests.length
  const hasIssues =
    data.conflict_detection.has_conflict ||
    data.self_reference.detected ||
    data.deduplication.was_duplicate

  return (
    <div className="space-y-5">
      <PhaseHeader
        phase="post_pipeline"
        status="ran"
        statusLabel={hasIssues ? 'issues found' : 'clean'}
        metrics={<DataRow label="Final Requests" value={String(requestCount)} />}
      />

      {/* ACTION */}
      <PanelSection label="Action">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Conflicts</p>
            <Badge
              label={data.conflict_detection.has_conflict ? 'Detected' : 'None'}
              color={data.conflict_detection.has_conflict ? 'amber' : 'green'}
            />
          </div>
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Self-Reference</p>
            <Badge
              label={data.self_reference.detected ? 'Detected' : 'None'}
              color={data.self_reference.detected ? 'red' : 'green'}
            />
          </div>
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Reciprocal</p>
            <Badge
              label={data.reciprocal.detected ? 'Detected' : 'None'}
              color={data.reciprocal.detected ? 'blue' : 'gray'}
            />
          </div>
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Duplicate</p>
            <Badge
              label={data.deduplication.was_duplicate ? 'Duplicate' : 'Unique'}
              color={data.deduplication.was_duplicate ? 'amber' : 'green'}
            />
          </div>
        </div>

        {data.conflict_detection.has_conflict && data.conflict_detection.details.length > 0 && (
          <div className="rounded-lg bg-amber-50 p-3 dark:bg-amber-900/20">
            <p className="mb-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              Conflict Details
            </p>
            <ul className="list-inside list-disc text-sm text-amber-700 dark:text-amber-300">
              {data.conflict_detection.details.map((d, idx) => (
                <li key={idx}>{String(d)}</li>
              ))}
            </ul>
          </div>
        )}

        {data.reciprocal.detected && (
          <div className="rounded-lg bg-blue-50 p-3 dark:bg-blue-900/20">
            <p className="mb-1 text-xs font-medium text-blue-700 dark:text-blue-400">
              Reciprocal Boost
            </p>
            <DataRow label="Boost Applied" value={data.reciprocal.boost_applied ? 'Yes' : 'No'} />
            {data.reciprocal.boost_amount !== null && (
              <DataRow label="Boost Amount" value={String(data.reciprocal.boost_amount)} />
            )}
            {data.reciprocal.pair_cm_id !== null && (
              <DataRow label="Pair CM ID" value={String(data.reciprocal.pair_cm_id)} mono />
            )}
          </div>
        )}

        {data.deduplication.was_duplicate && data.deduplication.kept_over && (
          <DataRow label="Kept Over" value={data.deduplication.kept_over} />
        )}
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        {requestCount === 0 ? (
          <p className="text-sm text-gray-400 italic dark:text-gray-500">
            No bunk requests generated
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs font-medium text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pr-3 pb-2">Target</th>
                  <th className="pr-3 pb-2">Type</th>
                  <th className="pr-3 pb-2">Status</th>
                  <th className="pr-3 pb-2">Confidence</th>
                  <th className="pr-3 pb-2">Method</th>
                  <th className="pr-3 pb-2">Priority</th>
                  <th className="pr-3 pb-2">Declined</th>
                </tr>
              </thead>
              <tbody>
                {data.final_bunk_requests.map((req, idx) => (
                  <tr key={idx} className="border-b border-gray-100 dark:border-gray-800">
                    <td className="py-2 pr-3 font-medium text-gray-800 dark:text-gray-200">
                      {req.requested_name ?? '—'}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge label={req.request_type} color="blue" />
                    </td>
                    <td className="py-2 pr-3">
                      <Badge label={req.status} color={statusColor(req.status)} />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs">{req.confidence}</td>
                    <td className="py-2 pr-3 text-xs">{req.resolution_method}</td>
                    <td className="py-2 pr-3 text-xs">{req.priority}</td>
                    <td className="py-2 pr-3 text-xs text-red-600 dark:text-red-400">
                      {req.declined_reason ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PanelSection>

      <ActionButtons
        onRunAgain={onRunAgain}
        onRunFromHere={onRunFromHere}
        productionWriteCount={requestCount}
        processedCount={1}
        isRunning={isRunning}
      />
    </div>
  )
}
