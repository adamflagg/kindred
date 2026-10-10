/** Programs' table in words (spec §9.3; RPT-11): pools, sessions, the server's subtotals and total. */
import { describe, expect, it } from 'vitest'

import { reportText } from '../kit/report'
import { parseReportParam, reportParam, type ReportAddress } from '../requests/reportFilter'
import {
  programColumns,
  programRows,
  programsCsvName,
  programsHeading,
  programsLinkParams,
} from './programsModel'
import { PROGRAMS } from './programsFixtures'

const ALL = { kind: 'all' } as const
const linkOf = (address: ReportAddress) => reportParam(address)
const addressOf = (href: string | undefined) => parseReportParam(href ?? null)?.query

describe('Programs (RPT-11)', () => {
  it('groups each pool’s sessions under its name, then its subtotal, then the total', () => {
    expect(
      programRows(PROGRAMS, ALL, linkOf).map((r) => [
        r.kind,
        reportText(r.cells[0] ?? { kind: 'text', value: '' }),
      ])
    ).toEqual([
      ['heading', 'Pool A'],
      ['body', 'Session 2'],
      ['body', 'Session 3'],
      ['subtotal', 'Pool A subtotal'],
      ['total', 'All pools'],
    ])
  })

  // Approved final mock reports-statistics.html (sessionTable): a pool row reads "<Pool>  <N> sessions" with
  // the count muted, Weekend adding that Family Camp apps count households.
  it('draws a session row flush, as the mock does: no indent under its pool heading', () => {
    const rows = programRows(PROGRAMS, ALL, linkOf)
    expect(rows[1]?.indent).toBeUndefined()
  })

  it('says how many sessions a pool holds, and that Family Camp apps count households', () => {
    const [heading] = programRows(PROGRAMS, ALL, linkOf)
    expect(heading?.meta).toBe('2 sessions')
    const family = {
      ...PROGRAMS,
      pools: [
        {
          ...PROGRAMS.pools[0]!,
          sessions: [{ ...PROGRAMS.pools[0]!.sessions[0]!, session_type: 'family' }],
        },
      ],
    }
    expect(programRows(family, ALL, linkOf)[0]?.meta).toBe(
      '1 session · Family Camp apps count households'
    )
  })

  it('titles the subtotal and the total as pooled ratios, and puts the P pill on the total', () => {
    const rows = programRows(PROGRAMS, ALL, linkOf)
    expect(rows[3]?.cells[0]?.title).toBe(
      'Pool A subtotal: pooled ratios, not averages of the rows'
    )
    expect(rows[4]?.badge).toBe('P')
    expect(rows[4]?.cells[0]?.title).toBe(
      'All pools · subtotals and this total are pooled ratios, not averages of the rows'
    )
    expect(rows.filter((r) => r.badge !== undefined)).toHaveLength(1)
  })

  it("names the request set in the total's title when one is on", () => {
    const rows = programRows(
      {
        ...PROGRAMS,
        request_set: {
          basis: 'date',
          through: '2027-02-01',
          label: 'requests received through Feb 1, 2027',
          left_out: 4,
          unknown: 0,
        },
      },
      { kind: 'date', date: '2027-02-01' },
      linkOf
    )
    expect(rows.at(-1)?.cells[0]?.title).toBe(
      'All pools: counts only requests received through Feb 1, 2027 · subtotals and this total are pooled ratios, not averages of the rows'
    )
  })

  it("keeps a session's full name in its words and title, and draws it through the name cell", () => {
    const [, session] = programRows(PROGRAMS, ALL, linkOf)
    expect(session?.cells[0]).toMatchObject({
      kind: 'text',
      value: 'Session 2',
      title: 'Session 2',
    })
    expect(session?.cells[0]?.display).toBeDefined()
  })

  it("marks a Family Camp session's title with the household rule", () => {
    const family = {
      ...PROGRAMS,
      pools: [
        {
          ...PROGRAMS.pools[0]!,
          sessions: [
            {
              ...PROGRAMS.pools[0]!.sessions[0]!,
              session_name: 'Family Camp 3: Young Families Weekend',
              session_type: 'family',
            },
          ],
        },
      ],
    }
    expect(programRows(family, ALL, linkOf)[1]?.cells[0]?.title).toBe(
      'Family Camp 3: Young Families Weekend · household requests: each app is a household'
    )
  })

  it('keeps the unmatched session an end row, muted italic as the mock draws it', () => {
    const noPool = {
      ...PROGRAMS,
      pools: PROGRAMS.pools.map((p) => ({ ...p, pool: null, pool_label: 'No pool' })),
    }
    expect(programRows(noPool, ALL, linkOf)[1]?.kind).toBe('end')
  })

  describe('Award table filters the session rows to its pools', () => {
    const TWO = {
      ...PROGRAMS,
      pools: [
        PROGRAMS.pools[0]!,
        { ...PROGRAMS.pools[0]!, pool: 'pool_b', pool_label: 'Pool B' },
        { ...PROGRAMS.pools[0]!, pool: null, pool_label: 'No pool' },
      ],
    }

    it('keeps only the pool groups the table sits in, and leaves the no-pool group out', () => {
      const rows = programRows(TWO, ALL, linkOf, { pools: ['pool_b'], label: 'Table B' })
      expect(rows.filter((r) => r.kind === 'heading').map((r) => reportText(r.cells[0]!))).toEqual([
        'Pool B',
      ])
    })

    it("makes a single pool's total that pool's own server subtotal, named for the table", () => {
      const rows = programRows(TWO, ALL, linkOf, { pools: ['pool_b'], label: 'Table B' })
      const total = rows.at(-1)!
      expect(total.kind).toBe('total')
      expect(reportText(total.cells[0]!)).toBe('Table B')
      const subtotal = rows.find((r) => r.kind === 'subtotal')!
      expect(total.cells.slice(1).map(reportText)).toEqual(subtotal.cells.slice(1).map(reportText))
      expect(addressOf(total.links?.[1])).toMatchObject({ part: 'subtotal', pool: 'pool_b' })
    })

    it('draws no total over several pools: the server sends none, and a client sum would estimate', () => {
      const rows = programRows(TWO, ALL, linkOf, { pools: ['pool_a', 'pool_b'], label: 'Both' })
      expect(rows.some((r) => r.kind === 'total')).toBe(false)
      expect(rows.filter((r) => r.kind === 'subtotal')).toHaveLength(2)
    })

    it('shows every group and the server total when no table is chosen', () => {
      const rows = programRows(TWO, ALL, linkOf, null)
      expect(rows.filter((r) => r.kind === 'heading')).toHaveLength(3)
      expect(rows.at(-1)?.kind).toBe('total')
    })
  })

  it("draws Round 1's and Round 2's six columns, Round 3's two and total awarded, as sent", () => {
    const session = programRows(PROGRAMS, ALL, linkOf)[1]
    expect(session?.cells.map(reportText)).toEqual([
      'Session 2',
      '2',
      '$6,000',
      '$1,500',
      '$3,000',
      '$1,500',
      '25.0%',
      '1',
      '$900',
      '$600',
      '$900',
      '$600',
      '66.7%',
      '0',
      '$0',
      '$2,100',
    ])
  })

  it('shows an average with cents in whole dollars', () => {
    const withCents = {
      ...PROGRAMS,
      pools: PROGRAMS.pools.map((pool, index) =>
        index > 0
          ? pool
          : {
              ...pool,
              sessions: pool.sessions.map((s, i) =>
                i > 0
                  ? s
                  : {
                      ...s,
                      round1: { ...s.round1, average_request: 2744.44, average_award: 2983.62 },
                    }
              ),
            }
      ),
    }
    const cells = programRows(withCents, ALL, linkOf)[1]?.cells.map(reportText) ?? []
    expect(cells[4]).toBe('$2,744')
    expect(cells[5]).toBe('$2,984')
  })

  it("draws an unawarded session's server ratios: its ask average, a real 0% and no award average", () => {
    const session = programRows(PROGRAMS, ALL, linkOf)[2]
    expect(session?.cells.map(reportText).slice(0, 7)).toEqual([
      'Session 3',
      '1',
      '$2,000',
      '$0',
      '$2,000',
      '—',
      '0.0%',
    ])
  })

  it("draws the subtotal and total with the server's pooled ratios, not averages of its rows", () => {
    const rows = programRows(PROGRAMS, ALL, linkOf)
    expect(rows[3]?.cells.map(reportText).slice(0, 7)).toEqual([
      'Pool A subtotal',
      '3',
      '$8,000',
      '$1,500',
      '$2,667',
      '$1,500',
      '18.8%',
    ])
    expect(rows[4]?.cells.map(reportText)[6]).toBe('18.8%')
  })

  it('heads the table by session, live without a past day, and names no request set when all', () => {
    expect(programsHeading(PROGRAMS)).toMatchObject({
      title: 'By session',
      season: 2027,
      live: true,
      requestSet: null,
    })
    expect(programsHeading({ ...PROGRAMS, as_of: '2027-03-08' }).live).toBe(false)
  })

  it('heads the rounds as groups, so a copied header reads "Round 1 · Apps"', () => {
    const columns = programColumns(() => null)
    expect(columns).toHaveLength(16)
    expect(columns[1]).toMatchObject({ header: 'Apps', group: 'Round 1' })
    expect(columns[8]).toMatchObject({ header: 'Asked', group: 'Round 2 (appeals)' })
    expect(columns[13]).toMatchObject({ header: 'Apps', group: 'Round 3' })
  })

  it('sizes, wraps and titles the session columns as the mock does', () => {
    const columns = programColumns(() => null)
    const wrapped = columns.filter((c) => c.wrap).map((c) => `${c.group ?? ''}|${c.header}`)
    expect(wrapped).toEqual([
      'Round 1|Avg request',
      'Round 1|Avg award',
      'Round 1|% awarded',
      'Round 2 (appeals)|Avg request',
      'Round 2 (appeals)|Avg award',
      'Round 2 (appeals)|% awarded',
      '|Total awarded',
    ])
    expect(columns.map((c) => c.width ?? null)).toEqual([
      null,
      56,
      84,
      84,
      66,
      66,
      70,
      50,
      70,
      76,
      62,
      62,
      70,
      48,
      72,
      84,
    ])
    expect(columns.find((c) => c.key === 'total')?.title).toBe(
      'Rounds 1–3 Posted, net of clawbacks'
    )
    // the Round 2 block's money column is Asked; Round 1's is Requested
    expect(columns[2]?.header).toBe('Requested')
  })

  it("opens each block's Apps on its session, pool subtotal or total (slice 4 J; #2974)", () => {
    const rows = programRows(PROGRAMS, { kind: 'deadline' }, linkOf)
    expect(addressOf(rows[1]?.links?.[1])).toEqual({
      through_round1_deadline: 'true',
      part: 'session',
      pool: 'pool_a',
      session: '1000102',
      block: '1',
      count: 'apps',
    })
    expect(addressOf(rows[1]?.links?.[7])).toMatchObject({ block: '2' })
    expect(addressOf(rows[3]?.links?.[13])).toMatchObject({ part: 'subtotal', block: '3' })
    expect(addressOf(rows[4]?.links?.[1])).toEqual({
      through_round1_deadline: 'true',
      part: 'total',
      block: '1',
      count: 'apps',
    })
    expect(rows[0]?.links).toBeUndefined() // a pool's heading opens nothing
  })

  it('opens the no-pool group with no pool, as the route reads it', () => {
    const noPool = {
      ...PROGRAMS,
      pools: PROGRAMS.pools.map((p) => ({ ...p, pool: null, pool_label: 'No pool' })),
    }
    expect(addressOf(programRows(noPool, ALL, linkOf)[1]?.links?.[1])).not.toHaveProperty('pool')
  })

  it('keeps the request set in the link and the file name', () => {
    expect(programsLinkParams({ kind: 'deadline' })).toEqual({
      rows: 'session',
      through: 'deadline',
    })
    expect(programsLinkParams({ kind: 'all' })).toEqual({ rows: 'session' })
  })

  it('keeps the chosen award table in the link and the file name, so the CSV reproduces its rows (D15)', () => {
    expect(programsLinkParams({ kind: 'all' }, 'camp')).toEqual({ rows: 'session', table: 'camp' })
    expect(programsCsvName({ year: 2027, asOf: { kind: 'live' } }, { kind: 'all' }, 'camp')).toBe(
      'camperships-reports-statistics-by-session-camp-2027.csv'
    )
    expect(programsLinkParams({ kind: 'all' }, null)).toEqual({ rows: 'session' })
  })

  it('keeps the request set in the file name', () => {
    expect(programsCsvName({ year: 2027, asOf: { kind: 'live' } }, { kind: 'deadline' })).toBe(
      'camperships-reports-statistics-by-session-through-deadline-2027.csv'
    )
  })
})
