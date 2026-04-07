import type { PostPipelineTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { DataRow, Badge, PanelSection } from './DataRow'

interface DedupDetailProps {
  data: PostPipelineTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean
}

export function DedupDetail({ data, onRunAgain, onRunFromHere, isRunning }: DedupDetailProps) {
  const { deduplication, self_reference, final_bunk_requests } = data

  return (
    <div className="space-y-5">
      <div className="border-b border-gray-100 pb-4 dark:border-gray-700/50">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Dedup + Save</h3>
        <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
          Removes duplicate requests, checks self-references, saves final bunk requests
        </p>
      </div>

      <PanelSection label="Checks">
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Self-Reference</p>
            <Badge
              label={self_reference.detected ? 'Detected' : 'None'}
              color={self_reference.detected ? 'red' : 'green'}
            />
          </div>
          <div className="rounded-lg border border-gray-200 p-2 dark:border-gray-700">
            <p className="mb-1 text-xs text-gray-500 dark:text-gray-400">Duplicate</p>
            <Badge
              label={deduplication.was_duplicate ? 'Duplicate' : 'Unique'}
              color={deduplication.was_duplicate ? 'amber' : 'green'}
            />
          </div>
        </div>

        {deduplication.was_duplicate && deduplication.kept_over && (
          <DataRow label="Kept Over" value={deduplication.kept_over} />
        )}
      </PanelSection>

      <PanelSection label="Saved Requests">
        <DataRow label="Total" value={String(final_bunk_requests.length)} />
      </PanelSection>

      <ActionButtons
        onRunAgain={onRunAgain}
        onRunFromHere={onRunFromHere}
        productionWriteCount={final_bunk_requests.length}
        processedCount={1}
        isRunning={isRunning}
      />
    </div>
  )
}
