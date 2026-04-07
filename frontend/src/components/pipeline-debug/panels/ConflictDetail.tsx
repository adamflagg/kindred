import type { PostPipelineTrace } from '../types'
import { ActionButtons } from './ActionButtons'
import { Badge, PanelSection } from './DataRow'

interface ConflictDetailProps {
  data: PostPipelineTrace
  onRunAgain: () => void
  onRunFromHere: (writeToProduction: boolean) => void
  isRunning?: boolean
}

export function ConflictDetail({
  data,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: ConflictDetailProps) {
  const { conflict_detection } = data

  return (
    <div className="space-y-5">
      <div className="border-b border-gray-100 pb-4 dark:border-gray-700/50">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
              Conflict Detection
            </h3>
            <p className="mt-0.5 text-xs leading-relaxed text-gray-500 dark:text-gray-400">
              Checks enrollment status, session assignment, and attendance conflicts
            </p>
          </div>
          <Badge
            label={conflict_detection.has_conflict ? 'Conflicts Found' : 'Clean'}
            color={conflict_detection.has_conflict ? 'amber' : 'green'}
          />
        </div>
      </div>

      <PanelSection label="Results">
        {!conflict_detection.has_conflict ? (
          <p className="text-sm text-green-700 dark:text-green-400">
            No enrollment, session, or attendance conflicts detected
          </p>
        ) : (
          <div className="space-y-2">
            {conflict_detection.details.map((detail, idx) => (
              <div
                key={idx}
                className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700 dark:bg-amber-900/20 dark:text-amber-300"
              >
                {String(detail)}
              </div>
            ))}
          </div>
        )}
      </PanelSection>

      <ActionButtons onRunAgain={onRunAgain} onRunFromHere={onRunFromHere} isRunning={isRunning} />
    </div>
  )
}
