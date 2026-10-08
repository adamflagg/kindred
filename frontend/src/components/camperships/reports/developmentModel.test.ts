/** Development's table in words (spec §9.4; D65, D66, D87, D99, D158; Part C D44, D45). */
import { describe, expect, it } from 'vitest'

import { reportText } from '../kit/report'
import { DEVELOPMENT } from './developmentFixtures'
import {
  columnHeader,
  datedSeasons,
  datedWords,
  dayBefore,
  developmentRows,
  notBuiltLines,
  notRebuiltColumnWords,
  rebuildReason,
  sourceRows,
  unconfirmedWords,
  withColumn,
  withoutColumn,
} from './developmentModel'

const texts = (row: { cells: ReadonlyArray<Parameters<typeof reportText>[0]> } | undefined) =>
  (row?.cells ?? []).map(reportText)

describe('the report', () => {
  it('groups the lines Money · Counts · Appeals and cancellations, in the server’s order', () => {
    expect(developmentRows(DEVELOPMENT).map((r) => [r.kind, texts(r)[0]])).toEqual([
      ['heading', 'Money'],
      ['body', 'Total Awards Granted'],
      ['body', 'Total Awards Granted'],
      ['body', '% of need met'],
      ['heading', 'Counts'],
      ['body', 'First-time'],
      ['heading', 'Appeals and cancellations'],
      ['body', 'Declined enrollment for insufficient aid'],
    ])
  })

  it("names each line's group from the read, and every group as such (⚠ Decision 15)", () => {
    const [, poolA, every] = developmentRows(DEVELOPMENT)
    expect(texts(poolA).slice(0, 3)).toEqual(['Total Awards Granted', 'Pool A', '$800,000'])
    expect(texts(every).slice(0, 2)).toEqual(['Total Awards Granted', 'Every group'])
  })

  it('draws each unit as the kit does, and "—" where a basis has nothing (D74)', () => {
    const rows = developmentRows(DEVELOPMENT)
    expect(texts(rows[3])).toEqual(['% of need met', 'Pool A', '—', '76.5%', '61.2%', '54.0%'])
    expect(texts(rows[7]).slice(2)).toEqual(['0', '0', '3', '—'])
  })

  it("keeps each line's own definition under it (D99)", () => {
    expect(developmentRows(DEVELOPMENT)[5]?.note).toBe(
      'No summer session at camp in any earlier season from 2017'
    )
  })

  it('prints each column’s basis, and marks a contested one (O-930-1)', () => {
    expect(DEVELOPMENT.columns.map(columnHeader)).toEqual([
      '2025 (as reported) · r · basis unconfirmed',
      '2026 (as reported) · r',
      '2027 · P',
      '2027 as of Mar 9 · P',
    ])
    expect(unconfirmedWords(DEVELOPMENT)).toContain('Basis unconfirmed: 2025 (as reported).')
  })

  it("names a dated column's empty lines, and the rebuild's reason, in the server's words", () => {
    expect(notRebuiltColumnWords(DEVELOPMENT)).toContain('2027 as of Mar 9 (1 lines)')
    expect(rebuildReason(DEVELOPMENT)).toContain('waits on the 2017–2024 ledger backfill')
    expect(notBuiltLines(DEVELOPMENT)).toEqual([])
  })

  it('lists this season by source with its three facts (D88)', () => {
    expect(sourceRows(DEVELOPMENT).map(texts)).toEqual([
      ["The camp's awards", 'the camp', 'need-based', 'Pool A', '$1,500', '1'],
      ['Grantor A', 'another funder', 'incentive', 'Pool A', '$500', '1'],
    ])
  })
})

describe('the dated columns (Decision 17)', () => {
  const MARCH = { season: 2027, as_of: '2027-03-09' }
  const APRIL = { season: 2027, as_of: '2027-04-12' }

  it("adds to the list as it stands, keeping a colleague's column, and never twice", () => {
    expect(withColumn([MARCH], APRIL)).toEqual([MARCH, APRIL])
    expect(withColumn([MARCH], { ...MARCH })).toEqual([MARCH])
    expect(withoutColumn([MARCH, APRIL], { ...MARCH })).toEqual([APRIL])
  })

  it("offers the report's own P seasons from 2027, newest first (D67)", () => {
    expect(datedSeasons(DEVELOPMENT)).toEqual([2027])
    const earlierP = {
      season: 2026,
      basis: 'P' as const,
      as_of: '2026-09-01',
      basis_unconfirmed: false,
      label: '2026',
      not_rebuilt: [],
    }
    expect(datedSeasons({ ...DEVELOPMENT, columns: [...DEVELOPMENT.columns, earlierP] })).toEqual([
      2027,
    ])
    expect(datedWords(MARCH)).toBe('2027 as of Mar 9, 2027')
  })

  it('offers a past day only: the latest is the day before today, across a month and a year', () => {
    expect(dayBefore('2027-04-12')).toBe('2027-04-11')
    expect(dayBefore('2027-03-01')).toBe('2027-02-28')
    expect(dayBefore('2028-01-01')).toBe('2027-12-31')
  })
})
