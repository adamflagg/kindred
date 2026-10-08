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
      '$2,666.67',
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
    expect(programsCsvName({ year: 2027, asOf: { kind: 'live' } }, { kind: 'deadline' })).toBe(
      'camperships-reports-programs-through-deadline-2027.csv'
    )
  })
})
