/** Development's table in words (spec §9.4; D65, D66, D87, D99, D158; Part C D44, D45). */
import { describe, expect, it } from 'vitest'

import { reportText } from '../kit/report'
import { DEVELOPMENT } from './developmentFixtures'
import {
  columnHeader,
  datedSeasons,
  datedWords,
  dayBefore,
  developmentColumns,
  developmentRows,
  notBuiltLines,
  notRebuiltColumnWords,
  rebuildReason,
  SUB_LINES,
  sourceRows,
  unconfirmedWords,
  withColumn,
  withoutColumn,
} from './developmentModel'

const texts = (row: { cells: ReadonlyArray<Parameters<typeof reportText>[0]> } | undefined) =>
  (row?.cells ?? []).map(reportText)

describe('the report', () => {
  it('groups the lines Money · Counts · Appeals and cancellations, one row per line', () => {
    expect(developmentRows(DEVELOPMENT).map((r) => [r.kind, texts(r)[0]])).toEqual([
      ['heading', 'Money'],
      ['body', 'Total Awards Granted'],
      ['body', 'Pool A'],
      ['body', 'Pool B'],
      ['body', 'Camp awards'],
      ['body', 'Incentive awards'],
      ['body', '% of need met, Pool A'],
      ['heading', 'Counts'],
      ['body', 'Recipients'],
      ['body', 'Pool A'],
      ['body', 'Pool B'],
      ['body', 'First-time, Pool A'],
      ['body', 'First-time, Pool B'],
      ['body', 'Gender, campers who got money: girl, Pool A'],
      ['heading', 'Appeals and cancellations'],
      ['body', 'Declined enrollment for insufficient aid'],
      ['body', 'Cancelled after an award'],
    ])
  })

  it('draws each section once, Money · Counts · Appeals, when the server sends a line out of its section', () => {
    // The read sends Household-level grant dollars (money) after the counts lines and the gender
    // rows (counts) after the appeals: each still sits under its own section's one heading.
    const late = {
      ...DEVELOPMENT,
      rows: [
        ...DEVELOPMENT.rows,
        {
          ...DEVELOPMENT.rows[0]!,
          key: 'household_level_amount',
          label: 'Household-level grant dollars',
          group: null,
        },
      ],
    }
    const drawn = developmentRows(late).map((r) => [r.kind, texts(r)[0]])
    expect(drawn.filter(([kind]) => kind === 'heading').map(([, text]) => text)).toEqual([
      'Money',
      'Counts',
      'Appeals and cancellations',
    ])
    const money = drawn.findIndex(([, text]) => text === 'Household-level grant dollars')
    expect(money).toBeGreaterThan(drawn.findIndex(([, text]) => text === '% of need met, Pool A'))
    expect(money).toBeLessThan(drawn.findIndex(([, text]) => text === 'Counts'))
  })

  it('has no Group column: the header is Line and the season columns', () => {
    expect(developmentColumns(DEVELOPMENT).map((c) => c.header)).toEqual([
      'Line',
      ...DEVELOPMENT.columns.map(columnHeader),
    ])
  })

  it('draws a line with an every-group row once, with its definition once and that row’s figures', () => {
    const rows = developmentRows(DEVELOPMENT)
    expect(texts(rows[1])).toEqual([
      'Total Awards Granted',
      '$900,000',
      '$930,000',
      '$2,500',
      '$1,800',
    ])
    expect(rows[1]?.note).toBe('Every award, the camp’s and outside grants')
    expect(rows.filter((r) => texts(r)[0] === 'Recipients')).toHaveLength(1)
    expect(rows[8]?.note).toBe('People with an award this season')
    expect(rows[9]?.note).toBeUndefined()
    expect(rows[10]?.note).toBeUndefined()
  })

  it('draws Total Awards Granted and Recipients by group, indented under them, labelled by group', () => {
    const rows = developmentRows(DEVELOPMENT)
    expect(rows.slice(2, 4).map((r) => [texts(r)[0], r.indent, texts(r)[1]])).toEqual([
      ['Pool A', 1, '$800,000'],
      ['Pool B', 1, '$100,000'],
    ])
    expect(rows.slice(9, 11).map((r) => [texts(r)[0], r.indent, texts(r)[1]])).toEqual([
      ['Pool A', 1, '10'],
      ['Pool B', 1, '4'],
    ])
  })

  it('draws no group rows under any other line (Camp awards)', () => {
    const labels = developmentRows(DEVELOPMENT).map((r) => texts(r)[0])
    expect(labels.filter((l) => l === 'Camp awards')).toHaveLength(1)
    expect(labels.indexOf('Camp awards') + 1).toBe(labels.indexOf('Incentive awards'))
  })

  it('reads a kind-limited line "label, Pool A", keeping each distinct definition once', () => {
    const rows = developmentRows(DEVELOPMENT)
    expect(texts(rows[6])).toEqual(['% of need met, Pool A', '—', '76.5%', '61.2%', '54.0%'])
    expect(rows[6]?.note).toBeUndefined()
    expect(rows[11]?.note).toBe('No summer session at camp in any earlier season from 2017')
    expect(rows[12]?.note).toBe('No family camp in any earlier season')
  })

  it('never repeats a definition verbatim on consecutive rows of a kind-limited line', () => {
    const same = {
      ...DEVELOPMENT,
      rows: DEVELOPMENT.rows.map((r) =>
        r.key === 'first_time' ? { ...r, definition: 'Same words' } : r
      ),
    }
    const notes = developmentRows(same)
      .filter((r) => texts(r)[0]?.startsWith('First-time'))
      .map((r) => r.note)
    expect(notes).toEqual(['Same words', undefined])
  })

  it('indents the sub-lines as the mock does (SUB_LINES)', () => {
    expect(SUB_LINES['camp_awards']).toBe(1)
    expect(SUB_LINES['incentive_awards']).toBe(2)
    const rows = developmentRows(DEVELOPMENT)
    const indentOf = (label: string) => rows.find((r) => texts(r)[0] === label)?.indent
    expect(indentOf('Camp awards')).toBe(1)
    expect(indentOf('Incentive awards')).toBe(2)
    expect(indentOf('Cancelled after an award')).toBe(1)
    expect(indentOf('Total Awards Granted')).toBe(0)
    expect(indentOf('Gender, campers who got money: girl, Pool A')).toBe(1)
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
