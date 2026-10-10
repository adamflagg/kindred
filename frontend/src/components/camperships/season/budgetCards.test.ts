import { describe, expect, it } from 'vitest'

import type { AidView } from '../kit/asOf'
import { BUDGET, overBudget, pastBudget, poolOverShare } from './budgetFixtures'
import {
  BUDGET_CSV_HEADERS,
  budgetBar,
  budgetCsvRows,
  noPoolCommitted,
  poolBar,
  poolCards,
  ledgerRows,
  previewMoves,
  roundLegend,
  shareCaption,
  withPreview,
} from './budgetCards'

const LIVE: AidView = { year: 2027, asOf: { kind: 'live' } }

describe('pool cards (spec §5.2 C)', () => {
  it('one card per rules pool, in the server order, No pool never a card', () => {
    expect(poolCards(BUDGET, null).map((c) => [c.key, c.share, c.allocated])).toEqual([
      ['pool_a', 90, 900000],
      ['pool_b', 10, 100000],
    ])
    expect(poolCards(BUDGET, 'pool_b').map((c) => c.key)).toEqual(['pool_b'])
  })

  it('a pool the rules dropped still shows its Committed money, its share, Allocated and Remaining blank', () => {
    const base = BUDGET.pools.find((p) => p.pool === 'pool_b')!
    const dropped = {
      ...BUDGET,
      pools: [
        ...BUDGET.pools,
        {
          ...base,
          pool: 'pool_c',
          label: 'Pool C',
          share_pct: null,
          total: { ...base.total, allocated: null, remaining: null, committed: 5000 },
        },
      ],
    }
    const card = poolCards(dropped, null).find((c) => c.key === 'pool_c')
    expect(card).toMatchObject({ share: null, allocated: null, remaining: null, committed: 5000 })
    expect(
      poolCards(
        {
          ...dropped,
          pools: [{ ...dropped.pools[3]!, total: { ...dropped.pools[3]!.total, committed: 0 } }],
        },
        null
      )
    ).toEqual([])
  })

  it('a pool past its share is "over its share" (amber), the total stays positive (§8.3)', () => {
    const [, b] = poolCards(poolOverShare(), null)
    expect(b?.remaining).toBe(-1200)
    expect(b?.overShare).toBe(true)
  })

  it('legends each round it committed, leaves out a $0 round, and says when nothing is committed', () => {
    const [a, b] = poolCards(BUDGET, null)
    expect(roundLegend(a!)).toEqual(['Round 1 $772,640', 'Round 2 $19,720', 'Round 3 $2,750'])
    const empty = { ...b!, parts: [] }
    expect(roundLegend(empty)).toBeNull()
  })

  it('draws the pool bar Round 1 → 2 → 3 on max(Allocated, Committed), with stripes past Allocated', () => {
    const [, b] = poolCards(poolOverShare(), null)
    const bar = poolBar(b!)
    expect(bar.overLeftPct).toBeCloseTo((100000 / 101200) * 100, 5)
    expect(bar.overWidthPct).toBeCloseTo((1200 / 101200) * 100, 5)
  })
})

describe('the budget card (spec §5.2 A)', () => {
  it('one bar segment per pool, grown by its Allocated, filled to min(Committed, Allocated)', () => {
    const { segments, overGrow } = budgetBar(poolCards(BUDGET, null), 1)
    expect(segments.map((s) => [s.key, s.grow])).toEqual([
      ['pool_a', 900000],
      ['pool_b', 100000],
    ])
    expect(overGrow).toBeNull()
  })

  it('adds a red overage segment when the total goes below $0', () => {
    expect(budgetBar(poolCards(overBudget(), null), -8366).overGrow).toBe(8366)
  })

  it('captions the first pool at the left and the rest joined at the right', () => {
    expect(shareCaption(poolCards(BUDGET, null))).toEqual({
      first: 'Pool A 90%',
      rest: 'Pool B 10%',
    })
  })

  it('shows the No pool card only when money sits there', () => {
    expect(noPoolCommitted(BUDGET)).toBe(1200)
  })
})

