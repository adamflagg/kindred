/** The Ledger tab's posted totals (F10; money-v2's pivot; R3-2): the server's figures, in words. */
import { describe, expect, it } from 'vitest'

import { SUMMARY, SUMMARY_PAST, SUMMARY_UNCLASSIFIED } from './ledgerFixtures'
import {
  footWords,
  hasUnclassified,
  pivotRows,
  shareWords,
  splitWords,
  summaryCsvName,
  summaryProgramWords,
} from './ledgerModel'

const NAMES = { summer: 'Summer Sessions', family_camp: 'Family Camp Weekends' }

describe('ledgerModel', () => {
  it("orders the programs as the rules do, then the server's two no-program buckets (R3-10)", () => {
    expect(pivotRows(SUMMARY, NAMES).map((r) => r.program)).toEqual([
      'summer',
      'family_camp',
      'ambiguous',
      'unattributed',
    ])
    // A program the rules don't name comes after the named ones, before the buckets.
    const quest = {
      program: 'quest',
      camp_aid: 100,
      outside_grants: 0,
      unclassified: 0,
      total: 100,
      postings: 1,
      households: 1,
    }
    const extra = { ...SUMMARY, by_program: [...(SUMMARY.by_program ?? []), quest] }
    expect(pivotRows(extra, NAMES).map((r) => r.program)).toEqual([
      'summer',
      'family_camp',
      'quest',
      'ambiguous',
      'unattributed',
    ])
  })

  it('says the camp-aid shares in the mock’s words, from the server, never summed here', () => {
    expect(shareWords(SUMMARY)).toBe(
      'placed on a request: 91% · at household level: 7% · not placed: 2% (each share of camp aid)'
    )
    expect(shareWords({ ...SUMMARY, camp_aid_levels: [] })).toBe('')
  })

  it('writes the mock’s foot line: the budget figure, the shares, the undated lines', () => {
    expect(footWords(SUMMARY)).toBe(
      'Counts toward the budget: $612,540 · placed on a request: 91% · at household level: 7% · not placed: 2% (each share of camp aid). Undated postings: 0.'
    )
    expect(footWords(SUMMARY_PAST)).toMatch(/Undated postings: 2\.$/)
  })

  it('shows an Unclassified column only when the season has a line nobody classified', () => {
    expect(hasUnclassified(SUMMARY)).toBe(false)
    expect(hasUnclassified(SUMMARY_UNCLASSIFIED)).toBe(true)
  })

  it('says a split reads at household level only on the attribution basis (review item 24)', () => {
    expect(splitWords(SUMMARY)).toBeNull()
    expect(splitWords(SUMMARY_PAST)).toMatch(/^A split placement still counts at household level/)
  })

  it("names a program in the rules' words, and the server's no-program buckets", () => {
    expect(summaryProgramWords('summer', NAMES)).toBe('Summer Sessions')
    expect(summaryProgramWords('quest', NAMES)).toBe('Quest')
    expect(summaryProgramWords('ambiguous', NAMES)).toBe('Household level')
    expect(summaryProgramWords('unattributed', NAMES)).toBe('Not placed')
  })

  it('names the CSV with the date it shows', () => {
    expect(summaryCsvName(2027, '2027-05-01')).toBe(
      'camperships-money-ledger-posted-by-program-and-source-2027-as-of-2027-05-01.csv'
    )
  })
})
