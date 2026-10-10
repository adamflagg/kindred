/**
 * The Spend table as data (Scenarios addendum §S5 E; final mock scenarios-3). The server does every sum (§S2 rule 2);
 * this file picks and words them, decides each change's colour (footnote 11: green leaves more money, amber leaves
 * less) and rounds a projection to $1,000, which is all the client does with it. Pure.
 */
import type { ApiAidScenarioResults, ApiAidScenarioTooEarly } from '../../../../types/api-types'
import { MINUS, formatWholeMoney, toCents } from '../../kit/money'
import type { PoolCardModel } from '../budgetCards'

type Results = ApiAidScenarioResults
type Pool = Results['pools'][number]

export type Tone = 'more' | 'less'

export interface Change {
  readonly text: string
  readonly tone: Tone
}

/** A money change against the starting point: shown from $1. Remaining up, or spend down, leaves more money. */
export function moneyChange(
  now: number | null | undefined,
  from: number | null | undefined,
  kind: 'remaining' | 'spend'
): Change | null {
  if (now === null || now === undefined || from === null || from === undefined) return null
  const cents = toCents(now) - toCents(from)
  if (Math.abs(cents) < 100) return null
  const up = cents > 0
  return {
    text: `${up ? '+' : MINUS}${formatWholeMoney(Math.abs(cents) / 100)}`,
    tone: (kind === 'remaining') === up ? 'more' : 'less',
  }
}

export const roughly = (value: number) => formatWholeMoney(Math.round(value / 1000) * 1000)

const spent = (p: { round1: number; round2: number; round3: number }) =>
  p.round1 + p.round2 + p.round3

/** A pool as PR 8's bar reads it (`poolBar`): Round 1, 2 and 3 end to end on max(Allocated, Committed). */
export function poolCard(pool: Pool): PoolCardModel {
  const remaining = pool.remaining ?? null
  return {
    key: pool.pool,
    label: pool.label,
    share: null,
    allocated: pool.allocated ?? pool.round1_allocated ?? null,
    committed: spent(pool),
    remaining,
    overShare: remaining !== null && toCents(remaining) < 0,
    parts: [
      { round: 1, committed: pool.round1 },
      { round: 2, committed: pool.round2 },
      { round: 3, committed: pool.round3 },
    ],
  }
}

/** The dotted mark at the starting point's committed, on the bar's own scale; none within $1 of now. */
export function ghostPct(card: PoolCardModel, fromCommitted: number | null): number | null {
  const committed = card.committed ?? 0
  if (fromCommitted === null || Math.abs(toCents(fromCommitted) - toCents(committed)) < 100)
    return null
  const base = Math.max(card.allocated ?? 0, committed) || 1
  return Math.min(100, (100 * fromCommitted) / base)
}

export interface SpendRow {
  readonly key: string
  readonly label: string
  readonly round1: number
  readonly round2: number
  readonly round3: number
  readonly spend: number
  readonly remaining: number | null
  /** A pool below $0 reads amber, the total below $0 red (footnote 2): the view picks the ink. */
  readonly over: boolean
  readonly vs: Change | null
  /** The Remaining projected at the season's end, unrounded; null where the server sent none. */
  readonly projected: number | null
  /** The Used meter: a pool's bar and the dotted mark at the starting point; the total has neither. */
  readonly card: PoolCardModel | null
  readonly ghostPct: number | null
}

/**
 * The Spend table's rows (final mock; scenarios-3): one per pool in the rules' order, then the total. Money on no pool
 * counts in the total, not as a row. The server did every sum; this reads them, and colours each Remaining change
 * (green leaves more money, amber less).
 */
export function spendTable(
  draft: Results,
  from: Results | null
): { pools: SpendRow[]; total: SpendRow } {
  const projected = new Map(
    (draft.projection?.pools ?? []).map((p) => [p.pool, p.remaining ?? null])
  )
  const pools = draft.pools
    .filter((pool) => pool.pool !== '')
    .map((pool): SpendRow => {
      const before = from?.pools.find((p) => p.pool === pool.pool) ?? null
      const card = poolCard(pool)
      return {
        key: pool.pool,
        label: pool.label,
        round1: pool.round1,
        round2: pool.round2,
        round3: pool.round3,
        spend: spent(pool),
        remaining: pool.remaining ?? null,
        over: card.overShare,
        vs: moneyChange(pool.remaining, before?.remaining, 'remaining'),
        projected: projected.get(pool.pool) ?? null,
        card,
        ghostPct: ghostPct(card, before === null ? null : spent(before)),
      }
    })
  const remaining = draft.remaining ?? null
  const total: SpendRow = {
    key: 'total',
    label: 'Total',
    round1: draft.round1,
    round2: draft.round2,
    round3: draft.round3,
    spend: spent(draft),
    remaining,
    over: remaining !== null && toCents(remaining) < 0,
    vs: moneyChange(remaining, from?.remaining, 'remaining'),
    projected: draft.projection?.remaining ?? null,
    card: null,
    ghostPct: null,
  }
  return { pools, total }
}

