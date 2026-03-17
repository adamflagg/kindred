import type { PipelinePhase } from './types'

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