describe('the ruled ledger: pools open into their rounds, the season in the band (spec §5.2 D; rounds-1, -2, -3)', () => {
  const PAST: AidView = {
    year: 2027,
    asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' },
  }
  const rows = (open: string[] = ['pool_a'], pool: string | null = null, view = LIVE) =>
    ledgerRows(BUDGET, pool, view, new Set(open))

  it('lists each pool, its rounds only while open, then No pool and the Season total (never an empty table)', () => {
    expect(rows().map((r) => [r.kind, r.label])).toEqual([
      ['pool', 'Pool A'],
      ['round', 'Round 1'],
      ['round', 'Round 2'],
      ['round', 'Round 3'],
      ['pool', 'Pool B'],
      ['nopool', 'No pool'],
      ['foot', 'Season total'],
    ])
    expect(rows([]).map((r) => r.kind)).toEqual(['pool', 'pool', 'nopool', 'foot'])
  })

  it('a one-pool page keeps that pool and its total reads "<Pool> only", with no No pool row', () => {
    expect(rows(['pool_b'], 'pool_b').map((r) => [r.kind, r.label])).toEqual([
      ['pool', 'Pool B'],
      ['round', 'Round 1'],
      ['round', 'Round 2'],
      ['round', 'Round 3'],
      ['foot', 'Pool B only'],
    ])
  })

  it('splits what is committed into five figures per row, Pending approval on Round 3 only', () => {
    const [pool, r1, , r3] = rows()
    expect(r1?.committed).toBe(772640)
    expect(r1?.posted).toMatchObject({
      words: '$764,540',
      href: '/aid/requests?pool=pool_a&posted=1&year=2027',
    })
    expect(r1?.accepted.words).toBe('$598,300')
    expect(r1?.needsOffer.words).toBe('3 · $8,100')
    expect(r1?.pending).toBeNull()
    expect(r3?.pending).toMatchObject({ words: '1 · $650' })
    expect(r3?.pending?.href).toContain('view=pending-approval')
    expect(pool?.pending?.words).toBe('1 · $650')
  })

  it('Not yet confirmed is the amount alone, amber only above $0, linking to Not reconciled', () => {
    const [, r1, r2] = rows()
    expect(r1?.unconfirmed).toMatchObject({ words: '$5,200', amber: true })
    expect(r1?.unconfirmed?.href).toContain('view=not-reconciled')
    expect(r1?.unconfirmed?.title).toMatch(/isn't in CampMinder's camp aid yet/)
    expect(r2?.unconfirmed).toMatchObject({ words: '$1,800', amber: true })
    const b = rows().find((r) => r.label === 'Pool B')
    expect(b?.unconfirmed?.amber).toBeFalsy()
    expect(rows().at(-1)?.unconfirmed?.words).toBe('$7,000')
  })

  it('a total never links (the pool and round figures do), and No pool opens nothing', () => {
    const all = rows()
    const foot = all.at(-1)!
    expect([
      foot.posted.href,
      foot.accepted.href,
      foot.needsOffer.href,
      foot.unconfirmed?.href,
    ]).toEqual([null, null, null, null])
    const none = all.find((r) => r.kind === 'nopool')!
    expect(none.committed).toBe(1200)
    expect(none.posted.href).toBeNull()
  })

  it('never carries Allocated or Remaining per round (§8.1)', () => {
    for (const row of rows().filter((r) => r.kind === 'round')) {
      expect(Object.keys(row).join(' ')).not.toMatch(/allocated|remaining/i)
    }
  })

  it('on a past date opens no queue view, and a masked figure reads "—"', () => {
    const [, r1] = ledgerRows(pastBudget(), null, PAST, new Set(['pool_a']))
    expect(r1?.needsOffer.href).toBeNull()
    expect(r1?.unconfirmed?.words).toBe('—')
  })

  it('has no No pool row when nothing sits there', () => {
    const none = {
      ...BUDGET,
      pools: BUDGET.pools.map((p) =>
        p.pool === '' ? { ...p, total: { ...p.total, committed: 0 } } : p
      ),
    }
    expect(ledgerRows(none, null, LIVE, new Set()).some((r) => r.kind === 'nopool')).toBe(false)
  })
})

describe('the preview pill (rounds-13)', () => {
  it('is on only when the typed plan moves a pool or the total from the read', () => {
    const same = {
      pools: {
        pool_a: { allocated: 900000, remaining: 119460 },
        pool_b: { allocated: 100000, remaining: 86100 },
      },
      total: { allocated: 1000000, remaining: 100000 },
    }
    expect(previewMoves(BUDGET, same)).toBe(false)
    expect(
      previewMoves(BUDGET, {
        ...same,
        pools: { ...same.pools, pool_b: { allocated: 110000, remaining: 96100 } },
      })
    ).toBe(true)
    expect(previewMoves(BUDGET, { ...same, total: { allocated: 1010000, remaining: 1 } })).toBe(
      true
    )
    expect(previewMoves(BUDGET, null)).toBe(false)
  })
})

describe('Download CSV (spec §5.2 H)', () => {
  it('lists every pool, its three rounds and the total, whatever is folded', () => {
    expect(BUDGET_CSV_HEADERS).toEqual([
      'Pool',
      'Round',
      'Share %',
      'Allocated',
      'Committed',
      'Posted',
      'Accepted',
      'Needs an offer',
      'Needs an offer requests',
      'Pending approval',
      'Pending approval requests',
      'Remaining',
    ])
    const rows = budgetCsvRows(BUDGET, null)
    expect(rows.map((r) => [r[0], r[1]])).toEqual([
      ['Pool A', ''],
      ['Pool A', '1'],
      ['Pool A', '2'],
      ['Pool A', '3'],
      ['Pool B', ''],
      ['Pool B', '1'],
      ['Pool B', '2'],
      ['Pool B', '3'],
      ['No pool', ''],
      ['No pool', '1'],
      ['No pool', '2'],
      ['No pool', '3'],
      ['Total', ''],
      ['Total', '1'],
      ['Total', '2'],
      ['Total', '3'],
    ])
    const round1 = rows[1]!
    expect([round1[2], round1[3], round1[11]]).toEqual(['', '', ''])
  })

  it('on a one-pool page lists that pool and its rounds only', () => {
    expect(budgetCsvRows(BUDGET, 'pool_b').map((r) => r[0])).toEqual([
      'Pool B',
      'Pool B',
      'Pool B',
      'Pool B',
    ])
  })
})

describe('the cards as the typed plan draws them (spec §5.2 B)', () => {
  it('draws the typed plan while Edit Plan… is open, Committed unchanged', () => {
    const [, b] = withPreview(poolCards(BUDGET, null), {
      pools: { pool_b: { allocated: 110000, remaining: 57600 } },
      total: { allocated: 1000000, remaining: 151290 },
    })
    expect([b?.allocated, b?.remaining, b?.committed]).toEqual([110000, 57600, 52400])
  })
})
