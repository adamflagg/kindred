/** The Ledger tab's posted totals (F10; money-v2's pivot; R3-2): the server's figures, in words. */
import { describe, expect, it } from 'vitest'

import { SUMMARY, SUMMARY_PAST, SUMMARY_UNCLASSIFIED } from './ledgerFixtures'
import { BUDGET } from '../season/budgetFixtures'
import {
  footWords,
  hasUnclassified,
  pivotRows,
  programChoicesOf,
  programLabelsOf,
  shareWords,
  splitWords,
  tieOut,
  tieOutWords,
  gapReachesNotReconciled,
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
      'placed on a camper or request: 91% · at household level: 7% · not placed: 2% (each share of camp aid)'
    )
    expect(shareWords({ ...SUMMARY, camp_aid_levels: [] })).toBe('')
  })

  it('writes the mock’s foot line: the budget figure, the shares, the undated lines', () => {
    expect(footWords(SUMMARY)).toBe(
      'Counts toward the budget: $612,540 · placed on a camper or request: 91% · at household level: 7% · not placed: 2% (each share of camp aid). Undated postings: 0.'
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

  // Ruled test edit (coordinator 10-08, program_label): the server sends the season's label, so the
  // words come from `program_label`, never from a key. These replace the rules-map expectations
  // ('quest' -> 'Quest' spelled out from its key is now 'Other program').
  it("names a program in the server's label, and the two no-program buckets when it sends none", () => {
    expect(summaryProgramWords('summer', 'Summer Sessions')).toBe('Summer Sessions')
    expect(summaryProgramWords('ambiguous', '')).toBe('Household level')
    expect(summaryProgramWords('unattributed', '')).toBe('Not placed')
    expect(summaryProgramWords('ambiguous', undefined)).toBe('Household level')
    expect(summaryProgramWords('unattributed')).toBe('Not placed')
  })

  it('reads any other program without a label as "Other program", never its key', () => {
    expect(summaryProgramWords('quest', '')).toBe('Other program')
    expect(summaryProgramWords('quest', undefined)).toBe('Other program')
    expect(summaryProgramWords('quest')).toBe('Other program')
  })

  it('collects the labels the summary sends, by program key, skipping empty ones', () => {
    expect(programLabelsOf(SUMMARY)).toEqual({
      summer: 'Summer Sessions',
      family_camp: 'Family Camp Weekends',
    })
    expect(programLabelsOf(undefined)).toEqual({})
  })

  it('offers only the programs the summary has money under, labelled, buckets left out', () => {
    expect(programChoicesOf(SUMMARY, NAMES)).toEqual([
      { value: 'summer', label: 'Summer Sessions' },
      { value: 'family_camp', label: 'Family Camp Weekends' },
    ])
    expect(programChoicesOf(undefined)).toEqual([])
  })

  it("reads 'Other program' once for a program with money and no label", () => {
    const quest = {
      program: 'quest',
      program_label: '',
      camp_aid: 100,
      outside_grants: 0,
      unclassified: 0,
      total: 100,
      postings: 1,
      households: 1,
    }
    const extra = { ...SUMMARY, by_program: [...(SUMMARY.by_program ?? []), quest] }
    expect(programChoicesOf(extra, NAMES)).toEqual([
      { value: 'summer', label: 'Summer Sessions' },
      { value: 'family_camp', label: 'Family Camp Weekends' },
      { value: 'quest', label: 'Other program' },
    ])
  })

  it('names the CSV with the date it shows', () => {
    expect(summaryCsvName(2027, '2027-05-01')).toBe(
      'camperships-money-ledger-posted-by-program-and-source-2027-as-of-2027-05-01.csv'
    )
  })
})

describe('tieOut: camp aid counting toward the budget against Rounds & budget Posted, in cents', () => {
  const budgetWith = (posted: number) => ({
    ...BUDGET,
    total: { ...BUDGET.total, total: { ...BUDGET.total.total, posted } },
  })

  it('matches when both figures are the same to the cent', () => {
    const t = tieOut(SUMMARY, budgetWith(612540))
    expect(t).toEqual({ kind: 'match', camp: 612540, posted: 612540, apart: 0 })
  })

  it('is apart by the absolute difference, whichever side is larger', () => {
    expect(tieOut(SUMMARY, budgetWith(612000.5))).toEqual({
      kind: 'apart',
      camp: 612540,
      posted: 612000.5,
      apart: 539.5,
    })
    expect(tieOut(SUMMARY, budgetWith(613000)).apart).toBe(460)
  })

  it('compares counts_toward_budget, never camp_aid', () => {
    const t = tieOut({ ...SUMMARY, camp_aid: 1, counts_toward_budget: 500 }, budgetWith(500))
    expect(t.kind).toBe('match')
  })

  it('does not trip on float noise below a cent', () => {
    expect(tieOut({ ...SUMMARY, counts_toward_budget: 0.1 + 0.2 }, budgetWith(0.3)).kind).toBe(
      'match'
    )
  })
})

describe('tieOutWords', () => {
  it('words a match', () => {
    expect(tieOutWords({ kind: 'match', camp: 652100, posted: 652100, apart: 0 }, null)).toBe(
      'Camp aid posted $652,100 · matches Season › Rounds & budget Posted $652,100'
    )
  })
  it('words a gap, with the To place count when known', () => {
    const t = { kind: 'apart', camp: 652100, posted: 640000, apart: 12100 } as const
    expect(tieOutWords(t, 4)).toBe(
      'Camp aid posted $652,100 · Season › Rounds & budget Posted $640,000 · $12,100 apart · see To place (4 lines)'
    )
    expect(tieOutWords(t, 1)).toMatch(/see To place \(1 line\)$/)
    expect(tieOutWords(t, null)).toMatch(/\$12,100 apart · see To place$/)
  })
})

describe('gapReachesNotReconciled', () => {
  const apart = { kind: 'apart', camp: 652100, posted: 640000, apart: 12100 } as const
  it('is true when To place holds less than the gap', () => {
    expect(gapReachesNotReconciled(apart, 10810)).toBe(true)
  })
  it('is false when To place holds the whole gap, or more', () => {
    expect(gapReachesNotReconciled(apart, 12100)).toBe(false)
    expect(gapReachesNotReconciled(apart, 13000)).toBe(false)
  })
  it('is true when Posted is above camp aid: To place can never explain that', () => {
    expect(
      gapReachesNotReconciled({ kind: 'apart', camp: 600000, posted: 612100, apart: 12100 }, 99999)
    ).toBe(true)
  })
  it('is false on a match, and when the To place total is unknown', () => {
    expect(gapReachesNotReconciled({ kind: 'match', camp: 1, posted: 1, apart: 0 }, 0)).toBe(false)
    expect(gapReachesNotReconciled(apart, null)).toBe(false)
  })
})
