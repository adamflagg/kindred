import type { TraceData, PipelineStage, PipelinePhase } from './types'
import { RequestContext } from './sidebar/RequestContext'
import { StageNav } from './sidebar/StageNav'

interface PipelineSidebarProps {
  traceData: TraceData
  selectedStage: PipelineStage | null
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
    <aside className="flex w-[220px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-gray-700 bg-gray-900/80 p-3">
      <RequestContext traceData={traceData} activeIntentIndex={activeIntentIndex} />
      <div className="border-t border-gray-700 pt-2">
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
