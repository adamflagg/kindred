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
  asOfChipWords,
  cappedWords,
  columnHead,
  developmentTable,
  datedSeasons,
  dayBefore,
  developmentColumns,
  developmentRows,
  funderFacts,
  rebuildReason,
  SECTION_DESCRIPTIONS,
  SUB_LINES,
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

  it('has no Group column: the header is Metric and the season columns, short and one line (final mock)', () => {
    expect(developmentColumns(DEVELOPMENT).map((c) => c.header)).toEqual([
      'Metric',
      '2025',
      '2026',
      '2027',
      '2027',
    ])
  })

  const REGISTRY = [
    { key: 'dev_budget', text: 'Budget: the first board-passed.' },
    { key: 'need', text: 'Need and Total Requests: the asks.' },
    { key: 'total_awards_granted', text: 'Total Awards Granted: all money.' },
    { key: 'dev_recipients', text: 'Who counts: attended and got money.' },
    { key: 'first_time', text: 'First-time: no earlier session.' },
    { key: 'basis_unconfirmed', text: 'As reported: typed once.' },
  ]

  it('draws a line with an every-group row once, its note a superscript number from the registry, never in the row', () => {
    const { rows, notes } = developmentTable(DEVELOPMENT, { registry: REGISTRY })
    expect(texts(rows[1])).toEqual([
      'Total Awards Granted',
      '$900,000',
      '$930,000',
      '$2,500',
      '$1,800',
    ])
    expect(rows.every((r) => r.note === undefined)).toBe(true)
    // the server's own definition text no longer numbers a row: the six registry notes do (final mock)
    expect(rows[1]?.ref).toBe(3)
    expect(notes).toEqual(REGISTRY.map((r, i) => ({ n: i + 1, text: r.text })))
    // A registry note that carries its term passes it on, so the notes set it bold.
    const termed = developmentTable(DEVELOPMENT, {
      registry: [{ key: 'dev_budget', term: 'Budget', text: 'Budget: the first board-passed.' }],
    })
    expect(termed.notes).toEqual([
      { n: 1, term: 'Budget', text: 'Budget: the first board-passed.' },
    ])
    expect(rows.filter((r) => texts(r)[0] === 'Recipients')).toHaveLength(1)
    expect(rows.find((r) => texts(r)[0] === 'Recipients')?.ref).toBe(4)
    expect(rows.find((r) => texts(r)[0] === 'Pool A campers')?.ref).toBeUndefined()
  })

  it('numbers by the registry order, not by the order the rows call for the notes: six, fixed', () => {
    const { rows } = developmentTable(DEVELOPMENT, { registry: REGISTRY })
    const ref = (label: string) => rows.find((r) => texts(r)[0] === label)?.ref
    expect(ref('% of need met, Pool A')).toBe(2)
    expect(ref('First-time, Pool A')).toBe(5)
    expect(ref('First-time, Pool B')).toBe(5)
    expect(ref('Declined enrollment for insufficient aid')).toBe(5)
    expect(ref('Gender, campers who got money: girl, Pool A')).toBe(4)
    expect(ref('Camp awards')).toBeUndefined()
  })

  it('marks Budget¹, requests and need², Total/outside/Grants/Average³, who counts⁴ and first-time/appeals⁵ (the mock)', () => {
    const budget = { ...DEVELOPMENT_LIVE, rows: [...DEVELOPMENT_LIVE.rows, BUDGET_ROW] }
    const extra = (key: string, section: 'money' | 'counts' | 'appeals') => ({
      ...DEVELOPMENT.rows[0]!,
      key,
      section,
      label: key,
      group: null,
    })
    const keys: Array<[string, 'money' | 'counts' | 'appeals', number | undefined]> = [
      ['budget', 'money', 1],
      ['total_requests', 'money', 2],
      ['need_met', 'money', 2],
      ['total_awards', 'money', 3],
      ['outside_awards', 'money', 3],
      ['awards', 'money', 3],
      ['average_award', 'money', 3],
      ['camp_awards', 'money', undefined],
      ['recipients', 'counts', 4],
      ['families', 'counts', 4],
      ['shared_households', 'counts', undefined],
      ['teens', 'counts', 4],
      ['youth', 'counts', 4],
      ['adults', 'counts', undefined],
      ['teen_programs', 'counts', undefined],
      ['gender_recipients', 'counts', 4],
      ['gender_enrolled', 'counts', 4],
      ['household_level_lines', 'counts', 4],
      ['household_level_amount', 'counts', 4],
      ['first_time', 'counts', 5],
      ['returning', 'counts', 5],
      ['appeals_submitted', 'appeals', 5],
      ['appeals_in_full', 'appeals', 5],
      ['appeals_in_part', 'appeals', 5],
      ['appeals_approved', 'appeals', 5],
      ['declined_insufficient', 'appeals', 5],
      ['cancelled_medical', 'appeals', undefined],
    ]
    const dev = {
      ...budget,
      rows: keys.map(([key, section]) => extra(key, section)),
    }
    const { rows } = developmentTable(dev, { registry: REGISTRY })
    const got = Object.fromEntries(
      rows.filter((r) => r.kind === 'body').map((r) => [texts(r)[0], r.ref])
    )
    for (const [key, , n] of keys) expect(got[key], key).toBe(n)
  })

  it('draws no numbers, and lists no notes, while the registry has not loaded', () => {
    const { rows, notes } = developmentTable(DEVELOPMENT)
    expect(rows.every((r) => r.ref === undefined)).toBe(true)
    expect(notes).toEqual([])
  })

  it('describes each section after its name, as the mock does', () => {
    expect(SECTION_DESCRIPTIONS).toEqual({
      money: "all money: the camp's awards and every outside grant",
      counts:
        'campers who attended and got money from any source, once per program; Weekend counts families',
      appeals: "the camp's own requests",
    })
    const heads = developmentRows(DEVELOPMENT).filter((r) => r.kind === 'heading')
    expect(heads.map((r) => r.meta)).toEqual(Object.values(SECTION_DESCRIPTIONS))
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

  it('reads a kind-limited line "label, Pool A"', () => {
    const { rows } = developmentTable(DEVELOPMENT)
    const row = rows.find((r) => texts(r)[0] === '% of need met, Pool A')
    expect(texts(row)).toEqual(['% of need met, Pool A', '—', '76.5%', '61.2%', '54.0%'])
  })

  it('indents the sub-lines as the mock does (SUB_LINES); gender and cancel-reason rows sit flush', () => {
    expect(SUB_LINES['camp_awards']).toBe(1)
    expect(SUB_LINES['incentive_awards']).toBe(2)
    const rows = developmentRows(DEVELOPMENT)
    const indentOf = (label: string) => rows.find((r) => texts(r)[0] === label)?.indent
    expect(indentOf('Camp awards')).toBe(1)
    expect(indentOf('Incentive awards')).toBe(2)
    expect(indentOf('Total Awards Granted')).toBe(0)
    // final mock critic pass: flush, so they no longer read as children of the row above
    expect(indentOf('Cancelled after an award')).toBe(0)
    expect(indentOf('Gender, campers who got money: girl, Pool A')).toBe(0)
  })

  it('heads each column short and on one line, its long form in the title, its basis in the group (final mock)', () => {
    const heads = DEVELOPMENT.columns.map((c) => columnHead(c, DEVELOPMENT))
    expect(heads[0]).toEqual({
      header: '2025',
      title: '2025: as reported, typed once, read only (basis unconfirmed)',
    })
    expect(heads[1]).toEqual({
      header: '2026',
      title: '2026: as reported, the figures sent to funders',
    })
    expect(heads[2]).toEqual({
      header: '2027',
      sub: 'live · Jun 3',
      title: "2027, live: the dashboard's decisions as of Jun 3",
    })
    expect(heads[3]?.header).toBe('2027')
    expect(heads[3]?.sub).toBe('as of Mar 9')
    const closed = { ...DEVELOPMENT.columns[2]!, season: 2026, label: '2026' }
    expect(columnHead(closed, DEVELOPMENT)).toEqual({
      header: '2026',
      sub: 'closed',
      title: "2026, closed: reproduced by the dashboard from finance's repaired sheet",
    })
  })

  it('groups the columns As reported (note 6 on the first) and The dashboard (a stronger rule before it)', () => {
    const closed = { ...DEVELOPMENT.columns[2]!, season: 2026, label: '2026' }
    const dev = {
      ...DEVELOPMENT_LIVE,
      columns: [...DEVELOPMENT_LIVE.columns.slice(0, 2), closed, DEVELOPMENT_LIVE.columns[2]!],
    }
    const cols = developmentColumns(dev, null, { asReportedNote: 6 })
    expect(cols.map((c) => c.group)).toEqual([
      undefined,
      'As reported',
      'As reported',
      'The dashboard',
      'The dashboard',
    ])
    expect(cols.map((c) => c.groupNote)).toEqual([undefined, 6, undefined, undefined, undefined])
    expect(cols.map((c) => c.divider)).toEqual([
      undefined,
      undefined,
      undefined,
      'before',
      undefined,
    ])
    expect(cols.slice(1).every((c) => c.width !== undefined)).toBe(true)
    expect(cols[3]?.sub).toBe('closed')
    // without the registry's note there is no mark pointing at nothing
    expect(developmentColumns(dev)[1]?.groupNote).toBeUndefined()
  })

  it("names the rebuild's reason in the server's words", () => {
    expect(rebuildReason(DEVELOPMENT)).toContain('waits on the 2017–2024 ledger backfill')
  })
})

