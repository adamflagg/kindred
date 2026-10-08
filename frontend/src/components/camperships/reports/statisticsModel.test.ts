/** Statistics' tables in words (spec §9.2, §9.7; D80, D130, D157; RPT-10, 22, 9, 23; slice 4 J, K, L). */
import { describe, expect, it } from 'vitest'

import { reportText } from '../kit/report'
import { parseReportParam, reportParam, type ReportAddress } from '../requests/reportFilter'
import { readStatisticsChoice } from './reportParams'
import {
  STATISTICS,
  STATISTICS_ALL_TABLES,
  STATISTICS_DECIDED,
  STATISTICS_PAST,
  STATISTICS_THROUGH,
} from './statisticsFixtures'
import {
  asOfWords,
  cancelledApplicantsLink,
  cancelledColumns,
  cancelledRows,
  notRebuiltWords,
  outcomeRows,
  requestSetWords,
  statisticsCsvName,
  statisticsHeading,
  statisticsLinkParams,
  tableLabel,
  tierAppealsRows,
  tierColumns,
  tierRows,
} from './statisticsModel'

const noNotes = () => null
const texts = (cells: ReadonlyArray<Parameters<typeof reportText>[0]>) => cells.map(reportText)
const CAMP_R1 = readStatisticsChoice(new URLSearchParams('table=camp'))
/** The link a count opens: the grid's `?report=` value, so a test reads the address back. */
const linkOf = (address: ReportAddress) => reportParam(address)
const addressOf = (href: string | undefined) => parseReportParam(href ?? null)?.query

describe('the tier table', () => {
  it("draws each tier and the server's total, as sent (D21)", () => {
    const rows = tierRows(STATISTICS, CAMP_R1, linkOf)
    expect(rows.map((r) => r.kind)).toEqual(['body', 'body', 'total'])
    expect(texts(rows[0]?.cells ?? [])).toEqual([
      '1',
      '$0',
      '$40,000',
      '90.0%',
      '12',
      '$36,000',
      '12',
      '$3,000',
      '$27,000',
      '$2,700',
      '10',
      '$33,000',
      '81.8%',
      '86.4%',
    ])
    expect(texts(rows[2]?.cells ?? []).slice(0, 5)).toEqual(['Table A · Round 1', '', '', '', '16'])
  })

  it('says "and up" for the top tier and "varies" for the fee % on All award tables (RPT-10)', () => {
    expect(texts(tierRows(STATISTICS, CAMP_R1, linkOf)[1]?.cells ?? [])[2]).toBe('and up')
    const all = tierRows(STATISTICS_ALL_TABLES, CAMP_R1, linkOf)
    expect(texts(all[0]?.cells ?? [])[3]).toBe('varies')
    expect(texts(all[2]?.cells ?? [])[0]).toBe('All award tables · Round 1')
  })

  it('reads "—" for the fee % on All award tables in Round 3, which has no table value', () => {
    const round3 = tierRows({ ...STATISTICS_ALL_TABLES, round: 3 }, CAMP_R1, linkOf)
    expect(texts(round3[0]?.cells ?? [])[3]).toBe('—')
  })

  it("shows % of ask's denominator, the live in-budget asks, right before it and apart from Asked (owner B4a (c))", () => {
    const keys = tierColumns(STATISTICS, noNotes).map((c) => c.key)
    expect(keys.indexOf('liveAsked')).toBe(keys.indexOf('pct') - 1)
    expect(tierColumns(STATISTICS, noNotes)[keys.indexOf('liveAsked')]?.header).toBe(
      'Asked (live, in budget)'
    )
    const cells = texts(tierRows(STATISTICS, CAMP_R1, linkOf)[0]?.cells ?? [])
    expect(cells[keys.indexOf('asked')]).toBe('$36,000')
    expect(cells[keys.indexOf('liveAsked')]).toBe('$33,000')
  })

  it('shows Awarded as Posted alone beside an amber Decided on the decided basis, never their sum (K; D130)', () => {
    const columns = tierColumns(STATISTICS_DECIDED, noNotes)
    const keys = columns.map((c) => c.key)
    const headers = columns.map((c) => c.header)
    expect(headers).toContain('Awarded')
    expect(headers).toContain('Decided (not yet offered)')
    expect(headers).not.toContain('Posted + decided')
    // amber, as the mock draws it: the kit tints the column (ReportTable)
    expect(columns.find((c) => c.key === 'decided')?.tone).toBe('decided')
    const cells = texts(tierRows(STATISTICS_DECIDED, CAMP_R1, linkOf)[0]?.cells ?? [])
    // TIER_1's amount is 30,000 on this basis: Awarded reads the read's `awarded`, 27,000
    expect(cells[keys.indexOf('awarded')]).toBe('$27,000')
    expect(cells[keys.indexOf('decided')]).toBe('$3,000')
    expect(tierColumns(STATISTICS, noNotes).map((c) => c.key)).not.toContain('decided')
  })

  it("heads both % columns with the server's labels, which name the decided numerator (owner B4a (b))", () => {
    const header = (stats: typeof STATISTICS, key: string) =>
      tierColumns(stats, noNotes).find((c) => c.key === key)?.header
    expect(header(STATISTICS, 'pct')).toBe('% of ask')
    expect(header(STATISTICS_DECIDED, 'pct')).toBe('% of ask (posted + decided)')
    expect(header(STATISTICS_DECIDED, 'pctGrants')).toBe('% of ask incl. grants (posted + decided)')
  })

  it('heads the award count "Awards (camp aid)", apart from Development\'s every-source count (L)', () => {
    expect(tierColumns(STATISTICS, noNotes).find((c) => c.key === 'awards')?.header).toBe(
      'Awards (camp aid)'
    )
  })

  it("puts the registry's note numbers on their columns", () => {
    const notes: Record<string, number> = { apps: 1, awarded: 3, average_award: 4, pct_of_ask: 5 }
    const columns = tierColumns(STATISTICS, (key) => notes[key] ?? null)
    expect(columns.find((c) => c.key === 'apps')?.note).toBe(1)
    expect(columns.find((c) => c.key === 'pct')?.note).toBe(5)
  })
})

