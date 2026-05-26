import { describe, it, expect } from 'vitest'
import { resolveYields, hasReviewableDiagnostics } from './solverDiagnostics'
import type { SolverDiagnostics, StaffNbwYieldRaw } from '../services/solver'

describe('SessionView diagnostics helpers (#1638)', () => {
  it('resolveYields maps cm_ids to names, falling back to the id', () => {
    const nameById = new Map<number, string>([
      [1000001, 'Emma Johnson'],
      [1000002, 'Liam Garcia'],
    ])
    const raw: StaffNbwYieldRaw[] = [
      {
        nbw_request_id: 'n1',
        subject_cm: 1000001,
        target_cm: 1000002,
        protected_parent_request_id: 'p1',
        protected_camper_cm: 1000002,
      },
      {
        nbw_request_id: 'n2',
        subject_cm: 1000001,
        target_cm: 999999,
        protected_parent_request_id: 'p2',
        protected_camper_cm: 999999,
      },
    ]
    expect(resolveYields(raw, nameById)).toEqual([
      {
        subjectName: 'Emma Johnson',
        targetName: 'Liam Garcia',
        protectedCamperName: 'Liam Garcia',
      },
      { subjectName: 'Emma Johnson', targetName: '999999', protectedCamperName: '999999' },
    ])
  })

  it('hasReviewableDiagnostics is true when any field has content', () => {
    const empty: SolverDiagnostics = {
      infeasibilityCause: null,
      localization: null,
      impossibilityReport: null,
    }
    expect(hasReviewableDiagnostics(undefined)).toBe(false)
    expect(hasReviewableDiagnostics(empty)).toBe(false)
    expect(hasReviewableDiagnostics({ ...empty, infeasibilityCause: 'x' })).toBe(true)
  })
})