/** "$306k", the mock's `$k`: a projection to the nearest $1,000, shown after a "≈". */
export function kilo(value: number): string {
  const thousands = Math.round(Math.abs(value) / 1000)
  return `${value < 0 && thousands > 0 ? MINUS : ''}$${thousands.toLocaleString('en-US')}k`
}

/** The heading line's muted words: "Remaining $243,550 of $1,000,000 · 56 applications held". After the lock, with
 * Round 1 settings that differ from the rules in effect, posted Round 1 stands (N10) in place of the applications. */
export function spendHeading(draft: Results, postedStands: boolean, pricedOn: string): string {
  const budget = formatWholeMoney(draft.allocated ?? draft.round1_allocated ?? null)
  return `Remaining ${formatWholeMoney(draft.remaining ?? null)} of ${budget} · ${
    postedStands ? 'posted Round 1 stands' : pricedOn
  }`
}

/** The Projected cells' title: what the figure is, or why there is none (too early, under 5% of last year's). */
export function projectedTitle(draft: Results): string {
  if (draft.projection === null || draft.projection === undefined) {
    return tooEarlyWords(draft.too_early) ?? 'No projection yet'
  }
  return `Projected Remaining: if the rest of the season's applications arrive like last year's (about ${String(Math.round(draft.projection.share * 100))}% are in by this week)`
}

/** Why there is no projection (§S5 E; N8): under 5% of last year's applications in (owner 10-07) the server sends
 * `tooEarly` in place of a projection, and the words say so; null when it sent neither. */
export function tooEarlyWords(tooEarly: ApiAidScenarioTooEarly | null | undefined): string | null {
  if (tooEarly === null || tooEarly === undefined) return null
  // Rounded DOWN, so a share just under the 5% floor never reads "about 5%" on a too-early line.
  const early = Math.floor(tooEarly.share * 100)
  const share = early < 1 ? 'under 1%' : `about ${String(early)}%`
  return `Too early to project: ${share} of last year's applications had arrived by this point`
}

export interface BelowPart {
  readonly lead: string
  readonly figure: string
  readonly tail: string
}

/** "‹27› at minimum · ‹3› held · [‹n› appeals keyed ·] unmet ask ‹$28,536›" (the figures bold). */
export function belowParts(results: Results, locked: boolean): BelowPart[] {
  const parts: BelowPart[] = [
    { lead: '', figure: String(results.at_minimum), tail: ' at minimum' },
    { lead: '', figure: String(results.held), tail: ' held' },
  ]
  if (locked) parts.push({ lead: '', figure: String(results.appeals ?? 0), tail: ' appeals keyed' })
  parts.push({ lead: 'unmet ask ', figure: formatWholeMoney(results.round1_unmet), tail: '' })
  return parts
}

export interface BelowRow {
  readonly label: string
  readonly draft: string
  readonly from: string
  readonly change: string
}

const countChange = (now: number, from: number | undefined) => {
  if (from === undefined || now === from) return ''
  return `${now > from ? '+' : MINUS}${String(Math.abs(now - from))}`
}

/** The Below the line fold's rows (§S5 E). Counts and asks, so their changes are plain, never coloured. */
export function belowRows(draft: Results, from: Results | null, locked: boolean): BelowRow[] {
  const money = (now: number, then: number | undefined) => ({
    draft: formatWholeMoney(now),
    from: then === undefined ? '—' : formatWholeMoney(then),
    change: then === undefined ? '' : (moneyChange(now, then, 'spend')?.text ?? ''),
  })
  const count = (now: number, then: number | undefined) => ({
    draft: String(now),
    from: then === undefined ? '—' : String(then),
    change: countChange(now, then),
  })
  const rows: BelowRow[] = [
    { label: 'At the minimum', ...count(draft.at_minimum, from?.at_minimum) },
    { label: 'Held: no amount yet', ...count(draft.held, from?.held) },
  ]
  if (locked) {
    rows.push({
      label: 'Appeals keyed so far',
      ...count(draft.appeals ?? 0, from === null ? undefined : (from.appeals ?? 0)),
    })
    rows.push({
      label: '…asking',
      ...money(draft.appeals_asked ?? 0, from === null ? undefined : (from.appeals_asked ?? 0)),
    })
  }
  rows.push({
    label: locked ? 'Round 1 unmet ask, not yet appealed' : 'Round 1 unmet ask',
    ...money(draft.round1_unmet, from?.round1_unmet),
  })
  return rows
}

export interface TierRow {
  readonly tier: number
  readonly requests: number
  readonly round1: string
  readonly round2: string | null
  readonly change: Change | null
}

/** The By tier fold (§S5 E): each tier's Round 1 (and Round 2 after the lock), and its Round 1 + 2 change. */
export function byTierRows(draft: Results, from: Results | null, locked: boolean): TierRow[] {
  return draft.by_tier.map((row) => {
    const before = from?.by_tier.find((t) => t.tier === row.tier)
    const both = row.round1 + (row.round2 ?? 0)
    return {
      tier: row.tier,
      requests: row.requests,
      round1: formatWholeMoney(row.round1),
      round2: locked ? formatWholeMoney(row.round2 ?? 0) : null,
      change:
        before === undefined
          ? null
          : moneyChange(both, before.round1 + (before.round2 ?? 0), 'spend'),
    }
  })
}
