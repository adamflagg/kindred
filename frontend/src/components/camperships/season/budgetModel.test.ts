import { describe, expect, it } from 'vitest'

import type { ApiAidGridRow } from '../../../types/api-types'
import { gridFiltersFrom } from '../household/queueWalk'
import type { AidView } from '../kit/asOf'
import { toCents } from '../kit/money'
import { gridRow, roundOut } from '../requests/gridFixtures'
import { filterRows, requestView } from '../requests/views'
import { BUDGET, pastBudget, pastBudgetUnmasked } from './budgetFixtures'
import {
  belowTheLine,
  budgetCsvName,
  budgetRows,
  budgetTypeLines,
  cellCount,
  cellHref,
  cellValue,
  confirmedHref,
  confirmedWords,
  scopePool,
  stripRounds,
  type BudgetRow,
} from './budgetModel'

const LIVE: AidView = { year: 2027, asOf: { kind: 'live' } }
const PAST: AidView = { year: 2027, asOf: { kind: 'past', date: '2027-03-15', axis: 'campminder' } }
const EVERY = { pool: null, folded: new Set<string>() }

function row(rows: readonly BudgetRow[], key: string): BudgetRow {
  const found = rows.find((r) => r.key === key)
  if (found === undefined) throw new Error(`no row ${key}`)
  return found
}

describe('the strip (§7.2; D153, owner ruling Group 2c Q3)', () => {
  it('counts each round, Round 3 with its pending approval (D79)', () => {
    const rounds = stripRounds(BUDGET.strip, LIVE)
    expect(rounds.map((r) => r.counts.map((c) => c.label))).toEqual([
      ['needs an offer', 'posted', 'accepted', 'held'],
      ['needs an offer', 'posted', 'accepted', 'held'],
      ['needs an offer', 'posted', 'accepted', 'held', 'pending approval'],
    ])
  })

  it('shows no awaiting-sync or not-reconciled count (owner: running-rounds Q1 = A)', () => {
    const measures = stripRounds(BUDGET.strip, LIVE).flatMap((r) => r.counts.map((c) => c.measure))
    expect(measures).not.toContain('awaiting_sync')
    expect(measures).not.toContain('not_reconciled')
  })

  it("opens posted and accepted as All on that round's figure, not on round= (owner 10-06)", () => {
    const [r1] = stripRounds(BUDGET.strip, LIVE)
    const href = (measure: string) => r1?.counts.find((c) => c.measure === measure)?.href
    expect(href('posted')).toBe('/aid/requests?posted=1&year=2027')
    expect(href('accepted')).toBe('/aid/requests?accepted=1&year=2027')
  })

  it('opens needs an offer, held and pending approval on their own Requests views', () => {
    const rounds = stripRounds(BUDGET.strip, LIVE)
    const href = (round: number, measure: string) =>
      rounds[round - 1]?.counts.find((c) => c.measure === measure)?.href
    // A round's queue count carries its round (lead ruling, fix-wave addition).
    expect(href(1, 'needs_offer')).toBe('/aid/requests?view=needs-offer&round=1&year=2027')
    expect(href(1, 'held')).toBe('/aid/requests?view=holds&year=2027')
    expect(href(3, 'pending_approval')).toBe(
      '/aid/requests?view=pending-approval&round=3&year=2027'
    )
  })

  it('opens nothing at zero, or where a past date leaves the count empty', () => {
    const rounds = stripRounds(BUDGET.strip, LIVE)
    expect(rounds[2]?.counts.find((c) => c.measure === 'held')?.href).toBeNull()
    const past = stripRounds(pastBudget().strip, PAST)
    const needs = past[0]?.counts.find((c) => c.measure === 'needs_offer')
    expect(needs?.count).toBeNull()
    expect(needs?.href).toBeNull()
    expect(past[0]?.counts.find((c) => c.measure === 'posted')?.href).toBe(
      '/aid/requests?posted=1&year=2027&as_of=2027-03-15'
    )
  })
})

