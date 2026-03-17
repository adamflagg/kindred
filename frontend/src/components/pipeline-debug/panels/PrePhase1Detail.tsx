/**
 * PrePhase1Detail - Detail panel for Pre-Phase 1 (preparation) stage.
 *
 * Input:   Raw CSV/form text from a specific source field
 * Action:  Text normalization — strips N/A prefixes, detects empty/staff-only/no-session
 * Output:  Cleaned text, action taken (parsed/skipped), field assignment
 */

import type { PrePhase1Trace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, PanelSection } from './DataRow'
import { PhaseHeader } from './PhaseHeader'
import { CollapsibleSection } from './CollapsibleSection'

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
  const actionStatus =
    data.action === 'parsed' || data.action === 'direct_mapped' ? 'ran' : 'skipped'

  return (
    <div className="space-y-5">
      <PhaseHeader phase="pre_phase1" status={actionStatus} statusLabel={data.action} />

      {/* INPUT */}
      <PanelSection label="Input">
        <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
          <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">Original Text</p>
          <p className="text-sm break-words text-gray-800 dark:text-gray-200">
            {data.original_text || <em className="text-gray-400">empty</em>}
          </p>
        </div>
        <DataRow label="Source Field" value={data.field_path} mono />
        <DataRow
          label="Requester"
          value={`${data.requester_info.name} (CM ${data.requester_info.cm_id}, Grade ${data.requester_info.grade})`}
        />
        <DataRow label="Sessions" value={data.session_cm_ids.join(', ') || '—'} mono />
      </PanelSection>

      {/* ACTION */}
      <PanelSection label="Action">
        <DataRow label="N/A Prefix Stripped" value={data.na_prefix_stripped ? 'Yes' : 'No'} />
        {data.skip_reason && <DataRow label="Skip Reason" value={data.skip_reason} />}
        {data.socialize_mapped_value && (
          <DataRow label="Socialize Mapped" value={data.socialize_mapped_value} />
        )}
      </PanelSection>

      {/* OUTPUT */}
      <PanelSection label="Output">
        {data.cleaned_text && data.cleaned_text !== data.original_text ? (
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-gray-800/50">
            <p className="mb-1 text-xs font-medium text-gray-500 dark:text-gray-400">
              Cleaned Text
            </p>
            <p className="text-sm break-words text-gray-800 dark:text-gray-200">
              {data.cleaned_text}
            </p>
          </div>
        ) : (
          <DataRow label="Cleaned Text" value="No changes" />
        )}
      </PanelSection>

      {/* ADDITIONAL DATA */}
      {data.staff_metadata && (
        <CollapsibleSection title="Staff Metadata">
          <pre className="overflow-auto rounded-lg bg-gray-50 p-2 text-xs text-gray-700 dark:bg-gray-800/50 dark:text-gray-300">
            {JSON.stringify(data.staff_metadata, null, 2)}
          </pre>
        </CollapsibleSection>
      )}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
