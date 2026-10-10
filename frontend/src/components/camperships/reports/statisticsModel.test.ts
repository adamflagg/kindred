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
  cancelledApplicantsLink,
  cancelledColumns,
  cancelledRows,
  notRebuiltWords,
  outcomeRows,
  OUTCOME_COLUMNS,
  requestSetLeftOut,
  tierAppealsColumns,
  statisticsCsvName,
  statisticsHeading,
  statisticsLinkParams,
  tableLabel,
  tableShortLabel,
  tierAppealsRows,
  tierColumns,
  tierRows,
  cappedAskWords,
  ROUND_CHIPS_NOTE,
  tierNotes,
} from './statisticsModel'
import { copyText, csvLines } from '../kit/report'

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
      '$36,000', // Asked (as typed), owner A3 (2026-10-09)
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

  // Approved final mock reports-statistics.html (By tier): the total's label spans Tier..Eligible fee %,
  // carries the P pill at its right end (the table has no heading row), and says what it is in its title.
  it('spans the total label over four columns with the P badge, and titles it with its pooled-ratio note', () => {
    const total = tierRows(STATISTICS, CAMP_R1, linkOf)[2]!
    expect(total.span).toBe(4)
    expect(total.badge).toBe('P')
    expect(total.cells[0]?.title).toBe(
      'Table A · Round 1 · subtotals and this total are pooled ratios, not averages of the rows'
    )
  })

  it("adds the request set's words to the total label when one is on, and what it counts to its title", () => {
    const choice = readStatisticsChoice(new URLSearchParams('table=camp&through=2027-02-01'))
    const total = tierRows(STATISTICS_THROUGH, choice, linkOf).at(-1)!
    expect(reportText(total.cells[0]!)).toBe('Table A · Round 1 · received through Feb 1, 2027')
    expect(total.cells[0]?.title).toContain(
      'Table A · Round 1: counts only requests received through Feb 1, 2027'
    )
  })

  it('marks "No tier" an end row', () => {
    const rows = tierRows(
      { ...STATISTICS, rows: [{ ...STATISTICS.rows[0]!, tier: null }] },
      CAMP_R1,
      linkOf
    )
    expect(rows[0]?.kind).toBe('end')
  })

  it('says "and up" for the top tier and "varies" for the fee % on All award tables (RPT-10)', () => {
    expect(texts(tierRows(STATISTICS, CAMP_R1, linkOf)[1]?.cells ?? [])[2]).toBe('and up')
    const all = tierRows(STATISTICS_ALL_TABLES, CAMP_R1, linkOf)
    expect(texts(all[0]?.cells ?? [])[3]).toBe('varies')
    expect(texts(all[2]?.cells ?? [])[0]).toBe('All award tables · Round 1')
    // quieter than a figure, and it says what to do about it (mock)
    expect(all[0]?.cells[3]).toMatchObject({
      muted: true,
      title: 'Each award table sets its own fee share: pick one to see it',
    })
  })

  it('reads "—" for the fee % on All award tables in Round 3, which has no table value', () => {
    const round3 = tierRows({ ...STATISTICS_ALL_TABLES, round: 3 }, CAMP_R1, linkOf)
    expect(texts(round3[0]?.cells ?? [])[3]).toBe('—')
  })

  it("shows % of ask's denominator, the live in-budget asks, right before it and apart from Asked (owner B4a (c))", () => {
    const keys = tierColumns(STATISTICS, noNotes).map((c) => c.key)
    expect(keys.indexOf('liveAsked')).toBe(keys.indexOf('pct') - 1)
    const live = tierColumns(STATISTICS, noNotes)[keys.indexOf('liveAsked')]
    expect(live?.header).toBe('In-budget ask')
    expect(live?.title).toBe(
      "Asked (live, in budget): each round's ask as it stands today, on live requests"
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
    expect(headers).toContain('Decided')
    expect(headers).not.toContain('Posted + decided')
    // amber ink alone, as the approved final mock draws it (.cf-dec): the kit colours the column
    expect(columns.find((c) => c.key === 'decided')?.tone).toBe('decided-ink')
    const cells = texts(tierRows(STATISTICS_DECIDED, CAMP_R1, linkOf)[0]?.cells ?? [])
    // TIER_1's amount is 30,000 on this basis: Awarded reads the read's `awarded`, 27,000
    expect(cells[keys.indexOf('awarded')]).toBe('$27,000')
    expect(cells[keys.indexOf('decided')]).toBe('$3,000')
    expect(tierColumns(STATISTICS, noNotes).map((c) => c.key)).not.toContain('decided')
  })

  // Approved final mock: with Include not yet offered on, the two % headers turn amber instead of growing
  // words that would wrap the row; each title says "(posted + decided)" in full (owner B4a (b)).
  it('turns both % headers amber on the decided basis, their titles naming the decided numerator', () => {
    const column = (stats: typeof STATISTICS, key: string) =>
      tierColumns(stats, noNotes).find((c) => c.key === key)
    expect(column(STATISTICS, 'pct')).toMatchObject({ header: '% of ask', title: '% of ask' })
    expect(column(STATISTICS, 'pct')?.tone).toBeUndefined()
    expect(column(STATISTICS_DECIDED, 'pct')).toMatchObject({
      header: '% of ask',
      tone: 'decided-ink',
    })
    expect(column(STATISTICS_DECIDED, 'pct')?.title).toBe(
      '% of ask (posted + decided): amber while Include not yet offered is on'
    )
    expect(column(STATISTICS_DECIDED, 'pctGrants')).toMatchObject({
      header: '% incl. grants',
      tone: 'decided-ink',
    })
    expect(column(STATISTICS_DECIDED, 'pctGrants')?.title).toContain('(posted + decided)')
    expect(column(STATISTICS, 'pctGrants')?.title).toBe(
      '% of ask incl. grants. Round 1 and All rounds only: a grant belongs to the request, not a round.'
    )
  })

  it('sizes and titles the By tier columns as the mock does, one line each', () => {
    const columns = tierColumns(STATISTICS, noNotes)
    expect(columns.map((c) => [c.header, c.width ?? null])).toEqual([
      ['Tier', null],
      ['Income from', 98],
      ['Income to', 92],
      ['Eligible fee %', 106],
      ['Apps', 66],
      ['Asked', 92],
      ['Asked (as typed)', null], // owner A3 (2026-10-09): an export-only column beside the capped Asked
      ['Asks', 58],
      ['Avg ask', 78],
      ['Awarded', 94],
      ['Avg award', 90],
      ['Awards', 72],
      ['In-budget ask', 106],
      ['% of ask', 84],
      ['% incl. grants', 110],
    ])
    expect(columns.find((c) => c.key === 'fee')?.title).toBe(
      'The fee share this tier pays under the chosen award table; "varies" across tables'
    )
    // owner A3 (2026-10-09): Asked is capped, and its title says so
    expect(columns.find((c) => c.key === 'asked')?.title).toBe(
      "Every app's ask, cancelled and closed ones included, at most its session's cost (an appeal counts on top of the earlier awards, as Development's need)"
    )
    expect(columns.find((c) => c.key === 'asks')?.title).toBe('One per round asked')
    expect(columns.find((c) => c.key === 'apps')?.divider).toBe('before')
    expect(columns.find((c) => c.key === 'liveAsked')?.divider).toBe('before')
    expect(columns.some((c) => c.wrap)).toBe(false)
  })

  it('heads the award count "Awards", apart from Development\'s every-source count (L)', () => {
    expect(tierColumns(STATISTICS, noNotes).find((c) => c.key === 'awards')?.header).toBe('Awards')
  })

  // Approved final mock: the Awards figure is explained by the Awarded note (the footer is six notes).
  it('numbers the Awards column with the Awarded note, keeping the label', () => {
    const columns = tierColumns(STATISTICS, (key) => (key === 'awarded' ? 2 : null))
    const awards = columns.find((c) => c.key === 'awards')
    expect(awards?.header).toBe('Awards')
    expect(awards?.note).toBe(2)
  })

  it('draws the averages in whole dollars, the cents dropped (mock)', () => {
    const cents = {
      ...STATISTICS,
      rows: [{ ...STATISTICS.rows[0]!, average_ask: 2744.44, average_award: 1999.5 }],
    }
    const keys = tierColumns(cents, noNotes).map((c) => c.key)
    const cell = texts(tierRows(cents, CAMP_R1, linkOf)[0]?.cells ?? [])
    expect(cell[keys.indexOf('averageAsk')]).toBe('$2,744')
    expect(cell[keys.indexOf('averageAward')]).toBe('$2,000')
  })

  it("puts the registry's note numbers on their columns, the % columns on % of ask's", () => {
    const notes: Record<string, number> = {
      apps: 1,
      awarded: 2,
      average_award: 3,
      pct_of_ask: 4,
      decided_not_offered: 6,
    }
    const columns = tierColumns(STATISTICS_DECIDED, (key) => notes[key] ?? null)
    const noteOf = (key: string) => columns.find((c) => c.key === key)?.note
    expect(noteOf('apps')).toBe(1)
    expect(noteOf('awarded')).toBe(2)
    expect(noteOf('decided')).toBe(6)
    expect(noteOf('averageAward')).toBe(3)
    expect(noteOf('liveAsked')).toBe(4)
    expect(noteOf('pct')).toBe(4)
    expect(noteOf('pctGrants')).toBe(4)
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
  it('starts every cancel reason with a capital, on screen and in the CSV', () => {
    const lower = {
      ...STATISTICS,
      recipients_cancelled: STATISTICS.recipients_cancelled.map((r, i) => ({
        ...r,
        reason_label: i === 0 ? 'declined: aid not enough / financial constraints' : 'schedule',
      })),
    }
    const rows = cancelledRows(lower, CAMP_R1, linkOf)
    expect(texts(rows[0]?.cells ?? [])[0]).toBe('Declined: aid not enough / financial constraints')
    expect(texts(rows[1]?.cells ?? [])[0]).toBe('Schedule')
    expect(rows[0]?.cells[0]).toEqual({
      kind: 'text',
      value: 'Declined: aid not enough / financial constraints',
    })
  })

  it("names each cancellation's reason and pool in the server's words (#2974)", () => {
    expect(cancelledRows(STATISTICS, CAMP_R1, linkOf).map((r) => texts(r.cells))).toEqual([
      ['Medical', 'Pool A', 'Round 1', '2', '$3,400'],
      ['Withdrawn in the dashboard', 'Pool B', 'Round 1', '1', '$700'],
      ['Duplicate', 'Pool A', 'Round 1', '1', '$500'],
      ['No reason recorded', 'No pool', 'Round 2', '1', '$300'],
    ])
  })

  it("titles the cancelled table's Requests and Locked amount, and gives Requests no note mark (the words are the title)", () => {
    const columns = cancelledColumns(() => 9)
    const requests = columns.find((c) => c.key === 'requests')
    expect(requests?.note).toBeUndefined()
    expect(requests?.title).toBe(
      'Requests with a posted award later cancelled or withdrawn. A confirmed duplicate that holds one is on its own Duplicate line. Once cancelled, a request is already out of Awarded.'
    )
    expect(columns.find((c) => c.key === 'posted')?.title).toBe(
      "The lock's amount, even if clawed back since"
    )
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

  it('marks the appeals notes as the mock does, and titles the two derived columns', () => {
    const notes: Record<string, number> = { apps: 1, appeals: 5 }
    const columns = tierAppealsColumns((key) => notes[key] ?? null)
    expect(columns.map((c) => [c.header, c.note ?? null])).toEqual([
      ['Tier', null],
      ['Income from', null],
      ['Income to', null],
      ['R1 apps', 1],
      ['R1 eligible fee %', null],
      ['Appeals (R2)', 5],
      ['R2 max fee %', 5],
      ['R3 awarded', null],
      ['Appeal rate', 5],
    ])
    expect(columns.find((c) => c.key === 'r2max')?.title).toBe(
      "A rules value: the most Round 1 and Round 2 aid together may cover, as a % of the session's cost"
    )
    expect(columns.find((c) => c.key === 'rate')?.title).toBe(
      'The dashboard derives it; no deck gives it per tier'
    )
  })

  it('spans RPT-9\'s total label over three columns, and marks "No tier" an end row', () => {
    const [tier, total] = STATISTICS.tier_appeals
    const noTier = { ...tier!, tier: null, income_from: null, income_to: null }
    const rows = tierAppealsRows(
      { ...STATISTICS, tier_appeals: [tier!, noTier, total!] },
      CAMP_R1,
      linkOf
    )
    expect(rows.map((r) => r.kind)).toEqual(['body', 'end', 'total'])
    expect(rows[2]?.span).toBe(3)
    expect(rows[2]?.cells[0]?.title).toBe('Table A · Round 1 and its appeals')
  })

  it('draws RPT-9 with its rules value and its derived rate as sent', () => {
    const [row] = tierAppealsRows(STATISTICS, CAMP_R1, linkOf)
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
  })

  it("opens RPT-9's Round 1 apps and appeals: a tier's own, the \"no tier\" row's, the totals'", () => {
    const [tier, total] = STATISTICS.tier_appeals
    const noTier = { ...tier!, tier: null, income_from: null, income_to: null }
    const rows = tierAppealsRows(
      { ...STATISTICS, tier_appeals: [tier!, noTier, total!] },
      CAMP_R1,
      linkOf
    )
    expect(addressOf(rows[0]?.links?.[3])).toEqual({
      part: 'tier_appeals',
      table: 'camp',
      round: '1',
      tier: '1',
      appeals_count: 'round1_apps',
    })
    expect(addressOf(rows[0]?.links?.[5])).toMatchObject({
      part: 'tier_appeals',
      appeals_count: 'appeals',
    })
    expect(addressOf(rows[1]?.links?.[3])).not.toHaveProperty('tier')
    expect(addressOf(rows[2]?.links?.[3])).toMatchObject({
      part: 'total_appeals',
      appeals_count: 'round1_apps',
    })
    expect(addressOf(rows[2]?.links?.[5])).toMatchObject({
      part: 'total_appeals',
      appeals_count: 'appeals',
    })
    expect(rows[0]?.links?.[7]).toBeUndefined() // money never links
  })

  it('draws RPT-9\'s last row as the server\'s totals, never a second "No tier" row', () => {
    const rows = tierAppealsRows(STATISTICS, CAMP_R1, linkOf)
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

  it('keeps a real "No tier" row before the totals; only the last row is the totals', () => {
    const [tier, total] = STATISTICS.tier_appeals
    const noTier = { ...tier!, tier: null, income_from: null, income_to: null }
    const rows = tierAppealsRows(
      { ...STATISTICS, tier_appeals: [tier!, noTier, total!] },
      CAMP_R1,
      linkOf
    )
    expect(rows.map((r) => r.kind)).toEqual(['body', 'end', 'total'])
    expect(reportText(rows[1]!.cells[0]!)).toBe('No tier')
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
      ['No pool', 'end'],
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

describe('March committee outcomes columns', () => {
  it('titles Round 2 asked: not-cancelled requests, as Season shows them', () => {
    expect(OUTCOME_COLUMNS.find((c) => c.key === 'appealedAsked')?.title).toBe(
      'Round 2 asks on requests not cancelled, as Season shows them. Appeals in the table above count cancelled requests too.'
    )
  })
})

describe('what the page says around it', () => {
  it('names the table the server answered by its label from the rules', () => {
    expect(tableLabel(STATISTICS)).toBe('Table A')
    expect(tableLabel(STATISTICS_ALL_TABLES)).toBe('All award tables')
  })

  it('names the requests a request set left out, for the cancelled line and the Requests picker (D138)', () => {
    expect(requestSetLeftOut(STATISTICS)).toBeNull()
    expect(requestSetLeftOut(STATISTICS_THROUGH)).toBe(4)
  })

  it('shortens an award table to its label in the mock, the rules label the fallback', () => {
    expect(tableShortLabel({ key: 'camp', label: 'Camp & Quest' })).toBe('C&Q')
    expect(tableShortLabel({ key: 'tbm', label: 'TBM' })).toBe('TBM')
    expect(tableShortLabel({ key: 'weekend', label: 'Weekend Programs' })).toBe('Weekend')
    expect(tableShortLabel({ key: 'table_z', label: 'Pool Z' })).toBe('Pool Z')
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

  it('keeps Rows: session in the link', () => {
    expect(statisticsLinkParams(readStatisticsChoice(new URLSearchParams('rows=session')))).toEqual(
      { rows: 'session' }
    )
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

describe('Asked (as typed): the raw sum beside the capped Asked, in Copy and the CSV only (owner A3, 2026-10-09)', () => {
  it('puts an export-only column right after Asked, with the raw figure in its cell', () => {
    const columns = tierColumns(STATISTICS, noNotes)
    const keys = columns.map((c) => c.key)
    expect(keys.indexOf('askedTyped')).toBe(keys.indexOf('asked') + 1)
    expect(columns[keys.indexOf('askedTyped')]).toMatchObject({
      header: 'Asked (as typed)',
      exportOnly: true,
    })
    const rows = tierRows(STATISTICS, CAMP_R1, linkOf)
    const total = rows[rows.length - 1]
    expect(texts(total?.cells ?? [])[keys.indexOf('askedTyped')]).toBe('$47,000')
    expect(texts(total?.cells ?? [])[keys.indexOf('asked')]).toBe('$44,000')
    expect(rows[0]?.cells).toHaveLength(columns.length)
    expect(total?.cells).toHaveLength(columns.length)
  })

  it('keeps every count link on its own column', () => {
    const keys = tierColumns(STATISTICS, noNotes).map((c) => c.key)
    const tier1 = tierRows(STATISTICS, CAMP_R1, linkOf)[0]
    expect(addressOf(tier1?.links?.[keys.indexOf('asks')])).toMatchObject({ count: 'asks' })
    expect(addressOf(tier1?.links?.[keys.indexOf('awards')])).toMatchObject({ count: 'awarded' })
  })

  it('Copy and the CSV read Asked, then Asked (as typed)', () => {
    const columns = tierColumns(STATISTICS, noNotes)
    const rows = tierRows(STATISTICS, CAMP_R1, linkOf)
    const heading = statisticsHeading(STATISTICS, 'By tier')
    expect(copyText(heading, columns, rows)).toContain('Asked\tAsked (as typed)\tAsks')
    expect(csvLines(heading, columns, rows, '/l')).toContainEqual(
      expect.arrayContaining(['Asked', 'Asked (as typed)'])
    )
    expect(copyText(heading, columns, rows)).toContain('$44,000\t$47,000')
  })
})

describe('the tier table footnote lines (owner A2 and A3, 2026-10-09)', () => {
  it('says round chips do not add up to All rounds only when R2, R3 or All is picked, and adds the cap words when some were capped', () => {
    // pin changed (ux3 statistics-9, coordinator ruling): the caveat was on every chip, R1 included, where it
    // explains nothing the view shows.
    expect(ROUND_CHIPS_NOTE).toBe(
      "Round chips don't add up to All rounds: an appeal re-asks part of the earlier shortfall, so All rounds counts it once."
    )
    expect(tierNotes(STATISTICS.total, '1')).toEqual([])
    for (const round of ['2', '3', 'all'] as const) {
      expect(tierNotes(STATISTICS.total, round)).toEqual([ROUND_CHIPS_NOTE])
    }
    const capped = { ...STATISTICS.total, requests_capped: 2 }
    expect(tierNotes(capped, '1')).toEqual([cappedAskWords(capped)])
    expect(tierNotes(capped, 'all')).toEqual([ROUND_CHIPS_NOTE, cappedAskWords(capped)])
  })

  it("carries them in By tier's Copy heading only when given as the heading notes", () => {
    const capped = { ...STATISTICS.total, requests_capped: 2 }
    const columns = tierColumns(STATISTICS, noNotes)
    const rows = tierRows(STATISTICS, CAMP_R1, linkOf)
    const text = copyText(
      statisticsHeading(STATISTICS, 'By tier', true, tierNotes(capped, 'all')),
      columns,
      rows
    )
    expect(text).toContain(ROUND_CHIPS_NOTE)
    expect(text).toContain("2 requests above their session's cost counted at the cost.")
    expect(statisticsHeading(STATISTICS, 'By tier').notes).toBeUndefined()
  })
})

describe('Statistics money and widths as the final mock draws them (ux3 statistics)', () => {
  it('shows the tier table money in whole dollars, with the exact figure behind it (statistics-6)', () => {
    const cents = {
      ...STATISTICS,
      rows: STATISTICS.rows.map((r, i) => (i === 0 ? { ...r, asked: 102577.2 } : r)),
    }
    const row = tierRows(cents, CAMP_R1, linkOf)[0]!
    const asked = tierColumns(cents, noNotes).findIndex((c) => c.key === 'asked')
    expect(row.cells[asked]).toMatchObject({ kind: 'money', value: 102577.2, whole: true })
    const text = copyText(
      statisticsHeading(cents, 'By tier'),
      tierColumns(cents, noNotes),
      tierRows(cents, CAMP_R1, linkOf)
    )
    expect(text).toContain('$102,577.20')
  })

  it("gives every column of the cancelled and committee tables a width, so they scale to the card as the mock's do (statistics-m4)", () => {
    expect(cancelledColumns(noNotes).map((c) => c.width)).toEqual([420, 200, 140, 120, 140])
    expect(OUTCOME_COLUMNS.map((c) => c.width)).toEqual([300, 150, 160, 150, 160, 200])
  })
})