describe('the table (§7.2; D53, D79)', () => {
  it('lists each pool, its rounds, Round 3 pending approval on its own line, then the total', () => {
    expect(budgetRows(BUDGET, EVERY).map((r) => r.key)).toEqual([
      'pool_a:all',
      'pool_a:1',
      'pool_a:2',
      'pool_a:3',
      'pool_a:3:pending',
      'pool_b:all',
      'pool_b:1',
      'pool_b:2',
      'pool_b:3',
      ':all',
      ':1',
      ':2',
      ':3',
      'total',
    ])
  })

  it('folds a pool to its total line, and shows one pool alone with no total (D48)', () => {
    expect(
      budgetRows(BUDGET, { pool: null, folded: new Set(['pool_a']) })
        .map((r) => r.key)
        .slice(0, 2)
    ).toEqual(['pool_a:all', 'pool_b:all'])
    expect(budgetRows(BUDGET, { pool: 'pool_b', folded: new Set() }).map((r) => r.key)).toEqual([
      'pool_b:all',
      'pool_b:1',
      'pool_b:2',
      'pool_b:3',
    ])
    expect(budgetRows(BUDGET, { pool: 'pool_zz', folded: new Set() })).toEqual([])
  })

  it("shows the server's figures as sent, and Pending approval in the Needs an offer column", () => {
    const rows = budgetRows(BUDGET, EVERY)
    expect(cellValue(row(rows, 'pool_a:3'), 'needs_offer')).toBe(300)
    expect(cellValue(row(rows, 'pool_a:3:pending'), 'needs_offer')).toBe(650)
    expect(cellValue(row(rows, 'pool_a:3:pending'), 'remaining')).toBeNull()
    expect(cellValue(row(rows, ':all'), 'allocated')).toBeNull()
    expect(cellValue(row(rows, 'total'), 'remaining')).toBe(151290)
  })
})

describe('per-cell counts (read 2; owner: cells read "n · $X")', () => {
  const rows = budgetRows(BUDGET, EVERY)

  it('counts requests under Needs an offer, and Pending approval on its own line', () => {
    expect(cellCount(row(rows, 'pool_a:1'), 'needs_offer')).toEqual({ families: 3, requests: 3 })
    expect(cellCount(row(rows, 'pool_a:all'), 'needs_offer')).toEqual({
      families: 13,
      requests: 13,
    })
    expect(cellCount(row(rows, 'pool_a:3:pending'), 'needs_offer')).toEqual({
      families: 1,
      requests: 1,
    })
  })

  it('gives no count to any other column', () => {
    for (const column of ['allocated', 'posted', 'accepted', 'remaining'] as const) {
      expect(cellCount(row(rows, 'pool_a:1'), column)).toBeNull()
    }
    expect(cellCount(row(rows, 'pool_a:3:pending'), 'remaining')).toBeNull()
  })
})

describe('a round has no Allocated or Remaining, and a past read has no count (spec §9.4)', () => {
  it('reads null for Allocated and Remaining on a round line, never undefined', () => {
    const rows = budgetRows(BUDGET, EVERY)
    expect(cellValue(row(rows, 'pool_a:1'), 'allocated')).toBeNull()
    expect(cellValue(row(rows, 'pool_a:1'), 'remaining')).toBeNull()
    expect(cellValue(row(rows, 'pool_a:all'), 'allocated')).toBe(900000)
  })

  it('counts nothing where a past date masks the count', () => {
    const past = row(budgetRows(pastBudget(), EVERY), 'pool_a:1')
    expect(cellCount(past, 'needs_offer')).toBeNull()
  })
})

