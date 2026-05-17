import { describe, it, expect } from 'vitest'
import { extractBunkName } from './issueClassifier'

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
