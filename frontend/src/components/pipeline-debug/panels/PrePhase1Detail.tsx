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
        <div className="bg-muted rounded-lg p-3">
          <p className="text-muted-foreground mb-1 text-xs font-medium">Original Text</p>
          <p className="text-foreground text-sm break-words">
            {data.original_text || <em className="text-muted-foreground">empty</em>}
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
          <div className="bg-muted rounded-lg p-3">
            <p className="text-muted-foreground mb-1 text-xs font-medium">Cleaned Text</p>
            <p className="text-foreground text-sm break-words">{data.cleaned_text}</p>
          </div>
        ) : (
          <DataRow label="Cleaned Text" value="No changes" />
        )}
      </PanelSection>

      {/* ADDITIONAL DATA */}
      {data.staff_metadata && (
        <CollapsibleSection title="Staff Metadata">
          <pre className="bg-muted text-muted-foreground overflow-auto rounded-lg p-2 text-xs">
            {JSON.stringify(data.staff_metadata, null, 2)}
          </pre>
        </CollapsibleSection>
      )}

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