describe('the grantor lines (D3)', () => {
  const rows = developmentRows(DEVELOPMENT_GRANTORS)
  const at = rows.findIndex((r) => texts(r)[0] === 'Outside grants')
  const [first, second] = DEVELOPMENT_GRANTORS.sources.filter(
    (s) => s.who_paid === 'another funder'
  )

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

  it('states the facts on the line itself: incentive or need-based, the pool by short name, or “needs a group”', () => {
    expect(funderFacts(first!)).toEqual({
      kind: 'incentive',
      pool: { short: 'Pool A', full: 'Pool A' },
      noFunder: false,
    })
    expect(funderFacts(second!)).toEqual({ kind: 'need-based', pool: null, noFunder: false })
    // the short name is the program's own: Camp & Quest reads C&Q, Weekend Programs reads Weekend
    expect(
      funderFacts({ ...first!, group: 'camp_quest', group_label: 'Camp & Quest' }).pool
    ).toEqual({ short: 'C&Q', full: 'Camp & Quest' })
    expect(
      funderFacts({ ...first!, group: 'weekend', group_label: 'Weekend Programs' }).pool?.short
    ).toBe('Weekend')
  })

  it('says “no funder yet” for a description no funder claims', () => {
    const unmapped = { ...first!, source_key: 'unmapped_award', name: 'Unmapped Award' }
    expect(funderFacts(unmapped).noFunder).toBe(true)
    expect(funderFacts(first!).noFunder).toBe(false)
  })

  it('titles the cell with the name, every fact, and where it opens; “another funder” rides there', () => {
    const href = (params: Readonly<Record<string, string>>) =>
      `/aid/money/funders?${new URLSearchParams(params).toString()}`
    const linked = developmentRows(DEVELOPMENT_GRANTORS, href)
    expect(linked[at + 1]?.cells[0]).toMatchObject({
      title: 'Grantor A (another funder · incentive · Pool A) · opens Money › Funders',
    })
    expect(linked[at + 2]?.cells[0]).toMatchObject({
      title: 'Grantor B (another funder · need-based · needs a group) · opens Money › Funders',
    })
    // a user who can't open Funders: the same words, without the destination
    expect(rows[at + 1]?.cells[0]).toMatchObject({
      title: 'Grantor A (another funder · incentive · Pool A)',
    })
    expect(rows[at + 1]?.note).toBeUndefined()
  })

  it('draws the cell as the name with its facts at the right (a display), and “no funder yet” in the title', () => {
    expect(rows[at + 1]?.cells[0]?.display).toBeDefined()
    const unmapped = developmentRows({
      ...DEVELOPMENT_GRANTORS,
      sources: [{ ...first!, source_key: 'unmapped_award', name: 'Unmapped Award' }],
    })
    const i = unmapped.findIndex((r) => texts(r)[0] === 'Outside grants')
    expect(unmapped[i + 1]?.cells[0]?.title).toBe(
      'Unmapped Award (another funder · incentive · Pool A · no funder yet)'
    )
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
          { ...second!, source_key: 'unmapped_award_2027', name: 'Unmapped Award 2027' },
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

  it('carries each funder line’s facts into the CSV, so two lines of one funder stay apart', () => {
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

  it('draws the column asked for as 2027 with “Mar 9 · not saved” under it, tinted, and no other column so', () => {
    const columns = developmentColumns(DEVELOPMENT, MARCH)
    expect(columns[4]).toMatchObject({
      header: '2027',
      sub: 'Mar 9 · not saved',
      tone: 'decided',
      group: 'The dashboard',
    })
    expect(columns[4]?.title).toContain('recomputed from dated records for you only, never saved')
    expect(columns[4]?.title).toContain('reads "—", never an estimate')
    expect(columns.map((c) => c.tone)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      'decided',
    ])
    expect(developmentColumns(DEVELOPMENT).some((c) => c.sub?.includes('not saved'))).toBe(false)
    expect(
      developmentColumns(DEVELOPMENT, { season: 2027, day: '2027-04-12' }).some((c) =>
        c.sub?.includes('not saved')
      )
    ).toBe(false)
  })

  it('words the chip “2027 as of Mar 9 · not saved”', () => {
    expect(asOfChipWords(MARCH)).toBe('2027 as of Mar 9 · not saved')
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