describe('where each figure opens (D20, D153)', () => {
  const rows = budgetRows(BUDGET, EVERY)

  it('no Season link carries counted: every link opens the whole round (R10)', () => {
    const columns = ['allocated', 'posted', 'accepted', 'needs_offer', 'remaining'] as const
    const hrefs = [
      ...stripRounds(BUDGET.strip, LIVE).flatMap((r) => r.counts.map((c) => c.href)),
      ...rows.flatMap((r) => columns.map((col) => cellHref(r, col, LIVE, 4))),
      ...rows.map((r) => confirmedHref(r, LIVE)),
    ].filter((h): h is string => h !== null)
    expect(hrefs.length).toBeGreaterThan(0)
    expect(hrefs.filter((h) => h.includes('counted'))).toEqual([])
  })

  it("opens Posted and Accepted as All on the pool and the round's figure (owner 10-06)", () => {
    expect(cellHref(row(rows, 'pool_a:2'), 'posted', LIVE, 3)).toBe(
      '/aid/requests?pool=pool_a&posted=2&year=2027'
    )
    expect(cellHref(row(rows, 'pool_a:all'), 'accepted', LIVE, 3)).toBe(
      '/aid/requests?pool=pool_a&accepted=all&year=2027'
    )
    expect(cellHref(row(rows, 'total'), 'posted', LIVE, 3)).toBe(
      '/aid/requests?posted=all&year=2027'
    )
  })

  it('opens Needs an offer and Pending approval on their views, and Allocated on the rules', () => {
    // A round line carries its round; the pool line covers every round (fix-wave addition).
    expect(cellHref(row(rows, 'pool_a:1'), 'needs_offer', LIVE, 3)).toBe(
      '/aid/requests?view=needs-offer&pool=pool_a&round=1&year=2027'
    )
    expect(cellHref(row(rows, 'pool_a:all'), 'needs_offer', LIVE, 3)).toBe(
      '/aid/requests?view=needs-offer&pool=pool_a&year=2027'
    )
    expect(cellHref(row(rows, 'total'), 'needs_offer', LIVE, 3)).toBe(
      '/aid/requests?view=needs-offer&year=2027'
    )
    expect(cellHref(row(rows, 'pool_a:3:pending'), 'needs_offer', LIVE, 3)).toBe(
      '/aid/requests?view=pending-approval&pool=pool_a&round=3&year=2027'
    )
    // The approved version that priced the figure (plan review I1), keeping the page's past date
    // (I6: the pill shows on every Season tab; Task 11 review).
    expect(cellHref(row(rows, 'pool_a:all'), 'allocated', PAST, 3)).toBe(
      '/aid/season/rules?version=3&section=budget&year=2027&as_of=2027-03-15'
    )
    expect(cellHref(row(rows, 'pool_a:all'), 'allocated', LIVE, 3)).toBe(
      '/aid/season/rules?version=3&section=budget&year=2027'
    )
    expect(cellHref(row(rows, 'pool_a:all'), 'allocated', LIVE, null)).toBeNull()
    expect(cellHref(row(rows, 'pool_a:1'), 'allocated', LIVE, 3)).toBeNull()
  })

  it('opens nothing for Remaining, a zero, a "—", or a No pool line', () => {
    expect(cellHref(row(rows, 'pool_a:1'), 'remaining', LIVE, 3)).toBeNull()
    expect(cellHref(row(rows, 'pool_b:2'), 'posted', LIVE, 3)).toBeNull()
    expect(cellHref(row(rows, ':1'), 'posted', LIVE, 3)).toBeNull()
    expect(cellHref(row(rows, ':all'), 'allocated', LIVE, 3)).toBeNull()
  })

  it('carries a past date on what it opens', () => {
    expect(cellHref(row(budgetRows(pastBudget(), EVERY), 'pool_a:1'), 'posted', PAST, 3)).toBe(
      '/aid/requests?pool=pool_a&posted=1&year=2027&as_of=2027-03-15'
    )
  })
})

describe('a past date opens no live-only Requests view (final review I1)', () => {
  // Needs an offer, Holds and Pending approval list today's queues: AidRequestsPage refuses them
  // on a past date, so a figure the server still sends there must not open one.
  const past = pastBudgetUnmasked()

  it('the strip: needs an offer, held and pending approval open nothing; posted and accepted keep the date', () => {
    const rounds = stripRounds(past.strip, PAST)
    const count = (round: number, measure: string) =>
      rounds[round - 1]?.counts.find((c) => c.measure === measure)
    expect(count(1, 'needs_offer')?.count).toEqual({ families: 3, requests: 3 })
    expect(count(1, 'needs_offer')?.href).toBeNull()
    expect(count(1, 'held')?.count).toEqual({ families: 6, requests: 9 })
    expect(count(1, 'held')?.href).toBeNull()
    expect(count(3, 'pending_approval')?.count).toEqual({ families: 1, requests: 1 })
    expect(count(3, 'pending_approval')?.href).toBeNull()
    expect(count(1, 'posted')?.href).toBe('/aid/requests?posted=1&year=2027&as_of=2027-03-15')
    expect(count(1, 'accepted')?.href).toBe('/aid/requests?accepted=1&year=2027&as_of=2027-03-15')
  })

  it('the table: Needs an offer and the Pending approval line open nothing; Posted and Accepted keep the date', () => {
    const rows = budgetRows(past, EVERY)
    for (const key of ['pool_a:1', 'pool_a:all', 'total']) {
      expect(cellValue(row(rows, key), 'needs_offer'), key).not.toBeNull()
      expect(cellHref(row(rows, key), 'needs_offer', PAST, 3), key).toBeNull()
    }
    expect(cellHref(row(rows, 'pool_a:3:pending'), 'needs_offer', PAST, 3)).toBeNull()
    expect(cellHref(row(rows, 'pool_a:1'), 'posted', PAST, 3)).toBe(
      '/aid/requests?pool=pool_a&posted=1&year=2027&as_of=2027-03-15'
    )
    expect(cellHref(row(rows, 'pool_a:all'), 'accepted', PAST, 3)).toBe(
      '/aid/requests?pool=pool_a&accepted=all&year=2027&as_of=2027-03-15'
    )
  })

  it('below the line: Held shows its count and opens nothing', () => {
    for (const pool of [null, 'pool_b']) {
      const held = belowTheLine(past, pool, PAST).find((l) => l.key === 'held')
      expect(held?.count, String(pool)).not.toBeNull()
      expect(held?.href, String(pool)).toBeNull()
    }
  })
})

