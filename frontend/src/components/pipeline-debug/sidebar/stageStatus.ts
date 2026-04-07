import type { TraceData, PipelineStage } from '../types'

export type StageStatus = 'success' | 'warning' | 'error' | 'skipped'

/** Derive visual status for each granular stage from existing trace data. */
export function deriveStageStatus(stage: PipelineStage, trace: TraceData): StageStatus {
  switch (stage) {
    case 'staff_detect':
      return trace.pre_phase1.staff_metadata ? 'success' : 'skipped'

    case 'na_strip':
      return trace.pre_phase1.na_prefix_stripped ? 'success' : 'skipped'

    case 'phase1_parse':
      if (!trace.phase1_parse.ran) return 'skipped'
      return trace.phase1_parse.is_valid ? 'success' : 'error'

    case 'type_validation':
      return trace.validation.type_validation.passed ? 'success' : 'error'

    case 'temporal_filter':
      return trace.validation.temporal_conflicts.filtered > 0 ? 'success' : 'skipped'

    case 'source_text_validation':
      return trace.validation.source_text_validation.rejected > 0 ? 'error' : 'success'

    case 'phase2_resolve': {
      if (trace.phase2_resolution.length === 0) return 'skipped'
      const allResolved = trace.phase2_resolution.every((r) => r.final_result.is_resolved)
      const anyAmbiguous = trace.phase2_resolution.some((r) => r.final_result.is_ambiguous)
      if (allResolved) return 'success'
      if (anyAmbiguous) return 'warning'
      return 'error'
    }

    case 'expansion':
      return trace.placeholder_expansion.triggered ? 'success' : 'skipped'

    case 'historical':
      if (!trace.historical_verification.ran) return 'skipped'
      return trace.historical_verification.boost_applied ? 'success' : 'warning'

    case 'phase3_disambig': {
      if (trace.phase3_disambiguation.length === 0) return 'skipped'
      const anyError = trace.phase3_disambiguation.some((d) => d.result === 'invalid_ai_output')
      const allResolved = trace.phase3_disambiguation.every(
        (d) => d.result === 'resolved' || d.result === 'not_needed'
      )
      if (anyError) return 'error'
      if (allResolved) return 'success'
      return 'warning'
    }

    case 'batch_signals':
      return trace.post_pipeline.reciprocal.detected ? 'success' : 'skipped'

    case 'conflict_detect':
      return trace.post_pipeline.conflict_detection.has_conflict ? 'warning' : 'success'

    case 'disposition':
      return trace.post_pipeline.final_bunk_requests.length > 0 ? 'success' : 'skipped'

    case 'dedup_save':
      return trace.post_pipeline.deduplication.was_duplicate ? 'warning' : 'success'
  }
}
