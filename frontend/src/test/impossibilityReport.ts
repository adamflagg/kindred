import type { ImpossibilityReport } from '../services/solver'

// Type-safe builder for ImpossibilityReport test fixtures.
//
// Pre/Post/SolverDebug tests used to spell out `as unknown as ImpossibilityReport`
// to silence missing-field errors — the cost was that adding a new required field
// to the type silently passed every fixture. This helper accepts a Partial,
// fills in empty defaults, and returns a fully-typed ImpossibilityReport, so
// every test fixture stays drift-safe.
export function makeImpossibilityReport(
  overrides: Partial<ImpossibilityReport> = {}
): ImpossibilityReport {
  return {
    total_impossible: 0,
    affected_campers: 0,
    by_reason: {},
    flat: [],
    mp_campers_entirely_impossible: [],
    ...overrides,
  }
}
