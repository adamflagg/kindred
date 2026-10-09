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
  cappedWords,
  columnHeader,
  developmentTable,
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
      ['body', 'Camp awards'],
      ['body', 'Incentive awards'],
      // development-v2: the pools sit under the camp's awards and the outside grants (final audit O1)
      ['body', 'Pool A'],
      ['body', 'Pool B'],
      ['body', '% of need met, Pool A'],
      ['heading', 'Counts'],
      ['body', 'Recipients'],
      ['body', 'Pool A campers'],
      ['body', 'Pool B families'],
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

  it('has no Group column: the header is Metric and the season columns (development-v2)', () => {
    expect(developmentColumns(DEVELOPMENT).map((c) => c.header)).toEqual([
      'Metric',
      ...DEVELOPMENT.columns.map((c) => columnHeader(c, DEVELOPMENT)),
    ])
  })

  it('draws a line with an every-group row once, its definition a numbered note, never in the row', () => {
    const { rows, notes } = developmentTable(DEVELOPMENT)
    expect(texts(rows[1])).toEqual([
      'Total Awards Granted',
      '$900,000',
      '$930,000',
      '$2,500',
      '$1,800',
    ])
    // final audit O3: the row stays one line, with a superscript; the words are in the notes below
    expect(rows.every((r) => r.note === undefined || r.key.startsWith('grantor-'))).toBe(true)
    expect(rows[1]?.ref).toBe(1)
    expect(notes[0]).toEqual({ n: 1, text: 'Every award, the camp’s and outside grants' })
    expect(rows.filter((r) => texts(r)[0] === 'Recipients')).toHaveLength(1)
    const recipients = rows.find((r) => texts(r)[0] === 'Recipients')
    expect(notes.find((n) => n.n === recipients?.ref)?.text).toBe(
      'People with an award this season'
    )
    expect(rows.find((r) => texts(r)[0] === 'Pool A campers')?.ref).toBeUndefined()
  })

  it('numbers the notes in the order the rows first call for them, as the mock does, each once', () => {
    const { rows, notes } = developmentTable(DEVELOPMENT)
    const refs = rows.map((r) => r.ref).filter((n) => n !== undefined)
    expect([...new Set(refs)]).toEqual(notes.map((n) => n.n))
    expect(notes.map((n) => n.n)).toEqual(notes.map((_, i) => i + 1))
  })

  it("numbers a row the registry defines (its key's note) when the read sends no definition, and lists the registry's other notes after", () => {
    const registry = [
      { key: 'need', text: 'Need: the asks.' },
      { key: 'dev_appeals', text: 'Appeals: Round 2 asks.' },
      { key: 'basis_unconfirmed', text: 'Basis unconfirmed: typed years.' },
    ]
    const { rows, notes } = developmentTable(DEVELOPMENT, { registry })
    const declined = rows.find((r) => texts(r)[0] === 'Declined enrollment for insufficient aid')
    expect(notes.find((n) => n.n === declined?.ref)?.text).toBe('Appeals: Round 2 asks.')
    const needMet = rows.find((r) => texts(r)[0] === '% of need met, Pool A')
    expect(notes.find((n) => n.n === needMet?.ref)?.text).toBe('Need: the asks.')
    expect(notes.at(-1)?.text).toBe('Basis unconfirmed: typed years.')
  })

  it('draws Total Awards Granted and Recipients by group, indented under them, labelled by group', () => {
    const rows = developmentRows(DEVELOPMENT)
    const at = (label: string) => rows.findIndex((r) => texts(r)[0] === label)
    expect(
      rows
        .slice(at('Incentive awards') + 1, at('Incentive awards') + 3)
        .map((r) => [texts(r)[0], r.indent, texts(r)[1]])
    ).toEqual([
      ['Pool A', 1, '$800,000'],
      ['Pool B', 1, '$100,000'],
    ])
    expect(
      rows
        .slice(at('Recipients') + 1, at('Recipients') + 3)
        .map((r) => [texts(r)[0], r.indent, texts(r)[1]])
    ).toEqual([
      ['Pool A campers', 1, '10'],
      ['Pool B families', 1, '4'],
    ])
  })

  it('draws the pools under Total Awards Granted even when no sub-line follows it', () => {
    const bare = {
      ...DEVELOPMENT,
      rows: DEVELOPMENT.rows.filter((r) => r.key !== 'camp_awards' && r.key !== 'incentive_awards'),
    }
    const labels = developmentRows(bare).map((r) => texts(r)[0])
    expect(labels.slice(1, 4)).toEqual(['Total Awards Granted', 'Pool A', 'Pool B'])
  })

  it('indents the money no group holds under Total Awards Granted, as the mock does', () => {
    expect(SUB_LINES['not_in_group_amount']).toBe(1)
    expect(SUB_LINES['not_in_group_awards']).toBe(1)
  })

  it('shows Average award in whole dollars, as the mock does', () => {
    const avg = {
      ...DEVELOPMENT,
      rows: [
        ...DEVELOPMENT.rows,
        {
          ...DEVELOPMENT.rows[2]!,
          key: 'average_award',
          label: 'Average award',
          values: [2744.44, null, 2480.52, null],
        },
      ],
    }
    const row = developmentRows(avg).find((r) => texts(r)[0] === 'Average award')
    expect(texts(row)).toEqual(['Average award', '$2,744', '—', '$2,481', '—'])
  })

  it('draws no group rows under any other line (Camp awards)', () => {
    const labels = developmentRows(DEVELOPMENT).map((r) => texts(r)[0])
    expect(labels.filter((l) => l === 'Camp awards')).toHaveLength(1)
    expect(labels.indexOf('Camp awards') + 1).toBe(labels.indexOf('Incentive awards'))
  })

  it('reads a kind-limited line "label, Pool A", each distinct definition its own note', () => {
    const { rows, notes } = developmentTable(DEVELOPMENT)
    const row = (label: string) => rows.find((r) => texts(r)[0] === label)
    expect(texts(row('% of need met, Pool A'))).toEqual([
      '% of need met, Pool A',
      '—',
      '76.5%',
      '61.2%',
      '54.0%',
    ])
    const noteOf = (label: string) => notes.find((n) => n.n === row(label)?.ref)?.text
    expect(noteOf('First-time, Pool A')).toBe(
      'No summer session at camp in any earlier season from 2017'
    )
    expect(noteOf('First-time, Pool B')).toBe('No family camp in any earlier season')
  })

  it('never lists one definition twice: rows with the same words share one note number', () => {
    const same = {
      ...DEVELOPMENT,
      rows: DEVELOPMENT.rows.map((r) =>
        r.key === 'first_time' ? { ...r, definition: 'Same words' } : r
      ),
    }
    const { rows, notes } = developmentTable(same)
    const refs = rows.filter((r) => texts(r)[0]?.startsWith('First-time')).map((r) => r.ref)
    expect(refs[0]).toBeDefined()
    expect(refs).toEqual([refs[0], refs[0]])
    expect(notes.filter((n) => n.text === 'Same words')).toHaveLength(1)
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

  it('heads each column as the mock does: as reported, live as of the day, or as of a day; a contested basis marked', () => {
    expect(DEVELOPMENT.columns.map((c) => columnHeader(c, DEVELOPMENT))).toEqual([
      '2025 · as reported · basis unconfirmed',
      '2026 · as reported',
      '2027 · live · as of Jun 3',
      '2027 as of Mar 9',
    ])
    const closed = { ...DEVELOPMENT.columns[2]!, season: 2026, label: '2026' }
    expect(columnHeader(closed, DEVELOPMENT)).toBe('2026 · closed · reproduced')
    expect(unconfirmedWords(DEVELOPMENT)).toContain('Basis unconfirmed: 2025 (as reported).')
  })

  it("counts a dated column's lines as they render: every row that reads — in that column (final audit O10)", () => {
    const rows = developmentRows(DEVELOPMENT)
    const blank = rows.filter((r) => r.kind === 'body' && texts(r)[4] === '—').length
    expect(blank).toBeGreaterThan(1)
    expect(notRebuiltColumnWords(DEVELOPMENT, rows)).toContain(
      `2027 as of Mar 9 (${String(blank)} lines)`
    )
  })

  it("names the rebuild's reason in the server's words", () => {
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

  it('states the facts in muted words: who paid, incentive or need-based, and its group, or “needs a group”', () => {
    expect(rows[at + 1]?.note).toBe('another funder · incentive · Pool A')
    expect(rows[at + 2]?.note).toBe('another funder · need-based · needs a group')
  })

  it('says “no funder yet” for a description no funder claims', () => {
    const unmapped = developmentRows({
      ...DEVELOPMENT_GRANTORS,
      sources: [
        {
          ...DEVELOPMENT_GRANTORS.sources[1]!,
          source_key: 'unmapped_award',
          name: 'Unmapped Award',
        },
      ],
    })
    const i = unmapped.findIndex((r) => texts(r)[0] === 'Outside grants')
    expect(unmapped[i + 1]?.note).toBe('another funder · incentive · Pool A · no funder yet')
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

  it('links each funder line to Money › Funders when given the link: its funder, or "No funder yet"', () => {
    const href = (params: Readonly<Record<string, string>>) =>
      `/aid/money/funders?${new URLSearchParams(params).toString()}`
    const linked = developmentRows(
      {
        ...DEVELOPMENT_GRANTORS,
        sources: [
          ...DEVELOPMENT_GRANTORS.sources,
          {
            ...(DEVELOPMENT_GRANTORS.sources.find((s) => s.name === 'Grantor B') ??
              DEVELOPMENT_GRANTORS.sources[0]!),
            source_key: 'unmapped_award_2027',
            name: 'Unmapped Award 2027',
          },
        ],
      },
      href
    )
    const i = linked.findIndex((r) => texts(r)[0] === 'Outside grants')
    expect(linked[i + 1]?.links).toEqual({ 0: '/aid/money/funders?funder=grantor_a' })
    expect(linked[i + 2]?.links).toEqual({ 0: '/aid/money/funders?funder=grantor_b' })
    expect(linked[i + 3]?.links).toEqual({ 0: '/aid/money/funders?show=no-funder' })
    // without a link (a user who can't open Funders) the lines are plain words
    expect(rows[at + 1]?.links).toBeUndefined()
  })

  it('carries the lines into the CSV', () => {
    const csv = csvLines(
      {
        title: 'Development report',
        season: 2027,
        figuresOn: '2027-06-03',
        live: true,
        basis: 'mixed',
      },
      developmentColumns(DEVELOPMENT_GRANTORS),
      rows,
      '/x'
    )
    // final audit E3: the CSV keeps each funder line's facts, so two lines of one funder stay apart
    expect(csv.some((line) => line[0] === 'Grantor A (another funder · incentive · Pool A)')).toBe(
      true
    )
    expect(
      csv.some((line) => line[0] === 'Grantor B (another funder · need-based · needs a group)')
    ).toBe(true)
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
    const columns = developmentColumns(DEVELOPMENT, MARCH)
    const headers = columns.map((c) => c.header)
    expect(headers[4]).toBe(`2027 as of Mar 9${tag}`)
    // the mock's amber tint on the temporary column, and on no other
    expect(columns.map((c) => c.tone)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'decided',
    ])
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

describe('the capped-requests line (Rule M)', () => {
  const withCapped = (counts: Array<number | undefined>) => ({
    ...DEVELOPMENT,
    columns: DEVELOPMENT.columns.map((c, i) => {
      const n = counts[i]
      const copy = { ...c }
      if (n === undefined) delete copy.requests_capped
      else copy.requests_capped = n
      return copy
    }),
  })

  it('says one request above its session’s cost counted at the cost, for the column that has one', () => {
    expect(cappedWords(DEVELOPMENT)).toBe(
      "Total Requests and % of need met: 1 request above its session's cost counted at the cost (2027)."
    )
  })

  it('says requests and their, in the plural', () => {
    expect(cappedWords(withCapped([0, 0, 3, 0]))).toBe(
      "Total Requests and % of need met: 3 requests above their session's cost counted at the cost (2027)."
    )
  })

  it('gives one clause per column, in column order, with one prefix and one final period', () => {
    expect(cappedWords(withCapped([0, 0, 3, 1]))).toBe(
      "Total Requests and % of need met: 3 requests above their session's cost counted at the cost (2027); 1 request above its session's cost counted at the cost (2027 as of Mar 9)."
    )
  })

  it('is null when every column is 0 or missing', () => {
    expect(cappedWords(withCapped([0, 0, 0, 0]))).toBeNull()
    expect(cappedWords(withCapped([undefined, undefined, undefined, undefined]))).toBeNull()
  })
})
