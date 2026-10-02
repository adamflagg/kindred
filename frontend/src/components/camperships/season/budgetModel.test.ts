import { describe, expect, it } from 'vitest'

import type { ApiAidGridRow } from '../../../types/api-types'
import { gridFiltersFrom } from '../household/queueWalk'
import type { AidView } from '../kit/asOf'
import { toCents } from '../kit/money'
import { gridRow, roundOut } from '../requests/gridFixtures'
import { filterRows, requestView } from '../requests/views'
import { BUDGET, pastBudget, pastBudgetUnmasked } from './budgetFixtures'
import {
  BUDGET_CSV_HEADERS,
  belowTheLine,
  budgetCsvName,
  budgetCsvRows,
  budgetRows,
  budgetTypeLines,
  cellCount,
  cellHref,
  cellValue,
  cellWords,
  overWords,
  parseFolded,
  pendingNote,
  scopePool,
  stripRounds,
  toggleFolded,
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

  it('opens posted and accepted as All filtered to that round and tick', () => {
    const [r1] = stripRounds(BUDGET.strip, LIVE)
    const href = (measure: string) => r1?.counts.find((c) => c.measure === measure)?.href
    expect(href('posted')).toBe('/aid/requests?view=all&round=1&tick=posted&counted=1&year=2027')
    expect(href('accepted')).toBe(
      '/aid/requests?view=all&round=1&tick=accepted&counted=1&year=2027'
    )
  })

  it('opens needs an offer, held and pending approval on their own Requests views', () => {
    const rounds = stripRounds(BUDGET.strip, LIVE)
    const href = (round: number, measure: string) =>
      rounds[round - 1]?.counts.find((c) => c.measure === measure)?.href
    expect(href(1, 'needs_offer')).toBe('/aid/requests?view=needs-offer&counted=1&year=2027')
    expect(href(1, 'held')).toBe('/aid/requests?view=holds&year=2027')
    expect(href(3, 'pending_approval')).toBe(
      '/aid/requests?view=pending-approval&counted=1&year=2027'
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
      '/aid/requests?view=all&round=1&tick=posted&counted=1&year=2027&as_of=2027-03-15'
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
    expect(cellValue(row(rows, 'total'), 'remaining')).toBe(194890)
  })

  it('says "and N · $X pending approval" with the count the server sent (read 2)', () => {
    const rows = budgetRows(BUDGET, EVERY)
    expect(pendingNote(row(rows, 'pool_a:all'))).toBe('and 1 · $650 pending approval')
    expect(pendingNote(row(rows, 'total'))).toBe('and 1 · $650 pending approval')
    expect(pendingNote(row(rows, 'pool_b:all'))).toBeNull()
    expect(pendingNote(row(rows, 'pool_a:3'))).toBeNull()
  })

  it('falls back to dollars only when the server sent no pending count', () => {
    const bare = structuredClone(BUDGET)
    const poolA = bare.pools[0]
    if (poolA === undefined) throw new Error('no pool')
    poolA.total.pending_approval_count = null
    expect(pendingNote(row(budgetRows(bare, EVERY), 'pool_a:all'))).toBe(
      'and $650 pending approval'
    )
    delete poolA.total.pending_approval_count
    expect(pendingNote(row(budgetRows(bare, EVERY), 'pool_a:all'))).toBe(
      'and $650 pending approval'
    )
  })

  it('says "over allocation" on a pool or round below zero, and "over budget" only on the total (§4.2)', () => {
    const over = structuredClone(BUDGET)
    const firstRound = over.pools[0]?.rounds[0]
    if (firstRound) firstRound.remaining = -1200
    over.total.total.remaining = -1200
    const rows = budgetRows(over, EVERY)
    expect(overWords(row(rows, 'pool_a:1'), 'remaining')).toBe('over allocation')
    expect(overWords(row(rows, 'total'), 'remaining')).toBe('over budget')
    expect(overWords(row(rows, 'pool_a:2'), 'remaining')).toBeNull()
    expect(overWords(row(rows, 'pool_a:1'), 'posted')).toBeNull()
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

  it('reads "n · $X" with n = requests, dollars only when there is no count', () => {
    expect(cellWords(row(rows, 'pool_a:1'), 'needs_offer')).toBe('3 · $8,100')
    expect(cellWords(row(rows, 'pool_a:3:pending'), 'needs_offer')).toBe('1 · $650')
    expect(cellWords(row(rows, 'pool_a:1'), 'posted')).toBe('$764,540')
    const past = row(budgetRows(pastBudget(), EVERY), 'pool_a:1')
    expect(cellCount(past, 'needs_offer')).toBeNull()
    expect(cellWords(past, 'needs_offer')).toBe('—')
    expect(cellWords(past, 'posted')).toBe('$764,540')
  })

  it('uses requests, not families, when they differ', () => {
    const odd = structuredClone(BUDGET)
    const first = odd.pools[0]?.rounds[0]
    if (first) first.needs_offer_count = { families: 2, requests: 5 }
    expect(cellWords(row(budgetRows(odd, EVERY), 'pool_a:1'), 'needs_offer')).toBe('5 · $8,100')
  })
})

describe('where each figure opens (D20, D153)', () => {
  const rows = budgetRows(BUDGET, EVERY)

  it('opens Posted and Accepted as All on the pool, the round and the tick', () => {
    expect(cellHref(row(rows, 'pool_a:2'), 'posted', LIVE, 3)).toBe(
      '/aid/requests?view=all&pool=pool_a&round=2&tick=posted&counted=1&year=2027'
    )
    expect(cellHref(row(rows, 'pool_a:all'), 'accepted', LIVE, 3)).toBe(
      '/aid/requests?view=all&pool=pool_a&tick=accepted&counted=1&year=2027'
    )
    expect(cellHref(row(rows, 'total'), 'posted', LIVE, 3)).toBe(
      '/aid/requests?view=all&tick=posted&counted=1&year=2027'
    )
  })

  it('opens Needs an offer and Pending approval on their views, and Allocated on the rules', () => {
    expect(cellHref(row(rows, 'pool_a:1'), 'needs_offer', LIVE, 3)).toBe(
      '/aid/requests?view=needs-offer&pool=pool_a&counted=1&year=2027'
    )
    expect(cellHref(row(rows, 'pool_a:3:pending'), 'needs_offer', LIVE, 3)).toBe(
      '/aid/requests?view=pending-approval&pool=pool_a&counted=1&year=2027'
    )
    // The approved version that priced the figure, past date or not (plan review I1).
    expect(cellHref(row(rows, 'pool_a:1'), 'allocated', PAST, 3)).toBe(
      '/aid/season/rules?version=3&section=budget&year=2027'
    )
    expect(cellHref(row(rows, 'pool_a:1'), 'allocated', LIVE, null)).toBeNull()
  })

  it('opens nothing for Remaining, a zero, a "—", or a No pool line', () => {
    expect(cellHref(row(rows, 'pool_a:1'), 'remaining', LIVE, 3)).toBeNull()
    expect(cellHref(row(rows, 'pool_b:2'), 'posted', LIVE, 3)).toBeNull()
    expect(cellHref(row(rows, ':1'), 'posted', LIVE, 3)).toBeNull()
    expect(cellHref(row(rows, ':all'), 'allocated', LIVE, 3)).toBeNull()
  })

  it('carries a past date on what it opens', () => {
    expect(cellHref(row(budgetRows(pastBudget(), EVERY), 'pool_a:1'), 'posted', PAST, 3)).toBe(
      '/aid/requests?view=all&pool=pool_a&round=1&tick=posted&counted=1&year=2027&as_of=2027-03-15'
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
    expect(count(1, 'posted')?.href).toBe(
      '/aid/requests?view=all&round=1&tick=posted&counted=1&year=2027&as_of=2027-03-15'
    )
    expect(count(1, 'accepted')?.href).toBe(
      '/aid/requests?view=all&round=1&tick=accepted&counted=1&year=2027&as_of=2027-03-15'
    )
  })

  it('the table: Needs an offer and the Pending approval line open nothing; Posted and Accepted keep the date', () => {
    const rows = budgetRows(past, EVERY)
    for (const key of ['pool_a:1', 'pool_a:all', 'total']) {
      expect(cellValue(row(rows, key), 'needs_offer'), key).not.toBeNull()
      expect(cellHref(row(rows, key), 'needs_offer', PAST, 3), key).toBeNull()
    }
    expect(cellHref(row(rows, 'pool_a:3:pending'), 'needs_offer', PAST, 3)).toBeNull()
    expect(cellHref(row(rows, 'pool_a:1'), 'posted', PAST, 3)).toBe(
      '/aid/requests?view=all&pool=pool_a&round=1&tick=posted&counted=1&year=2027&as_of=2027-03-15'
    )
    expect(cellHref(row(rows, 'pool_a:all'), 'accepted', PAST, 3)).toBe(
      '/aid/requests?view=all&pool=pool_a&tick=accepted&counted=1&year=2027&as_of=2027-03-15'
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

describe('a budget link opens exactly the rows its figure counts (end to end; final review I2)', () => {
  it("Needs an offer on a pool: the grid reads the link back to the pool's counted needs-offer rows", () => {
    const href = cellHref(row(budgetRows(BUDGET, EVERY), 'pool_a:all'), 'needs_offer', LIVE, 3)
    const params = new URL(href ?? '', 'http://kindred.test').searchParams
    const view = requestView(params.get('view'))
    const { filters } = gridFiltersFrom(params)
    const needs = (id: string, over: Partial<ApiAidGridRow>) =>
      gridRow({ request_id: id, queues: ['needs_offer'], ...over })
    const rows = [
      // Counted by the figure: a counted round needing an offer, in Pool A.
      needs('reqcounted00001', { rounds: [roundOut(1, 'needs_offer')] }),
      needs('reqcounted00002', {
        rounds: [roundOut(1, 'posted', { posted: 900 }), roundOut(2, 'needs_offer')],
      }),
      // Not counted: the round needing an offer is outside the budget, though Round 1 counts.
      needs('reqoutside00001', {
        rounds: [
          roundOut(1, 'posted', { posted: 900 }),
          roundOut(2, 'needs_offer', { counts_toward_budget: false }),
        ],
      }),
      // Not counted: another pool.
      needs('reqpoolb0000001', { pool: 'pool_b', rounds: [roundOut(1, 'needs_offer')] }),
      // Not counted: posted, in no queue.
      gridRow({
        request_id: 'reqposted000001',
        rounds: [roundOut(1, 'posted', { posted: 900 })],
        queues: [],
      }),
    ]
    expect(view.key).toBe('needs_offer')
    expect(filterRows(rows, view.key, filters).map((r) => r.request_id)).toEqual([
      'reqcounted00001',
      'reqcounted00002',
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
  it('reads and toggles folded pools', () => {
    expect([...parseFolded('pool_a,pool_b')]).toEqual(['pool_a', 'pool_b'])
    expect(parseFolded(null).size).toBe(0)
    expect(toggleFolded(new Set(['pool_a']), 'pool_b')).toBe('pool_a,pool_b')
    expect(toggleFolded(new Set(['pool_a']), 'pool_a')).toBeNull()
  })

  it('writes the lines on screen, signed and plain, with each count after its dollars', () => {
    expect(BUDGET_CSV_HEADERS).toEqual([
      'Pool',
      'Round',
      'Allocated',
      'Posted',
      'Accepted',
      'Needs an offer',
      'Needs an offer requests',
      'Pending approval',
      'Pending approval requests',
      'Remaining',
    ])
    const rows = budgetRows(BUDGET, { pool: 'pool_a', folded: new Set() })
    expect(budgetCsvRows(rows)).toEqual([
      ['Pool A', '', '950000', '780540', '609000', '13920', '13', '650', '1', '154890'],
      ['Pool A', '1', '800000', '764540', '598300', '8100', '3', '0', '0', '27360'],
      ['Pool A', '2', '110000', '14200', '9800', '5520', '8', '0', '0', '90280'],
      ['Pool A', '3', '40000', '1800', '900', '300', '2', '650', '1', '37250'],
    ])
    expect(budgetCsvName(2027, 'Pool A', '2027-03-15')).toBe(
      'camperships-season-rounds-budget-pool-a-2027-as-of-2027-03-15.csv'
    )
    expect(budgetCsvName(2027, null, null)).toBe('camperships-season-rounds-budget-2027.csv')
  })

  it('leaves a count empty when the server sent none (a past date)', () => {
    const rows = budgetCsvRows(budgetRows(pastBudget(), { pool: 'pool_a', folded: new Set() }))
    expect(rows[1]).toEqual(['Pool A', '1', '800000', '764540', '598300', '', '', '', '', ''])
  })
})