describe('a budget link opens every request in its round (end to end; final review I2; R10)', () => {
  it("Needs an offer on a pool: the grid reads the link back to the pool's needs-offer rows, outside money included", () => {
    const href = cellHref(row(budgetRows(BUDGET, EVERY), 'pool_a:all'), 'needs_offer', LIVE, 3)
    const params = new URL(href ?? '', 'http://kindred.test').searchParams
    const view = requestView(params.get('view'))
    const { filters } = gridFiltersFrom(params)
    const needs = (id: string, over: Partial<ApiAidGridRow>) =>
      gridRow({ request_id: id, queues: ['needs_offer'], ...over })
    const rows = [
      // A round needing an offer, in Pool A.
      needs('reqcounted00001', { rounds: [roundOut(1, 'needs_offer')] }),
      needs('reqcounted00002', {
        rounds: [roundOut(1, 'posted', { posted: 900 }), roundOut(2, 'needs_offer')],
      }),
      // Outside the budget: opens too (R10).
      needs('reqoutside00001', {
        rounds: [
          roundOut(1, 'posted', { posted: 900 }),
          roundOut(2, 'needs_offer', { counts_toward_budget: false }),
        ],
      }),
      // Another pool: not opened.
      needs('reqpoolb0000001', { pool: 'pool_b', rounds: [roundOut(1, 'needs_offer')] }),
      // Posted, in no queue: not opened.
      gridRow({
        request_id: 'reqposted000001',
        rounds: [roundOut(1, 'posted', { posted: 900 })],
        queues: [],
      }),
    ]
    expect(view.key).toBe('needs_offer')
    // The outside-money round opens too: a link opens every request in the round (R10).
    expect(filterRows(rows, view.key, filters).map((r) => r.request_id)).toEqual([
      'reqcounted00001',
      'reqcounted00002',
      'reqoutside00001',
    ])
  })

  /** The rows a link opens, read back through the grid's own parsers. */
  const opened = (href: string | null, rows: readonly ApiAidGridRow[]) => {
    const params = new URL(href ?? '', 'http://kindred.test').searchParams
    const { filters } = gridFiltersFrom(params)
    return filterRows(rows, requestView(params.get('view')).key, filters).map((r) => r.request_id)
  }
  const queued = (
    id: string,
    queue: 'needs_offer' | 'pending_approval',
    over: Partial<ApiAidGridRow>
  ) => gridRow({ request_id: id, queues: [queue], ...over })
  const NEEDS_ROWS = [
    // Round 1 needs the offer, Pool A.
    queued('reqround1a0001', 'needs_offer', { rounds: [roundOut(1, 'needs_offer')] }),
    // Round 2 needs the offer; Round 1 is posted.
    queued('reqround2a0001', 'needs_offer', {
      stage: { round: 2, code: 'needs_offer', label: 'R2 · Needs an offer' },
      rounds: [roundOut(1, 'posted', { posted: 900 }), roundOut(2, 'needs_offer')],
    }),
    // Round 1 needs the offer, outside the budget: opens too (R10).
    queued('reqround1out01', 'needs_offer', {
      rounds: [roundOut(1, 'needs_offer', { counts_toward_budget: false })],
    }),
    // Round 1 needs the offer, Pool B.
    queued('reqround1b0001', 'needs_offer', {
      pool: 'pool_b',
      rounds: [roundOut(1, 'needs_offer')],
    }),
  ]

  it("a round's Needs an offer opens every request in that round, not another round's (fix-wave addition)", () => {
    const rows = budgetRows(BUDGET, EVERY)
    expect(opened(cellHref(row(rows, 'pool_a:1'), 'needs_offer', LIVE, 3), NEEDS_ROWS)).toEqual([
      'reqround1a0001',
      'reqround1out01',
    ])
    expect(opened(cellHref(row(rows, 'pool_a:2'), 'needs_offer', LIVE, 3), NEEDS_ROWS)).toEqual([
      'reqround2a0001',
    ])
    // The strip's Round 1 count is the season's: both pools, Round 1 only.
    const strip = stripRounds(BUDGET.strip, LIVE)[0]?.counts.find(
      (c) => c.measure === 'needs_offer'
    )
    expect(opened(strip?.href ?? null, NEEDS_ROWS)).toEqual([
      'reqround1a0001',
      'reqround1out01',
      'reqround1b0001',
    ])
  })

  it("a round's amber line opens every request in that round that is posted and not reconciled (Task 7 I1)", () => {
    const unreconciled = (id: string, over: Partial<ApiAidGridRow>) =>
      gridRow({ request_id: id, queues: ['not_reconciled'], ...over })
    const rowsOut = [
      // Posted in Round 1, Pool A: listed on Pool A and on its Round 1 line.
      unreconciled('reqr1posted0001', { rounds: [roundOut(1, 'posted', { posted: 900 })] }),
      // Posted in Round 1 outside the budget: opens too (R10).
      unreconciled('reqr1outside001', {
        rounds: [roundOut(1, 'posted', { posted: 900, counts_toward_budget: false })],
      }),
      // Round 1 posted, Round 2 only needs an offer: not Round 2's unconfirmed.
      unreconciled('reqr2needs00001', {
        rounds: [roundOut(1, 'posted', { posted: 900 }), roundOut(2, 'needs_offer')],
      }),
      // Pool B, Round 1 posted.
      unreconciled('reqpoolb0000001', {
        pool: 'pool_b',
        rounds: [roundOut(1, 'posted', { posted: 900 })],
      }),
    ]
    const rows = budgetRows(BUDGET, EVERY)
    const on = (key: string) => opened(confirmedHref(row(rows, key), LIVE), rowsOut)
    const poolA = ['reqr1posted0001', 'reqr1outside001', 'reqr2needs00001']
    expect(on('pool_a:1')).toEqual(poolA)
    expect(on('pool_a:2')).toEqual([])
    expect(on('pool_a:all')).toEqual(poolA)
    expect(on('total')).toEqual([...poolA, 'reqpoolb0000001'])
  })

  it("a round's Pending approval opens every request in that round (fix-wave addition)", () => {
    const pendingRows = [
      queued('reqpend3a00001', 'pending_approval', {
        stage: { round: 3, code: 'pending_approval', label: 'R3 · Pending approval' },
        rounds: [
          roundOut(1, 'posted', { posted: 900 }),
          roundOut(3, 'pending_approval', { pending_approval: 450 }),
        ],
      }),
      // Pending on Round 2, with a Round 3 needing an offer: not Round 3's pending.
      queued('reqpend2a00001', 'pending_approval', {
        stage: { round: 2, code: 'pending_approval', label: 'R2 · Pending approval' },
        rounds: [
          roundOut(2, 'pending_approval', { pending_approval: 300 }),
          roundOut(3, 'needs_offer'),
        ],
      }),
      // Round 3 pending, outside the budget: opens too (R10).
      queued('reqpend3out001', 'pending_approval', {
        stage: { round: 3, code: 'pending_approval', label: 'R3 · Pending approval' },
        rounds: [
          roundOut(3, 'pending_approval', { pending_approval: 200, counts_toward_budget: false }),
        ],
      }),
    ]
    const rows = budgetRows(BUDGET, EVERY)
    expect(
      opened(cellHref(row(rows, 'pool_a:3:pending'), 'needs_offer', LIVE, 3), pendingRows)
    ).toEqual(['reqpend3a00001', 'reqpend3out001'])
    const strip = stripRounds(BUDGET.strip, LIVE)[2]?.counts.find(
      (c) => c.measure === 'pending_approval'
    )
    expect(opened(strip?.href ?? null, pendingRows)).toEqual(['reqpend3a00001', 'reqpend3out001'])
  })

  it("a round's Posted and Accepted open the rows posted in that round, though they have moved on (owner 10-06)", () => {
    const postedRows = [
      // Posted and accepted in Round 1, now needing an offer in Round 2: still Round 1's figure.
      gridRow({
        request_id: 'reqmovedon00001',
        rounds: [
          roundOut(1, 'posted', { posted: 900, accepted: true }),
          roundOut(2, 'needs_offer'),
        ],
        stage: { round: 2, code: 'needs_offer', label: 'R2 · Needs an offer' },
        queues: ['needs_offer'],
      }),
      // Posted in Round 1, not accepted.
      gridRow({
        request_id: 'requnaccept0001',
        rounds: [roundOut(1, 'posted', { posted: 700 })],
        stage: { round: 1, code: 'posted', label: 'R1 · Posted' },
        queues: [],
      }),
      // Posted in Round 1, then reversed in CampMinder (D54).
      gridRow({
        request_id: 'reqclawed000001',
        rounds: [roundOut(1, 'posted', { posted: 900, accepted: true, clawed_back: true })],
        stage: { round: 1, code: 'posted', label: 'R1 · Posted' },
        queues: [],
      }),
      // Posted in Round 1 and accepted, outside the budget.
      gridRow({
        request_id: 'reqoutside00001',
        rounds: [
          roundOut(1, 'posted', { posted: 500, accepted: true, counts_toward_budget: false }),
        ],
        stage: { round: 1, code: 'accepted', label: 'R1 · Accepted' },
        queues: [],
      }),
    ]
    const strip = stripRounds(BUDGET.strip, LIVE)[0]?.counts
    const href = (measure: 'posted' | 'accepted') =>
      strip?.find((c) => c.measure === measure)?.href ?? null
    const postedIn1 = ['reqmovedon00001', 'requnaccept0001', 'reqoutside00001']
    expect(opened(href('posted'), postedRows)).toEqual(postedIn1)
    expect(opened(href('accepted'), postedRows)).toEqual(['reqmovedon00001', 'reqoutside00001'])
    const rows = budgetRows(BUDGET, EVERY)
    expect(opened(cellHref(row(rows, 'pool_a:1'), 'posted', LIVE, 3), postedRows)).toEqual(
      postedIn1
    )
    expect(opened(cellHref(row(rows, 'pool_a:all'), 'accepted', LIVE, 3), postedRows)).toEqual([
      'reqmovedon00001',
      'reqoutside00001',
    ])
  })
})

