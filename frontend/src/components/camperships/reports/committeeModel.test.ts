/** The committee's tables in words (spec §9.7; D155; owner N2): P and r rows, as the server sends them. */
import { describe, expect, it } from 'vitest'

import { reportCsv, reportText } from '../kit/report'
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
  reconciliationWords,
  ROUND1_COLUMNS,
  round1Rows,
  seasonWords,
} from './committeeModel'

const texts = (row: { cells: ReadonlyArray<Parameters<typeof reportText>[0]> } | undefined) =>
  (row?.cells ?? []).map(reportText)

describe('the phase table (RPT-1; owner N2)', () => {
  it('draws 14 columns: the season, three phases of As offered · End of season · %, the total, the budget, over / under', () => {
    const columns = phaseColumns('budget', () => null)
    expect(columns).toHaveLength(14)
    expect(columns.map((c) => c.header)).toEqual([
      'Season',
      ...[0, 1, 2].flatMap(() => ['As offered', 'End of season', '% of budget']),
      'End of season',
      '% of budget',
      'Budget',
      'Over / under',
    ])
    const keys = columns.map((c) => c.key)
    expect(keys.some((k) => k.endsWith('band') || k === 'reconciliation')).toBe(false)
    expect(keys).toHaveLength(new Set(keys).size)
  })

  it("takes each phase's % from End of season's, with the band words as that cell's note (R3)", () => {
    expect(parsePhaseShare(null)).toBe('budget')
    const row = phaseRows(COMMITTEE, 'budget')[0]
    expect(row?.cells).toHaveLength(14)
    expect(texts(row)).toEqual([
      '2026 · r',
      '$300,000',
      '$300,000',
      '60.0%',
      '—',
      '$100,000',
      '20.0%',
      '—',
      '$50,000',
      '10.0%',
      '$460,000',
      '92.0%',
      '$500,000',
      '$40,000 under',
    ])
    // The band sits in the first phase's % cell; a phase with no band has no note, never "—".
    expect(row?.cells[3]).toMatchObject({ kind: 'pct', value: 60, note: '51–55%: above' })
    expect(row?.cells[6]).not.toHaveProperty('note')
    expect(row?.cells[9]).not.toHaveProperty('note')
  })

  it("switches every phase's % to the share of the phases, never mixing the two", () => {
    const row = phaseRows(COMMITTEE, 'share')[0]
    expect(row?.cells[3]).toMatchObject({ value: 66.7, note: '51–55%: above' })
    expect(row?.cells[6]).toMatchObject({ value: 22.2 })
    expect(row?.cells[11]).toMatchObject({ value: 92 })
    expect(phaseColumns('share', () => null)[3]?.header).toBe('Share of the phases')
    expect(phaseColumns('share', () => null)[11]?.header).toBe('% of budget')
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
    expect(headers.slice(1, 4)).toEqual(['Offered', 'Season end', '% of budget'])
    expect(headers[10]).toBe('Season end')
    expect(phaseLabels({ ...COMMITTEE, phases: [] })).toEqual({
      offered: 'As offered',
      end: 'End of season',
    })
  })

  it('words the add-up check only for seasons whose total differs from the phases', () => {
    expect(reconciliationWords(COMMITTEE)).toBe('Total − Σ phases: 2026 $10,000')
    const both = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: 1200 })),
    }
    expect(reconciliationWords(both)).toBe('Total − Σ phases: 2026 $1,200; 2027 $1,200')
    const none = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: 0 })),
    }
    expect(reconciliationWords(none)).toBeNull()
    const absent = {
      ...COMMITTEE,
      phases: COMMITTEE.phases.map((row) => ({ ...row, reconciliation: null })),
    }
    expect(reconciliationWords(absent)).toBeNull()
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
  it('shows an application average with cents in whole dollars', () => {
    const [headline] = applicationRows({
      ...COMMITTEE,
      applications: COMMITTEE.applications.map((row, i) =>
        i > 0 ? row : { ...row, at_cutoff: { ...row.at_cutoff!, average: 2744.44 } }
      ),
    })
    expect(texts(headline)).toContain('$2,744')
  })

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

  it('writes Over / under to the CSV as a plain signed number (under is negative), the words on screen', () => {
    const phase = phaseRows(COMMITTEE, 'budget')[0]
    expect(phase?.cells[13] && reportText(phase.cells[13])).toBe('$40,000 under')
    expect(phase?.cells[13] && reportCsv(phase.cells[13])).toBe('-40000')
    const budget = budgetRows(COMMITTEE)[0]
    expect(budget?.cells[4] && reportText(budget.cells[4])).toBe('$40,000 under')
    expect(budget?.cells[4] && reportCsv(budget.cells[4])).toBe('-40000')
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
  const divided = (columns: ReadonlyArray<{ key: string; divider?: 'before' | undefined }>) =>
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
