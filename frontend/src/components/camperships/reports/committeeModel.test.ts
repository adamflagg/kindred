/** The committee's tables in words (spec §9.7; D155; owner N2): P and r rows, as the server sends them. */
import { describe, expect, it } from 'vitest'

import { reportText } from '../kit/report'
import { COMMITTEE } from './committeeFixtures'
import {
  applicationRows,
  bandWords,
  budgetRows,
  overUnderWords,
  parsePhaseShare,
  phaseColumns,
  phaseLabels,
  phaseRows,
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
})