describe('below the line (§5.3; D44, D121; read 3)', () => {
  it("shows the total's outside grants, the outside-budget type, and the held requests", () => {
    const lines = belowTheLine(BUDGET, null, LIVE)
    expect(lines.map((l) => [l.key, l.label, l.amount])).toEqual([
      ['grants', 'Outside grants on requests', 44300],
      ['grants_off_requests', 'Outside grants on no request', 5400],
      ['outside_type:outside', 'Funded outside the budget', 21840],
      ['held', 'Held requests', null],
    ])
    expect(lines[0]?.count).toEqual({ families: 14, requests: 16 })
    expect(lines[0]?.href).toBeNull()
    expect(lines[2]?.count).toEqual({ families: 9, requests: 10 })
    expect(lines[2]?.note).toBe('$21,840 of it posted')
    expect(lines[2]?.href).toBeNull()
    expect(lines[3]?.count).toEqual({ families: 7, requests: 10 })
    expect(lines[3]?.note).toBe('amount unknown until resolved')
    expect(lines[3]?.href).toBe('/aid/requests?view=holds&year=2027')
  })

  it("shows one pool's own, and opens its held requests on that pool", () => {
    const lines = belowTheLine(BUDGET, 'pool_b', LIVE)
    expect(lines.map((l) => l.key)).toEqual(['grants', 'held'])
    expect(lines[0]?.count).toEqual({ families: 2, requests: 2 })
    expect(lines[1]?.href).toBe('/aid/requests?view=holds&pool=pool_b&year=2027')
  })

  it('adds the per-type outside amounts up to the read’s outside_budget', () => {
    for (const pool of [null, 'pool_a', 'pool_b', '']) {
      const scope = scopePool(BUDGET, pool)
      const typed = (scope?.decision_types ?? []).filter((t) => !t.counts_toward_budget)
      const sum = typed.reduce((acc, t) => acc + toCents(t.amount ?? 0), 0)
      expect(sum).toBe(toCents(scope?.below.outside_budget ?? 0))
    }
  })

  it('gives one line per outside-budget type, in the server order, and never an in-budget one', () => {
    const two = structuredClone(BUDGET)
    const total = two.total
    total.decision_types = [
      ...(total.decision_types ?? []),
      {
        key: 'sponsor',
        label: 'Sponsor-funded',
        counts_toward_budget: false,
        amount: 100,
        posted: null,
        own: 0,
        requests: { families: 1, requests: 1 },
      },
    ]
    const lines = belowTheLine(two, null, LIVE)
    expect(lines.map((l) => l.key)).toEqual([
      'grants',
      'grants_off_requests',
      'outside_type:outside',
      'outside_type:sponsor',
      'held',
    ])
    expect(lines[3]?.amount).toBe(100)
    expect(lines[3]?.note).toBeNull()
    expect(lines.map((l) => l.label)).not.toContain('Standard award')
    expect(lines.map((l) => l.label)).not.toContain('Appeal')
  })

  it('keys a key-null outside type as outside_type:none', () => {
    const odd = structuredClone(BUDGET)
    odd.total.decision_types = [
      {
        key: null,
        label: 'Unnamed outside',
        counts_toward_budget: false,
        amount: 50,
        posted: 50,
        own: 0,
        requests: { families: 1, requests: 1 },
      },
    ]
    expect(belowTheLine(odd, null, LIVE).map((l) => l.key)).toContain('outside_type:none')
  })

  it('falls back to one aggregate line only when no type line is outside the budget', () => {
    const bare = structuredClone(BUDGET)
    bare.total.decision_types = []
    const lines = belowTheLine(bare, null, LIVE)
    expect(lines.map((l) => l.key)).toEqual([
      'grants',
      'grants_off_requests',
      'outside_budget',
      'held',
    ])
    expect(lines[2]?.label).toBe("Decision types that don't count toward the budget")
    expect(lines[2]?.amount).toBe(21840)
    expect(lines[2]?.note).toBe('$21,840 of it posted')
    // Never both: with typed lines present there is no aggregate (the main fixture).
    expect(belowTheLine(BUDGET, null, LIVE).map((l) => l.key)).not.toContain('outside_budget')
  })

  it('keeps "—" where a past date leaves a figure empty', () => {
    const lines = belowTheLine(pastBudget(), null, PAST)
    expect(lines[0]?.amount).toBeNull()
    expect(lines[0]?.count).toBeNull()
    const outside = lines.find((l) => l.key === 'outside_type:outside')
    expect(outside?.amount).toBeNull()
    expect(outside?.count).toBeNull()
    const held = lines[lines.length - 1]
    expect(held?.key).toBe('held')
    expect(held?.count).toBeNull()
    expect(held?.href).toBeNull()
  })
})

