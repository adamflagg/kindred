/**
 * PipelineDetailPanel - Renders the appropriate detail panel for the selected node.
 *
 * Displayed below the canvas when a user clicks a pipeline phase node.
 */

import type { TraceData, PipelinePhase } from './types'
import { PrePhase1Detail } from './panels/PrePhase1Detail'
import { Phase1Detail } from './panels/Phase1Detail'
import { ValidationDetail } from './panels/ValidationDetail'
import { Phase2Detail } from './panels/Phase2Detail'
import { ExpansionDetail } from './panels/ExpansionDetail'
import { HistoricalDetail } from './panels/HistoricalDetail'
import { Phase3Detail } from './panels/Phase3Detail'
import { PostPipelineDetail } from './panels/PostPipelineDetail'

interface PipelineDetailPanelProps {
  selectedNode: PipelinePhase | null
  traceData: TraceData
  onRunAgain: (phase: PipelinePhase) => void
  onRunFromHere: (phase: PipelinePhase, writeToProduction: boolean) => void
  isRunning?: boolean
}

export function PipelineDetailPanel({
  selectedNode,
  traceData,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: PipelineDetailPanelProps) {
  if (!selectedNode) return null

  const sharedProps = {
    onRunAgain: () => onRunAgain(selectedNode),
    onRunFromHere: (writeToProduction: boolean) => onRunFromHere(selectedNode, writeToProduction),
    isRunning,
  }

  return (
    <div className="card-lodge mt-4 p-6">
      {selectedNode === 'pre_phase1' && (
        <PrePhase1Detail data={traceData.pre_phase1} {...sharedProps} />
      )}
      {selectedNode === 'phase1' && <Phase1Detail data={traceData.phase1_parse} {...sharedProps} />}
      {selectedNode === 'validation' && (
        <ValidationDetail data={traceData.validation} {...sharedProps} />
      )}
      {selectedNode === 'phase2' && (
        <Phase2Detail data={traceData.phase2_resolution} {...sharedProps} />
      )}
      {selectedNode === 'expansion' && (
        <ExpansionDetail data={traceData.placeholder_expansion} {...sharedProps} />
      )}
      {selectedNode === 'historical' && (
        <HistoricalDetail data={traceData.historical_verification} {...sharedProps} />
      )}
      {selectedNode === 'phase3' && (
        <Phase3Detail data={traceData.phase3_disambiguation} {...sharedProps} />
      )}
      {selectedNode === 'post_pipeline' && (
        <PostPipelineDetail data={traceData.post_pipeline} {...sharedProps} />
      )}
    </div>
  )
}
