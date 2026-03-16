/**
 * PrePhase1Detail - Detail panel for Pre-Phase 1 (preparation) stage.
 *
 * Shows: original text, cleaned text, action, skip reason, staff metadata,
 * field path, requester info, session IDs, N/A prefix stripped.
 */

import type { PrePhase1Trace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge } from './DataRow'

interface PrePhase1DetailProps {
  data: PrePhase1Trace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean | undefined
}

export function PrePhase1Detail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: PrePhase1DetailProps) {
  return (
    <div className="space-y-4">
      <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Pre-Phase 1</h3>

      <div className="space-y-1">
        <DataRow
          label="Action"
          value={<Badge label={data.action} color={data.action === 'parsed' ? 'green' : 'gray'} />}
        />
        <DataRow label="Field Path" value={data.field_path} />
        {data.skip_reason && <DataRow label="Skip Reason" value={data.skip_reason} />}
        <DataRow label="N/A Stripped" value={data.na_prefix_stripped ? 'Yes' : 'No'} />
      </div>

      <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
        <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Original Text</p>
        <p className="text-sm text-gray-800 dark:text-gray-200">{data.original_text}</p>
      </div>

      {data.cleaned_text !== data.original_text && (
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Cleaned Text</p>
          <p className="text-sm text-gray-800 dark:text-gray-200">{data.cleaned_text}</p>
        </div>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Requester Info</p>
        <DataRow label="Name" value={data.requester_info.name} />
        <DataRow label="CM ID" value={String(data.requester_info.cm_id)} />
        <DataRow label="Grade" value={data.requester_info.grade} />
      </div>

      <div className="space-y-1">
        <DataRow label="Session IDs" value={data.session_cm_ids.join(', ')} mono />
      </div>

      {data.staff_metadata && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Staff Metadata</p>
          <pre className="overflow-auto rounded-lg bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
            {JSON.stringify(data.staff_metadata, null, 2)}
          </pre>
        </div>
      )}

      {data.socialize_mapped_value && (
        <DataRow label="Socialize Mapped" value={data.socialize_mapped_value} />
      )}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