describe('in the budget, by decision type (read 3; owner ⚠2: lead with own)', () => {
  it("leads with each type's own, then its rounds' total, two plain figures (final review ⚠1)", () => {
    const lines = budgetTypeLines(BUDGET, null)
    expect(lines.map((l) => [l.key, l.label, l.lead, l.amount])).toEqual([
      ['type:standard', 'Standard award', 14400, 751970],
      ['type:appeal', 'Appeal', 4200, 95540],
      // The key-null line leads with the $0 own the server sends.
      ['type:none', 'No named decision type', 0, 1200],
    ])
    expect(lines[0]?.count).toEqual({ families: 324, requests: 345 })
    // No "in rounds totalling" note: the rounds' total is its own column.
    for (const line of lines) expect(line).not.toHaveProperty('note')
  })

  it('never lists an outside-budget type, and keeps the key-null line for one pool', () => {
    expect(budgetTypeLines(BUDGET, null).map((l) => l.key)).not.toContain('type:outside')
    expect(budgetTypeLines(BUDGET, 'pool_a').map((l) => l.key)).toEqual([
      'type:standard',
      'type:appeal',
    ])
    expect(budgetTypeLines(BUDGET, '').map((l) => l.key)).toEqual(['type:none'])
  })

  it("gives one pool's own and rounds' total", () => {
    const lines = budgetTypeLines(BUDGET, 'pool_b')
    expect(lines).toHaveLength(1)
    expect(lines[0]?.lead).toBe(2400)
    expect(lines[0]?.amount).toBe(52400)
  })

  it('is empty for a pool the season does not have', () => {
    expect(budgetTypeLines(BUDGET, 'pool_zz')).toEqual([])
  })

  it('reads "—" where a past date masks amount, own and requests', () => {
    const lines = budgetTypeLines(pastBudget(), null)
    expect(lines.map((l) => l.key)).toEqual(['type:standard', 'type:appeal', 'type:none'])
    for (const line of lines) {
      expect(line.lead).toBeNull()
      expect(line.amount).toBeNull()
      expect(line.count).toBeNull()
    }
  })
})