describe('every count opens the requests behind it (slice 4 J; D20)', () => {
  const keys = tierColumns(STATISTICS, noNotes).map((c) => c.key)

  it("links a tier's Apps, Asks and Awards on the read's own choices", () => {
    const [tier1] = tierRows(STATISTICS, CAMP_R1, linkOf)
    expect(addressOf(tier1?.links?.[keys.indexOf('apps')])).toEqual({
      part: 'tier',
      table: 'camp',
      round: '1',
      tier: '1',
      count: 'apps',
    })
    expect(addressOf(tier1?.links?.[keys.indexOf('awards')])).toMatchObject({ count: 'awarded' })
    expect(tier1?.links?.[keys.indexOf('awarded')]).toBeUndefined() // money never links
  })

  it('links the "no tier" row with no tier and the total as the total', () => {
    const noTier = tierRows(
      { ...STATISTICS, rows: [{ ...STATISTICS.rows[0]!, tier: null }] },
      CAMP_R1,
      linkOf
    )
    expect(addressOf(noTier[0]?.links?.[keys.indexOf('apps')])).not.toHaveProperty('tier')
    expect(addressOf(noTier[1]?.links?.[keys.indexOf('asks')])).toMatchObject({
      part: 'total',
      count: 'asks',
    })
  })

  it('carries a reporting control and the decided basis into the address, so the ids match the figure', () => {
    const choice = readStatisticsChoice(new URLSearchParams('decided=1&through=deadline'))
    const [tier1] = tierRows(STATISTICS_DECIDED, choice, linkOf)
    expect(addressOf(tier1?.links?.[4])).toMatchObject({
      basis: 'posted_and_decided',
      through_round1_deadline: 'true',
    })
  })

  it('links the cancelled applicants to the total’s cancelled count', () => {
    expect(addressOf(cancelledApplicantsLink(CAMP_R1, linkOf))).toEqual({
      part: 'total',
      table: 'camp',
      round: '1',
      count: 'cancelled',
    })
  })
})

