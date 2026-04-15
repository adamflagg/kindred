import type { PipelinePhase, PipelineStage } from './types'

/** Human-readable phase labels for UI display. */
export const PHASE_LABELS: Record<PipelinePhase, string> = {
  pre_phase1: 'Pre-Phase 1',
  phase1: 'Phase 1 Parse',
  validation: 'Validation',
  phase2: 'Phase 2 Resolution',
  historical: 'Phase 2.5 Historical',
  phase3: 'Phase 3 Disambiguation',
  post_pipeline: 'Post-Pipeline',
}

export const PHASE_DESCRIPTIONS: Record<PipelinePhase, string> = {
  pre_phase1: 'Prepares raw CSV text for parsing — filters empty, N/A, staff-only entries',
  phase1: 'AI extracts person names and request types from free text',
  validation: 'Enforces field→type rules, removes temporal conflicts, catches hallucinated names',
  phase2: 'Resolves each name to a real camper using exact, fuzzy, phonetic, and school matching',
  historical:
    'Verifies multiple targets were actually in the same bunk last year, boosts confidence',
  phase3: 'AI picks the best match when local resolution found multiple candidates',
  post_pipeline:
    'Builds final bunk requests — detects conflicts, self-references, reciprocals, duplicates',
}

/** Human-readable labels for granular stages. */
export const STAGE_LABELS: Record<PipelineStage, string> = {
  staff_detect: 'Staff Detect',
  na_strip: 'NA Strip',
  phase1_parse: 'Phase 1 Parse',
  type_validation: 'Type Validation',
  temporal_filter: 'Temporal Filter',
  source_text_validation: 'Source Text',
  phase2_resolve: 'Phase 2 Resolve',
  historical: 'Historical',
  phase3_disambig: 'Phase 3 Disambig',
  batch_signals: 'Batch Signals',
  conflict_detect: 'Conflict Detect',
  disposition: 'Disposition',
  dedup_save: 'Dedup + Save',
}

export const STAGE_DESCRIPTIONS: Record<PipelineStage, string> = {
  staff_detect: 'Identifies staff names in notes fields to attribute requests',
  na_strip: 'Strips N/A prefixes and detects empty/no-preference entries',
  phase1_parse: 'AI extracts person names and request types from free text',
  type_validation: 'Enforces field-to-type rules, rejects invalid type assignments',
  temporal_filter: 'Removes temporal conflict annotations from notes',
  source_text_validation: 'Catches hallucinated names and unit name references',
  phase2_resolve: 'Resolves names to campers via exact, fuzzy, phonetic, and school matching',
  historical: 'Verifies prior bunkmate history, boosts confidence if confirmed',
  phase3_disambig: 'AI picks the best match when local resolution found multiple candidates',
  batch_signals: 'Detects reciprocal pairs and household co-requests across all BRs',
  conflict_detect: 'Checks enrollment status, session assignment, and attendance conflicts',
  disposition: 'Applies priority-ordered rules to assign RESOLVED/PENDING/DECLINED status',
  dedup_save: 'Removes duplicate requests, checks self-references, saves final bunk requests',
}
