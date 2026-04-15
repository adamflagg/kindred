import type { DedupSaveTrace, DispositionTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'

interface DedupDetailProps {
  data: DedupSaveTrace
  disposition: DispositionTrace
  onRerunPhase: () => void
  onRunFromHere: () => void
  isRunning?: boolean
}

export function DedupDetail({
  data,
  disposition,
  onRerunPhase,
  onRunFromHere,
  isRunning,
}: DedupDetailProps) {
  const { final_bunk_requests } = disposition

  return (
    <div className="space-y-5">
      <div className="border-border border-b pb-4">
        <h3 className="text-foreground text-base font-semibold">Dedup + Save</h3>
        <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
          Removes duplicate requests, checks self-references, saves final bunk requests
        </p>
      </div>

      <PanelSection label="Checks">
        <div className="grid grid-cols-2 gap-2">
          <div className="border-border rounded-lg border p-2">
            <p className="text-muted-foreground mb-1 text-xs">Self-Reference</p>
            <Badge
              label={data.self_reference.detected ? 'Detected' : 'None'}
              color={data.self_reference.detected ? 'red' : 'green'}
            />
          </div>
          <div className="border-border rounded-lg border p-2">
            <p className="text-muted-foreground mb-1 text-xs">Duplicate</p>
            <Badge
              label={data.was_duplicate ? 'Duplicate' : 'Unique'}
              color={data.was_duplicate ? 'amber' : 'green'}
            />
          </div>
        </div>

        {data.was_duplicate && data.kept_over && (
          <DataRow label="Kept Over" value={data.kept_over} />
        )}
      </PanelSection>

      <PanelSection label="Saved Requests">
        <DataRow label="Total" value={String(final_bunk_requests.length)} />
      </PanelSection>

      <ActionButtons
        onRerunPhase={onRerunPhase}
        onRunFromHere={onRunFromHere}
        isRunning={isRunning}
      />
    </div>
  )
}
