/** Development's table in words (spec §9.4; D65, D66, D87, D99, D158; Part C D44, D45). */
import { describe, expect, it } from 'vitest'

import { csvLines, reportText } from '../kit/report'
import {
  BUDGET_ROW,
  DEVELOPMENT,
  DEVELOPMENT_GRANTORS,
  DEVELOPMENT_LIVE,
} from './developmentFixtures'
import {
  columnHeader,
  datedSeasons,
  datedWords,
  dayBefore,
  developmentColumns,
  developmentRows,
  notRebuiltColumnWords,
  rebuildReason,
  SUB_LINES,
  unconfirmedWords,
  columnParam,
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
  })
})

describe('the grantor lines (D3)', () => {
  const rows = developmentRows(DEVELOPMENT_GRANTORS)
  const at = rows.findIndex((r) => texts(r)[0] === 'Outside grants')

  it('puts one line per other funder under Outside grants, one level deeper, the camp’s own never', () => {
    expect(at).toBeGreaterThan(0)
    const lines = rows.slice(at + 1, at + 3)
    expect(lines.map((r) => texts(r)[0])).toEqual(['Grantor A', 'Grantor B'])
    expect(lines.map((r) => r.indent)).toEqual([
      (rows[at]?.indent ?? 0) + 1,
      (rows[at]?.indent ?? 0) + 1,
    ])
    expect(rows.some((r) => texts(r)[0] === "The camp's awards")).toBe(false)
  })

  it('states the facts in muted words, and “needs a group” when the funder has none', () => {
    expect(rows[at + 1]?.note).toBe('another funder · incentive')
    expect(rows[at + 2]?.note).toBe('another funder · need-based · needs a group')
  })

  it('shows the amount only in the read’s own season, dashboard column, as of the figures day', () => {
    expect(texts(rows[at + 1])).toEqual(['Grantor A', '—', '—', '$500'])
    expect(texts(rows[at + 2])).toEqual(['Grantor B', '—', '—', '$250'])
    // the as-of column (same season, an earlier day) is nothing there too
    const withDay = developmentRows({
      ...DEVELOPMENT,
      rows: [
        ...DEVELOPMENT.rows,
        ...DEVELOPMENT_GRANTORS.rows
          .filter((r) => r.key === 'outside_awards')
          .map((r) => ({ ...r, values: [...r.values, 100] })),
      ],
      sources: DEVELOPMENT_GRANTORS.sources,
    })
    const i = withDay.findIndex((r) => texts(r)[0] === 'Outside grants')
    expect(texts(withDay[i + 1])).toEqual(['Grantor A', '—', '—', '$500', '—'])
  })

  it('draws no lines, and no source table, when the read has no Outside grants line or no funder', () => {
    expect(developmentRows(DEVELOPMENT_LIVE).some((r) => texts(r)[0] === 'Grantor A')).toBe(false)
    const none = developmentRows({
      ...DEVELOPMENT_GRANTORS,
      sources: DEVELOPMENT_GRANTORS.sources.filter((s) => s.who_paid === 'the camp'),
    })
    expect(none.some((r) => texts(r)[0]?.startsWith('Grantor'))).toBe(false)
  })

  it('carries the lines into the CSV', () => {
    const csv = csvLines(
      {
        title: 'Development report',
        season: 2027,
        figuresOn: '2027-06-03',
        live: true,
        basis: 'mixed',
      } as never,
      developmentColumns(DEVELOPMENT_GRANTORS),
      rows,
      '/x'
    )
    expect(csv.some((line) => line[0] === 'Grantor A')).toBe(true)
  })
})

describe('the Budget row (D2)', () => {
  it('draws first in Money, whatever place the server sends it, its label and dollars as sent', () => {
    const late = { ...DEVELOPMENT_LIVE, rows: [...DEVELOPMENT_LIVE.rows, BUDGET_ROW] }
    const rows = developmentRows(late)
    expect(rows[0]?.kind).toBe('heading')
    expect(texts(rows[0])).toEqual(['Money'])
    expect(texts(rows[1])).toEqual(['Budget', '$1,000,000', '$1,050,000', '$1,200,000'])
    expect(rows[1]?.indent).toBe(0)
    expect(rows.filter((r) => texts(r)[0] === 'Budget')).toHaveLength(1)
    expect(texts(rows[2])[0]).toBe('Total Awards Granted')
  })

  it('draws nothing, no placeholder, when the read sends no budget', () => {
    expect(developmentRows(DEVELOPMENT_LIVE).map((r) => texts(r)[0])).not.toContain('Budget')
    expect(texts(developmentRows(DEVELOPMENT_LIVE)[1])[0]).toBe('Total Awards Granted')
  })
})

describe('the on-demand column (D1)', () => {
  const MARCH = { season: 2027, day: '2027-03-09' }

  it('is addressed as <season>:<day>', () => {
    expect(columnParam(MARCH)).toBe('2027:2027-03-09')
  })

  it('tags only the column that matches the one asked for, as not saved', () => {
    const tag = ' · not saved · gone when you leave'
    const headers = developmentColumns(DEVELOPMENT, MARCH).map((c) => c.header)
    expect(headers[4]).toBe(`2027 as of Mar 9 · P${tag}`)
    expect(headers.filter((h) => h.includes('not saved'))).toHaveLength(1)
    expect(developmentColumns(DEVELOPMENT).some((c) => c.header.includes('not saved'))).toBe(false)
    expect(
      developmentColumns(DEVELOPMENT, { season: 2027, day: '2027-04-12' }).some((c) =>
        c.header.includes('not saved')
      )
    ).toBe(false)
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
