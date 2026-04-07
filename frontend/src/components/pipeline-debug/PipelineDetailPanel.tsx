/**
 * PipelineDetailPanel - Routes the selected granular stage to its detail panel.
 *
 * Stages that share a parent phase (e.g., staff_detect + na_strip → PrePhase1Detail)
 * render the same panel. The four Finalization stages each get their own panel.
 */

import type { TraceData, PipelineStage, PipelinePhase } from './types'
import { STAGE_TO_PHASE } from './types'
import { STAGE_DESCRIPTIONS } from './phaseDescriptions'
import { PrePhase1Detail } from './panels/PrePhase1Detail'
import { Phase1Detail } from './panels/Phase1Detail'
import { ValidationDetail } from './panels/ValidationDetail'
import { Phase2Detail } from './panels/Phase2Detail'
import { ExpansionDetail } from './panels/ExpansionDetail'
import { HistoricalDetail } from './panels/HistoricalDetail'
import { Phase3Detail } from './panels/Phase3Detail'
import { BatchSignalsDetail } from './panels/BatchSignalsDetail'
import { ConflictDetail } from './panels/ConflictDetail'
import { DispositionDetail } from './panels/DispositionDetail'
import { DedupDetail } from './panels/DedupDetail'

interface PipelineDetailPanelProps {
  selectedStage: PipelineStage | null
  traceData: TraceData
  onRunAgain: (phase: PipelinePhase) => void
  onRunFromHere: (phase: PipelinePhase, writeToProduction: boolean) => void
  isRunning?: boolean
}

export function PipelineDetailPanel({
  selectedStage,
  traceData,
  onRunAgain,
  onRunFromHere,
  isRunning,
}: PipelineDetailPanelProps) {
  if (!selectedStage) return null

  const parentPhase = STAGE_TO_PHASE[selectedStage]

  const sharedProps = {
    onRunAgain: () => onRunAgain(parentPhase),
    onRunFromHere: (writeToProduction: boolean) => onRunFromHere(parentPhase, writeToProduction),
    ...(isRunning !== undefined ? { isRunning } : {}),
  }

  function renderPanel() {
    switch (selectedStage) {
      // Pre-Processing — both stages use PrePhase1Detail
      case 'staff_detect':
      case 'na_strip':
        return <PrePhase1Detail data={traceData.pre_phase1} {...sharedProps} />

      // AI Parse
      case 'phase1_parse':
        return <Phase1Detail data={traceData.phase1_parse} {...sharedProps} />

      // Validation — all three sub-stages use ValidationDetail
      case 'type_validation':
      case 'temporal_filter':
      case 'source_text_validation':
        return <ValidationDetail data={traceData.validation} {...sharedProps} />

      // Resolution
      case 'phase2_resolve':
        return <Phase2Detail data={traceData.phase2_resolution} {...sharedProps} />
      case 'expansion':
        return <ExpansionDetail data={traceData.placeholder_expansion} {...sharedProps} />
      case 'historical':
        return <HistoricalDetail data={traceData.historical_verification} {...sharedProps} />
      case 'phase3_disambig':
        return <Phase3Detail data={traceData.phase3_disambiguation} {...sharedProps} />

      // Finalization — each gets its own panel
      case 'batch_signals':
        return <BatchSignalsDetail data={traceData.post_pipeline} {...sharedProps} />
      case 'conflict_detect':
        return <ConflictDetail data={traceData.post_pipeline} {...sharedProps} />
      case 'disposition':
        return <DispositionDetail data={traceData.post_pipeline} {...sharedProps} />
      case 'dedup_save':
        return <DedupDetail data={traceData.post_pipeline} {...sharedProps} />

      default:
        return null
    }
  }

  return (
    <div className="card-lodge p-6">
      <p className="text-muted-foreground mb-4 text-sm">{STAGE_DESCRIPTIONS[selectedStage]}</p>
      {renderPanel()}
    </div>
  )
}
