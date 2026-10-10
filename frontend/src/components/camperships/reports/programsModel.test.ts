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
  programsNotes,
} from './programsModel'
import { copyText, csvLines } from '../kit/report'
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
      '$6,000', // (as typed), owner A3 (2026-10-09)
      '$1,500',
      '$3,000',
      '$1,500',
      '25.0%',
      '1',
      '$900',
      '$900', // (as typed), owner A3 (2026-10-09)
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
    // owner A3 (2026-10-09): each block gained an export-only (as typed) column, so these moved one right
    expect(cells[5]).toBe('$2,744')
    expect(cells[6]).toBe('$2,984')
  })

  it("draws an unawarded session's server ratios: its ask average, a real 0% and no award average", () => {
    const session = programRows(PROGRAMS, ALL, linkOf)[2]
    expect(session?.cells.map(reportText).slice(0, 8)).toEqual([
      'Session 3',
      '1',
      '$2,000',
      '$2,000', // (as typed), owner A3 (2026-10-09)
      '$0',
      '$2,000',
      '—',
      '0.0%',
    ])
  })

  it("draws the subtotal and total with the server's pooled ratios, not averages of its rows", () => {
    const rows = programRows(PROGRAMS, ALL, linkOf)
    expect(rows[3]?.cells.map(reportText).slice(0, 8)).toEqual([
      'Pool A subtotal',
      '3',
      '$8,000',
      '$8,000', // (as typed), owner A3 (2026-10-09)
      '$1,500',
      '$2,667',
      '$1,500',
      '18.8%',
    ])
    expect(rows[4]?.cells.map(reportText)[7]).toBe('18.8%')
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
    // owner A3 (2026-10-09): two export-only (as typed) columns joined the sixteen
    expect(columns).toHaveLength(18)
    expect(columns[1]).toMatchObject({ header: 'Apps', group: 'Round 1' })
    expect(columns[9]).toMatchObject({ header: 'Asked', group: 'Round 2 (appeals)' })
    expect(columns[15]).toMatchObject({ header: 'Apps', group: 'Round 3' })
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
      null,
      84,
      66,
      66,
      70,
      50,
      70,
      null,
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
    // owner A3 (2026-10-09): Round 2's Apps moved from cell 7 to 8, Round 3's from 13 to 15
    expect(addressOf(rows[1]?.links?.[8])).toMatchObject({ block: '2' })
    expect(addressOf(rows[3]?.links?.[15])).toMatchObject({ part: 'subtotal', block: '3' })
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

describe('Requested and Asked (as typed): the raw sums beside the capped ones (owner A3, 2026-10-09)', () => {
  it("puts an export-only column right after each round block's money column", () => {
    const columns = programColumns(() => null)
    expect(columns[3]).toMatchObject({
      header: 'Requested (as typed)',
      group: 'Round 1',
      exportOnly: true,
    })
    expect(columns[10]).toMatchObject({
      header: 'Asked (as typed)',
      group: 'Round 2 (appeals)',
      exportOnly: true,
    })
  })

  it('carries the raw figure in the cell beside the capped one, and keeps cells aligned with columns', () => {
    const rows = programRows(PROGRAMS, ALL, linkOf)
    const total = rows[rows.length - 1]
    const cells = total?.cells.map(reportText) ?? []
    expect(cells[2]).toBe('$8,000')
    expect(cells[3]).toBe('$9,500')
    expect(total?.cells).toHaveLength(programColumns(() => null).length)
  })

  it('Copy and the CSV header read "Round 1 · Requested (as typed)" and "Round 2 (appeals) · Asked (as typed)"', () => {
    const columns = programColumns(() => null)
    const rows = programRows(PROGRAMS, ALL, linkOf)
    const text = copyText(programsHeading(PROGRAMS), columns, rows)
    expect(text).toContain('Round 1 · Requested\tRound 1 · Requested (as typed)')
    expect(text).toContain('Round 2 (appeals) · Asked (as typed)')
    const header = csvLines(programsHeading(PROGRAMS), columns, rows, '/l').find((l) =>
      l.includes('Round 1 · Requested (as typed)')
    )
    expect(header).toContain('Round 2 (appeals) · Asked (as typed)')
  })

  it('says how many requests were counted at their session cost, naming Requested and Asked, only when some were', () => {
    expect(programsNotes(PROGRAMS)).toEqual([])
    expect(programsNotes({ ...PROGRAMS, requests_capped: 3 })).toEqual([
      "Requested and Asked: 3 requests above their session's cost counted at the cost.",
    ])
    expect(programsNotes({ ...PROGRAMS, requests_capped: 1 })).toEqual([
      "Requested and Asked: 1 request above its session's cost counted at the cost.",
    ])
    const heading = programsHeading({ ...PROGRAMS, requests_capped: 3 })
    expect(heading.notes).toHaveLength(1)
    expect(programsHeading(PROGRAMS).notes).toBeUndefined()
  })
})

describe('the session table as the final mock draws it (ux3 statistics)', () => {
  const CENTS = {
    ...PROGRAMS,
    pools: [
      {
        ...PROGRAMS.pools[0]!,
        sessions: [
          {
            ...PROGRAMS.pools[0]!.sessions[0]!,
            round1: { ...PROGRAMS.pools[0]!.sessions[0]!.round1, requested: 4097.2 },
          },
        ],
      },
    ],
  }

  it('shows money in whole dollars and keeps the cents in Copy and the CSV (statistics-6)', () => {
    const rows = programRows(CENTS, ALL, linkOf)
    const requested = programColumns(() => null).findIndex((c) => c.key === 'Round 1-requested')
    const cell = rows[1]?.cells[requested]
    expect(cell).toMatchObject({ kind: 'money', value: 4097.2, whole: true })
    const columns = programColumns(() => null)
    const heading = programsHeading(CENTS)
    expect(copyText(heading, columns, rows)).toContain('$4,097.20')
    expect(csvLines(heading, columns, rows, '/l').flat()).toContain('4097.20')
  })

  it("lets a subtotal's long label clamp to two lines (statistics-4)", () => {
    const rows = programRows(PROGRAMS, ALL, linkOf)
    expect(rows[3]?.cells[0]).toMatchObject({ twoLines: true })
    expect(rows[1]?.cells[0]).not.toHaveProperty('twoLines')
  })

  it('draws the Total awarded column in bold (statistics-m2)', () => {
    const total = programColumns(() => null).find((c) => c.key === 'total')
    expect(total?.strong).toBe(true)
    expect(programColumns(() => null).filter((c) => c.strong)).toHaveLength(1)
  })
})
