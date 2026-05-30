import { describe, it, expect } from 'vitest'
import { extractBunkName, ISSUE_SECTION, ISSUE_SEVERITY, COHORT_SEVERITY } from './issueClassifier'
import { REASON_SEVERITY } from './impossibility/reasonHints'

describe('extractBunkName', () => {
  it('reads bunk_name from issue.details when present (preferred path)', () => {
    expect(
      extractBunkName({
        type: 'capacity_violation',
        message: 'Bunk Pine 3 is over capacity (11/10)',
        details: { bunk_name: 'Pine 3' },
      })
    ).toBe('Pine 3')
  })

  it('falls back to message parsing when details.bunk_name is missing', () => {
    expect(
      extractBunkName({
        type: 'capacity_violation',
        message: 'Bunk Pine 3 is over capacity (11/10)',
      })
    ).toBe('Pine 3')
  })

  describe('message fallback covers all bunk-level issue formats', () => {
    it('capacity_violation: "Bunk <name> is over capacity ..."', () => {
      expect(extractBunkName({ type: 'x', message: 'Bunk Pine 3 is over capacity (11/10)' })).toBe(
        'Pine 3'
      )
    })

    it('grade_spread_warning: "Bunk <name> has too many ..."', () => {
      expect(
        extractBunkName({ type: 'x', message: 'Bunk Pine 3 has too many different grades (4...)' })
      ).toBe('Pine 3')
    })

    it('age_spread_warning: "Bunk <name> has excessive age spread ..."', () => {
      expect(
        extractBunkName({
          type: 'x',
          message: 'Bunk Pine 3 has excessive age spread (24.0 months)',
        })
      ).toBe('Pine 3')
    })

    it('grade_ratio_warning: "Bunk <name> has X% ..."', () => {
      expect(
        extractBunkName({
          type: 'x',
          message: 'Bunk Pine 3 has 75.0% of campers from grade 6 (exceeds 50% limit)',
        })
      ).toBe('Pine 3')
    })

    it('grade_adjacency_warning: "Bunk <name> has non-adjacent ..."', () => {
      expect(
        extractBunkName({
          type: 'x',
          message: 'Bunk Pine 3 has non-adjacent grades [5, 7] (missing grade [6])',
        })
      ).toBe('Pine 3')
    })

    it('age_flow_inversion: "<name> (avg age N) has older campers ..."', () => {
      expect(
        extractBunkName({
          type: 'x',
          message: 'Pine 3 (avg age 12.1) has older campers than Pine 4 (avg age 11.2)',
        })
      ).toBe('Pine 3')
    })

    it('isolation_risk: "<name> has N connected friends ..."', () => {
      expect(
        extractBunkName({
          type: 'x',
          message: 'Pine 3 has 9 connected friends + 2 isolated camper(s): Emma, Liam',
        })
      ).toBe('Pine 3')
    })

    it('preserves multi-token bunk names', () => {
      expect(
        extractBunkName({ type: 'x', message: 'Bunk Long Cabin Name is over capacity (11/10)' })
      ).toBe('Long Cabin Name')
    })

    it('distinguishes Pine 1 from Pine 2', () => {
      const a = extractBunkName({ type: 'x', message: 'Bunk Pine 1 is over capacity (11/10)' })
      const b = extractBunkName({ type: 'x', message: 'Bunk Pine 2 is over capacity (11/10)' })
      expect(a).toBe('Pine 1')
      expect(b).toBe('Pine 2')
      expect(a).not.toBe(b)
    })

    it('returns "Unknown" when nothing matches', () => {
      expect(extractBunkName({ type: 'x', message: 'totally unstructured noise' })).toBe('Unknown')
    })
  })
})

describe('issue classification', () => {
  it('routes composition warnings to cabins', () => {
    expect(ISSUE_SECTION['capacity_violation']).toBe('cabins')
    expect(ISSUE_SECTION['isolation_risk']).toBe('cabins')
    expect(ISSUE_SECTION['unassigned_camper']).toBe('cabins')
  })
  it('hides benign/suppressed types', () => {
    expect(ISSUE_SECTION['no_requests']).toBe('hidden')
    expect(ISSUE_SECTION['valid_request_unsatisfied']).toBe('hidden')
  })
  it('marks capacity + unassigned red, composition nits amber', () => {
    expect(ISSUE_SEVERITY['capacity_violation']).toBe('red')
    expect(ISSUE_SEVERITY['unassigned_camper']).toBe('red')
    expect(ISSUE_SEVERITY['age_spread_warning']).toBe('amber')
    expect(ISSUE_SEVERITY['isolation_risk']).toBe('amber')
  })
  it('marks every family cohort red (real misses)', () => {
    expect(COHORT_SEVERITY['got_nothing']).toBe('red')
    expect(COHORT_SEVERITY['sacrificed_mp']).toBe('red')
  })
  it('reason severity: policy conflicts red, data/enrollment amber', () => {
    expect(REASON_SEVERITY.grade_compatibility).toBe('red')
    expect(REASON_SEVERITY.pair_no_shared_bunk).toBe('red')
    expect(REASON_SEVERITY.self_conflict).toBe('red')
    expect(REASON_SEVERITY.target_not_in_solver).toBe('amber')
    expect(REASON_SEVERITY.malformed).toBe('amber')
    expect(REASON_SEVERITY.age_pref_no_eligible_grade).toBe('amber')
  })
})
