/** The committee's tables in words (spec §9.7; D155; owner N2): P and r rows, as the server sends them. */
import { describe, expect, it } from 'vitest'

import { reportText } from '../kit/report'
import { COMMITTEE } from './committeeFixtures'
import {
  appealsColumns,
  appealsRows,
  applicationColumns,
  applicationRows,
  bandWords,
  budgetColumns,
  budgetRows,
  committeeCsvName,
  committeeHeading,
  overUnderWords,
  parsePhaseShare,
  phaseColumns,
  phaseLabels,
  phaseRows,
  ROUND1_COLUMNS,
  round1Rows,
  seasonWords,
} from './committeeModel'

const texts = (row: { cells: ReadonlyArray<Parameters<typeof reportText>[0]> } | undefined) =>
  (row?.cells ?? []).map(reportText)

describe('the phase table (RPT-1; owner N2)', () => {
  it('shows each phase As offered and End of season, as % of budget by default (R1)', () => {
    expect(parsePhaseShare(null)).toBe('budget')
    const cells = texts(phaseRows(COMMITTEE, 'budget')[0])
    expect(cells.slice(0, 6)).toEqual([
      '2026 · r',
      '$300,000',
      '60.0%',
      '$300,000',
      '60.0%',
      '51–55%: above',
    ])
    expect(cells.slice(-5)).toEqual(['$460,000', '92.0%', '$500,000', '$40,000 under', '$10,000'])
  })

  it("switches every phase's % to the share of the phases, never mixing the two", () => {
    const cells = texts(phaseRows(COMMITTEE, 'share')[0])
    expect(cells.slice(1, 5)).toEqual(['$300,000', '—', '$300,000', '66.7%'])
    expect(phaseColumns('share', () => null)[2]?.header).toBe('share of the phases')
  })

  it("heads the phase columns with the read's own labels, today's words only with no row (owner N2)", () => {
    const relabelled = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({
        ...row,
        offered_label: 'Offered',
        end_of_season_label: 'Season end',
      })),
    }
    const headers = phaseColumns('budget', () => null, phaseLabels(relabelled)).map((c) => c.header)
    expect(headers.slice(1, 4)).toEqual(['Offered', '% of budget', 'Season end'])
    expect(phaseLabels({ ...COMMITTEE, phases: [] })).toEqual({
      offered: 'As offered',
      end: 'End of season',
    })
  })

  it("marks a P season that hasn't closed as to date", () => {
    expect(texts(phaseRows(COMMITTEE, 'budget')[1])[0]).toBe('2027 · P · to date')
    expect(seasonWords(2026, 'r')).toBe('2026 · r')
  })

  it('states over and under in words, with one sign convention', () => {
    expect(overUnderWords(-40000, 'under')).toBe('$40,000 under')
    expect(overUnderWords(1200, 'over')).toBe('$1,200 over')
    expect(overUnderWords(0, 'on')).toBe('on budget')
    expect(overUnderWords(null, null)).toBe('—')
    expect(bandWords(null)).toBe('—')
    expect(bandWords({ low_pct: 51, high_pct: 55, low: 1, high: 2, position: null })).toBe('51–55%')
    expect(bandWords({ low_pct: 51, high_pct: 55, low: 1, high: 2, position: 'below' })).toBe(
      '51–55%: below'
    )
  })
})

describe('the other four tables', () => {
  it('says when a frozen ask fell back to today’s (owner R2b D12)', () => {
    const [headline, pool] = applicationRows(COMMITTEE)
    expect(headline?.note).toBe(
      'Asks as they stand now: one request was corrected after the deadline'
    )
    expect(pool?.note).toBeUndefined()
    expect(texts(headline).slice(0, 6)).toEqual([
      '2027 · P',
      'All pools',
      'Feb 1',
      '2',
      '$6,000',
      '$3,000',
    ])
  })

  it('keeps the typed note beside a budget row', () => {
    expect(texts(budgetRows(COMMITTEE)[0])).toEqual([
      '2026 · r',
      'All pools',
      '$500,000',
      '$460,000',
      '$40,000 under',
      '92.0%',
      '—',
      '—',
      'first board-approved budget',
    ])
  })

  it('draws a pool row of the applications table whole, with no note and its changes as sent', () => {
    const pool = applicationRows(COMMITTEE)[1]
    expect(texts(pool)).toEqual([
      '2027 · P',
      'Pool A',
      'Feb 1',
      '2',
      '$6,000',
      '$3,000',
      '0',
      '$0',
      '—',
      '2',
      '$6,000',
      '$3,000',
      'Apr 10',
      '—',
      '—',
      '0',
    ])
  })

  it('draws the appeals table, a real 0% appeal rate included', () => {
    expect(appealsRows(COMMITTEE).map(texts)).toEqual([
      ['2026 · r', '520', '104', '20.0%'],
      ['2027 · P', '2', '0', '0.0%'],
    ])
  })

  it("draws Round 1's share of the ask as sent", () => {
    expect(round1Rows(COMMITTEE).map(texts)).toEqual([
      ['2027 · P', 'All pools', '$1,500', '$7,000', '$6,000', '25.0%'],
    ])
  })

  it('heads each table on the mixed basis, and names the share file apart from the default', () => {
    expect(committeeHeading(COMMITTEE, 'Appeals')).toMatchObject({
      title: 'Appeals',
      season: 2027,
      figuresOn: '2027-04-10',
    })
    const view = { year: 2027, asOf: { kind: 'live' } } as const
    expect(committeeCsvName(view, 'phases', 'share')).toBe(
      'camperships-reports-year-over-year-phases-share-of-phases-2027.csv'
    )
    expect(committeeCsvName(view, 'phases', 'budget')).toBe(
      'camperships-reports-year-over-year-phases-2027.csv'
    )
    expect(committeeCsvName(view, 'appeals', 'share')).toBe(
      'camperships-reports-year-over-year-appeals-2027.csv'
    )
  })
})

describe("Year over year's dividers, where statistics-v2.html draws them (.bl)", () => {
  const divided = (columns: readonly { key: string; divider?: 'before' | undefined }[]) =>
    columns.filter((c) => c.divider === 'before').map((c) => c.key)

  it('divides each phase and the total in RPT-1', () => {
    expect(divided(phaseColumns('budget', () => null))).toEqual([
      'p0-offered',
      'p1-offered',
      'p2-offered',
      'total',
    ])
  })

  it('divides the cutoff, received-since and season-end blocks in RPT-2/6', () => {
    expect(divided(applicationColumns(() => null))).toEqual(['cutApps', 'sinceApps', 'endApps'])
  })

  it("divides the budget's figures from the pool, and the share, in RPT-7/24", () => {
    expect(divided(budgetColumns(() => null))).toEqual(['budget', 'share'])
  })

  it('divides the figures from the season in RPT-8 and RPT-13', () => {
    expect(divided(appealsColumns(() => null))).toEqual(['applications'])
    expect(divided(ROUND1_COLUMNS)).toEqual(['awarded'])
  })
})
