import { describe, expect, it } from 'vitest'

import type { AidView } from '../kit/asOf'
import { BUDGET, overBudget, poolOverShare } from './budgetFixtures'
import {
  BUDGET_CSV_HEADERS,
  budgetBar,
  budgetCsvRows,
  noPoolCommitted,
  poolBar,
  poolCards,
  roundLegend,
  roundLines,
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

describe('the rounds table (spec §5.2 D)', () => {
  it('one line per round with Committed and what is committed, pending approval on Round 3', () => {
    const lines = roundLines(BUDGET, 'pool_a', LIVE)
    expect(lines.map((l) => [l.round, l.committed])).toEqual([
      [1, 772640],
      [2, 19720],
      [3, 2750],
    ])
    expect(lines[2]?.parts.map((p) => p.label)).toEqual([
      'Posted',
      'of it accepted',
      'needs an offer',
      'pending approval',
    ])
    expect(lines[0]?.parts.map((p) => p.label)).toEqual([
      'Posted',
      'of it accepted',
      'needs an offer',
    ])
    expect(lines[0]?.confirmed?.words).toBe('4 not yet confirmed · $5,200')
  })

  it("links each figure as today's cellHref does, and never per-round Allocated or Remaining", () => {
    const [r1] = roundLines(BUDGET, 'pool_a', LIVE)
    expect(r1?.parts[0]?.href).toBe('/aid/requests?pool=pool_a&posted=1&counted=1&year=2027')
    expect(JSON.stringify(r1)).not.toMatch(/allocated|remaining/i)
  })

  it('opens nothing on a past date for a queue figure', () => {
    const past: AidView = {
      year: 2027,
      asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' },
    }
    const [r1] = roundLines(BUDGET, 'pool_a', past)
    expect(r1?.parts.find((p) => p.label === 'needs an offer')?.href).toBeNull()
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
