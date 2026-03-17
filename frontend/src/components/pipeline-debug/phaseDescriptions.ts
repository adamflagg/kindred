import type { PipelinePhase } from './types'

/** Human-readable phase labels for UI display. */
export const PHASE_LABELS: Record<PipelinePhase, string> = {
  pre_phase1: 'Pre-Phase 1',
  phase1: 'Phase 1 Parse',
  validation: 'Validation',
  phase2: 'Phase 2 Resolution',
  expansion: 'Expansion',
  historical: 'Phase 2.5 Historical',
  phase3: 'Phase 3 Disambiguation',
  post_pipeline: 'Post-Pipeline',
}

export const PHASE_DESCRIPTIONS: Record<PipelinePhase, string> = {
  pre_phase1: 'Prepares raw CSV text for parsing — filters empty, N/A, staff-only entries',
  phase1: 'AI extracts person names and request types from free text',
  validation: 'Enforces field→type rules, removes temporal conflicts, catches hallucinated names',
  phase2: 'Resolves each name to a real camper using exact, fuzzy, phonetic, and school matching',
  expansion:
    'Expands placeholders like "last year\'s bunkmates" and "sibling" into individual requests',
  historical:
    'Verifies multiple targets were actually in the same bunk last year, boosts confidence',
  phase3: 'AI picks the best match when local resolution found multiple candidates',
  post_pipeline:
    'Builds final bunk requests — detects conflicts, self-references, reciprocals, duplicates',
}