describe('RPT-22, RPT-9 and RPT-23', () => {
  it("names each cancellation's reason and pool in the server's words (#2974)", () => {
    expect(cancelledRows(STATISTICS, CAMP_R1, linkOf).map((r) => texts(r.cells))).toEqual([
      ['Medical', 'Pool A', 'Round 1', '2', '$3,400'],
      ['Withdrawn in the dashboard', 'Pool B', 'Round 1', '1', '$700'],
      ['Duplicate', 'Pool A', 'Round 1', '1', '$500'],
      ['no reason recorded', 'No pool', 'Round 2', '1', '$300'],
    ])
  })

  it('draws the reason, pool and round as words, left-aligned as the mock', () => {
    expect(
      cancelledColumns(() => null)
        .filter((c) => c.align === 'left')
        .map((c) => c.key)
    ).toEqual(['pool', 'round'])
  })

  it("opens a cancellation row's requests by reason, round and pool, and no pool by leaving it out", () => {
    const rows = cancelledRows(STATISTICS, CAMP_R1, linkOf)
    expect(addressOf(rows[0]?.links?.[3])).toMatchObject({
      part: 'cancelled',
      reason: 'medical',
      posted_round: '1',
      pool: 'pool_a',
    })
    expect(addressOf(rows[3]?.links?.[3])).not.toHaveProperty('pool')
  })

  it('draws RPT-9 with its rules value and its derived rate as sent, opening nothing', () => {
    const [row] = tierAppealsRows(STATISTICS)
    expect(texts(row?.cells ?? [])).toEqual([
      '1',
      '$0',
      '$40,000',
      '12',
      '90.0%',
      '4',
      '95.0%',
      '$600',
      '33.3%',
    ])
    expect(row?.links).toBeUndefined()
  })

  it('draws RPT-9\'s last row as the server\'s totals, never a second "No tier" row', () => {
    const rows = tierAppealsRows(STATISTICS)
    const total = rows.at(-1)
    expect(total?.kind).toBe('total')
    // the chip's table, as the tier table's totals row names it
    expect(texts(total?.cells ?? [])).toEqual([
      'Table A',
      '',
      '',
      '12',
      '',
      '4',
      '',
      '$600',
      '33.3%',
    ])
    expect(rows.filter((r) => r.kind === 'body')).toHaveLength(1)
  })

  it("marks the headline by the server's kind, never by its place, and links every outcome (#2972)", () => {
    const NO_POOL = {
      ...STATISTICS,
      outcomes: [
        { ...STATISTICS.outcomes[2]!, kind: 'headline' as const },
        { ...STATISTICS.outcomes[0]!, pool: null, kind: 'no_pool' as const, pool_label: 'No pool' },
      ],
    }
    const rows = outcomeRows(NO_POOL, CAMP_R1, linkOf)
    expect(rows.map((r) => [texts(r.cells)[0], r.kind])).toEqual([
      ['All pools', 'total'],
      ['No pool', 'body'],
    ])
    expect(addressOf(rows[1]?.links?.[5])).toMatchObject({
      part: 'outcome',
      outcome_row: 'no_pool',
      outcome: 'waiting',
    })
    expect(addressOf(rows[1]?.links?.[5])).not.toHaveProperty('pool')
  })

  it("opens a pool row's Accepted on that pool, and keeps the outcomes under a reporting control", () => {
    const rows = outcomeRows(
      STATISTICS_THROUGH,
      readStatisticsChoice(new URLSearchParams('through=2027-02-01')),
      linkOf
    )
    expect(addressOf(rows[0]?.links?.[1])).toEqual({
      part: 'outcome',
      round: '1',
      received_through: '2027-02-01',
      outcome_row: 'pool',
      pool: 'pool_a',
      outcome: 'accepted',
    })
  })
})

describe('what the page says around it', () => {
  it('names the table the server answered by its label from the rules', () => {
    expect(tableLabel(STATISTICS)).toBe('Table A')
    expect(tableLabel(STATISTICS_ALL_TABLES)).toBe('All award tables')
  })

  it('labels every figure with the request set when a control is on (D138)', () => {
    expect(requestSetWords(STATISTICS)).toBeNull()
    expect(requestSetWords(STATISTICS_THROUGH)).toBe(
      'Every figure below counts only requests received through Feb 1, 2027: 4 later requests left out, and 1 with no received date.'
    )
  })

  it('says a past date never estimates, without the developer-facing reasons (D154)', () => {
    expect(notRebuiltWords(STATISTICS)).toBeNull()
    expect(notRebuiltWords(STATISTICS_PAST)).toContain('never an estimate')
    expect(notRebuiltWords(STATISTICS_PAST)).toContain('the dashboard')
  })

  it('heads a copy with the basis, and the decided basis says it moves (RPT-33; D130)', () => {
    expect(statisticsHeading(STATISTICS, 'By tier').basis).toBe('P (awarded = Posted)')
    expect(statisticsHeading(STATISTICS_DECIDED, 'By tier').basis).toContain('moves until posted')
    expect(statisticsHeading(STATISTICS_PAST, 'By tier').live).toBe(false)
    // RPT-22, RPT-9 and RPT-23 hold no decided money: Posted on either switch
    expect(statisticsHeading(STATISTICS_DECIDED, 'RPT-22', false).basis).toBe(
      'P (awarded = Posted)'
    )
  })

  it('names the day and the rules version beside the controls', () => {
    expect(asOfWords('2027-04-10', true, 3)).toBe('As of Apr 10, 2027 (live) · rules v3')
    expect(asOfWords('2027-03-08', false, null)).toBe('As of Mar 8, 2027 · no approved rules')
  })
})

describe('the link and the file', () => {
  const choice = readStatisticsChoice(
    new URLSearchParams('table=camp&round=all&decided=1&through=deadline')
  )

  it('reproduces the view (D15), leaving the defaults out', () => {
    expect(statisticsLinkParams(choice)).toEqual({
      table: 'camp',
      round: 'all',
      decided: '1',
      through: 'deadline',
    })
    expect(statisticsLinkParams(readStatisticsChoice(new URLSearchParams('')))).toEqual({})
  })

  it('names the file as D70 does, with the season and a past date', () => {
    expect(
      statisticsCsvName(
        { year: 2027, asOf: { kind: 'past', date: '2027-03-08', axis: 'campminder' } },
        choice,
        'by-tier'
      )
    ).toBe(
      'camperships-reports-statistics-by-tier-camp-all-rounds-decided-through-deadline-2027-as-of-2027-03-08.csv'
    )
  })
})