describe('the URL and the download (D15, D70, §11)', () => {
  it('names the download per D70', () => {
    expect(budgetCsvName(2027, 'Pool A', '2027-03-15')).toBe(
      'camperships-season-rounds-budget-pool-a-2027-as-of-2027-03-15.csv'
    )
    expect(budgetCsvName(2027, null, null)).toBe('camperships-season-rounds-budget-2027.csv')
  })
})

describe('the confirmed share under Posted (D153; owner ruling 2026-10-02)', () => {
  const rows = budgetRows(BUDGET, EVERY)

  it("words the server's count and amount, on pool, round and total lines alike", () => {
    expect(confirmedWords(row(rows, 'pool_a:1'))).toBe('4 not yet confirmed · $5,200')
    expect(confirmedWords(row(rows, 'pool_a:2'))).toBe('2 not yet confirmed · $1,800')
    expect(confirmedWords(row(rows, 'pool_a:all'))).toBe('6 not yet confirmed · $7,000')
    expect(confirmedWords(row(rows, 'total'))).toBe('6 not yet confirmed · $7,000')
  })

  it('says nothing when the read sends none, or a count of 0', () => {
    expect(confirmedWords(row(rows, 'pool_a:3'))).toBeNull()
    const zero = { ...row(rows, 'pool_a:1') }
    const none = {
      ...zero,
      cell: { ...zero.cell, unconfirmed: { count: 0, families: 0, amount: 0 } },
    }
    expect(confirmedWords(none)).toBeNull()
    expect(confirmedWords(row(budgetRows(pastBudget(), EVERY), 'pool_a:1'))).toBeNull()
  })

  it("keeps it off the Pending approval line, which shares its round's cell", () => {
    // Round 3 carries both a pending amount and a confirmed share, so its two lines share the share.
    const round3 = { unconfirmed: { count: 1, families: 1, amount: 400 } }
    const poolA = BUDGET.pools[0]
    if (poolA === undefined) throw new Error('no Pool A')
    const budget = {
      ...BUDGET,
      pools: [
        { ...poolA, rounds: poolA.rounds.map((r) => (r.round === 3 ? { ...r, ...round3 } : r)) },
      ],
    }
    const both = budgetRows(budget, EVERY)
    expect(confirmedWords(row(both, 'pool_a:3'))).toBe('1 not yet confirmed · $400')
    expect(confirmedWords(row(both, 'pool_a:3:pending'))).toBeNull()
  })

  it("opens Not reconciled on the row's pool, and on none for the total", () => {
    expect(confirmedHref(row(rows, 'pool_a:1'), LIVE)).toBe(
      '/aid/requests?view=not-reconciled&pool=pool_a&posted=1&year=2027'
    )
    expect(confirmedHref(row(rows, 'pool_a:all'), LIVE)).toBe(
      '/aid/requests?view=not-reconciled&pool=pool_a&posted=all&year=2027'
    )
    expect(confirmedHref(row(rows, 'total'), LIVE)).toBe(
      '/aid/requests?view=not-reconciled&posted=all&year=2027'
    )
  })

  it('opens the rows posted in that round, though they have moved on to the next (owner 10-06)', () => {
    // Posted in Round 1 and short in CampMinder, now needing an offer in Round 2.
    const movedOn = gridRow({
      request_id: 'reqmovedon00001',
      rounds: [roundOut(1, 'posted', { posted: 900 }), roundOut(2, 'needs_offer')],
      stage: { round: 2, code: 'needs_offer', label: 'R2 · Needs an offer' },
      queues: ['not_reconciled', 'needs_offer'],
    })
    // Not reconciled, but posted only in Round 2.
    const round2 = gridRow({
      request_id: 'reqroundtwo0001',
      rounds: [roundOut(2, 'posted', { posted: 300 })],
      stage: { round: 2, code: 'posted', label: 'R2 · Posted' },
      queues: ['not_reconciled'],
    })
    const params = new URL(confirmedHref(row(rows, 'pool_a:1'), LIVE) ?? '', 'http://x.test')
      .searchParams
    expect(params.get('round')).toBeNull()
    const { filters } = gridFiltersFrom(params)
    const view = requestView(params.get('view')).key
    expect(filterRows([movedOn, round2], view, filters).map((r) => r.request_id)).toEqual([
      'reqmovedon00001',
    ])
  })

  it('opens nothing for the No pool line, for nothing to say, or on a past date', () => {
    const noPool = { ...row(rows, 'pool_a:1'), pool: '' }
    expect(confirmedHref(noPool, LIVE)).toBeNull()
    expect(confirmedHref(row(rows, 'pool_a:3'), LIVE)).toBeNull()
    // Not reconciled is today's queue: the Requests page refuses it on a past date.
    const unmasked = budgetRows(pastBudgetUnmasked(), EVERY)
    expect(confirmedWords(row(unmasked, 'pool_a:1'))).toBe('4 not yet confirmed · $5,200')
    expect(confirmedHref(row(unmasked, 'pool_a:1'), PAST)).toBeNull()
  })
})
