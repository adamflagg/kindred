import type { TraceData, PipelineStage, PipelinePhase } from './types'
import { RequestContext } from './sidebar/RequestContext'
import { StageNav } from './sidebar/StageNav'

interface PipelineSidebarProps {
  traceData: TraceData
  selectedStage: PipelineStage
  onStageSelect: (stage: PipelineStage) => void
  stalePhases: Set<PipelinePhase>
  activeIntentIndex: number
}

export function PipelineSidebar({
  traceData,
  selectedStage,
  onStageSelect,
  stalePhases,
  activeIntentIndex,
}: PipelineSidebarProps) {
  return (
    <aside className="bg-card border-border shadow-lodge-sm flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto rounded-2xl border-2 p-3">
      <RequestContext traceData={traceData} activeIntentIndex={activeIntentIndex} />
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
