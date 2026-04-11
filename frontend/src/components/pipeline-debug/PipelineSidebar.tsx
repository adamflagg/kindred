import type { TraceData, PipelineStage, PipelinePhase } from './types'
import { RequestContext } from './sidebar/RequestContext'
import { StageNav } from './sidebar/StageNav'

interface PipelineSidebarProps {
  traceData: TraceData
  selectedStage: PipelineStage
  onStageSelect: (stage: PipelineStage) => void
  stalePhases: Set<PipelinePhase>
  activeIntentIndex: number
  /** Callback when user clicks "View all traces" for the requester. */
  onViewAllTraces?: (cmId: number) => void
  /** Callback to reprocess from source for this camper. */
  onReprocess?: () => void
  /** Whether a reprocess operation is in progress. */
  isReprocessing?: boolean
}

export function PipelineSidebar({
  traceData,
  selectedStage,
  onStageSelect,
  stalePhases,
  activeIntentIndex,
  onViewAllTraces,
  onReprocess,
  isReprocessing,
}: PipelineSidebarProps) {
  return (
    <aside className="bg-card border-border shadow-lodge-sm flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border-2 p-3">
      <RequestContext
        traceData={traceData}
        activeIntentIndex={activeIntentIndex}
        {...(onViewAllTraces ? { onViewAllTraces } : {})}
        {...(onReprocess ? { onReprocess } : {})}
        {...(isReprocessing !== undefined ? { isReprocessing } : {})}
      />
      <div className="border-border border-t pt-2">
        <StageNav
          traceData={traceData}
          selectedStage={selectedStage}
          onStageSelect={onStageSelect}
          stalePhases={stalePhases}
        />
      </div>
    </aside>
  )
}
