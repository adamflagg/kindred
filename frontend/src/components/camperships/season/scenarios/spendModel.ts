/**
 * The spend strip as data (Scenarios addendum §S5 E). The server does every sum (§S2 rule 2); this file picks and
 * words them, decides each change's colour (footnote 11: green leaves more money, amber leaves less) and rounds a
 * projection to $1,000, which is all the client does with it. Pure.
 */
import type {
  ApiAidScenarioProjection,
  ApiAidScenarioResults,
  ApiAidScenarioTooEarly,
} from '../../../../types/api-types'
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

export interface LegendItem {
  readonly round: 1 | 2 | 3
  readonly text: string
  readonly change: Change | null
}

export interface StripPool {
  readonly card: PoolCardModel
  readonly remainingChange: Change | null
  readonly ghostPct: number | null
  readonly projected: string | null
  readonly legend: readonly LegendItem[]
}

/** One cell per pool in the rules' order; money on no pool counts in the total, not as a cell. */
export function stripPools(draft: Results, from: Results | null, locked: boolean): StripPool[] {
  const projected = new Map(
    (draft.projection?.pools ?? []).map((p) => [p.pool, p.remaining ?? null])
  )
  return draft.pools
    .filter((pool) => pool.pool !== '')
    .map((pool) => {
      const before = from?.pools.find((p) => p.pool === pool.pool) ?? null
      const card = poolCard(pool)
      const legend: LegendItem[] = [
        // N10: once Round 1 posts, posted Round 1 stands, so its change is left out.
        {
          round: 1,
          text: `R1 ${formatWholeMoney(pool.round1)}`,
          change: locked ? null : moneyChange(pool.round1, before?.round1, 'spend'),
        },
      ]
      if (locked)
        legend.push({
          round: 2,
          text: `R2 ${formatWholeMoney(pool.round2)}`,
          change: moneyChange(pool.round2, before?.round2, 'spend'),
        })
      if (toCents(pool.round3) > 0)
        legend.push({
          round: 3,
          text: `R3 ${formatWholeMoney(pool.round3)}`,
          change: moneyChange(pool.round3, before?.round3, 'spend'),
        })
      const ahead = projected.get(pool.pool)
      return {
        card,
        remainingChange: moneyChange(pool.remaining, before?.remaining, 'remaining'),
        ghostPct: ghostPct(card, before === null ? null : spent(before)),
        projected: ahead === undefined || ahead === null ? null : `projected ${roughly(ahead)}`,
        legend,
      }
    })
}

export interface StripLead {
  readonly remaining: number | null
  readonly overBudget: boolean
  readonly change: Change | null
  readonly ofWords: string
}

/** The lead column (§S5 E; N1). `postedStands`: after the lock, the sandbox's Round 1 settings differ from the
 * rules in effect (DraftOut.differs_in), so its posted Round 1 stands (N10). */
export function stripLead(draft: Results, from: Results | null, postedStands: boolean): StripLead {
  const remaining = draft.remaining ?? null
  const n = draft.requests
  return {
    remaining,
    overBudget: remaining !== null && toCents(remaining) < 0,
    change: moneyChange(remaining, from?.remaining, 'remaining'),
    ofWords: `of ${formatWholeMoney(draft.allocated ?? draft.round1_allocated ?? null)} · ${
      postedStands ? 'posted Round 1 stands' : `${String(n)} application${n === 1 ? '' : 's'}`
    }`,
  }
}

/** The projection line (§S5 E; N8): muted, never coloured; dimmed after the lock; absent with no projection. Under 5%
 * of last year's applications in (owner 10-07) the server sends `tooEarly` instead, and the line says so. */
export function projectionWords(
  projection: ApiAidScenarioProjection | null | undefined,
  locked: boolean,
  tooEarly?: ApiAidScenarioTooEarly | null
): { text: string; dimmed: boolean } | null {
  if (projection === null || projection === undefined) {
    if (tooEarly === null || tooEarly === undefined) return null
    return {
      text: `Too early to project: about ${String(Math.round(tooEarly.share * 100))}% of last year's applications had arrived by this point`,
      dimmed: locked,
    }
  }
  const pct = String(Math.round(projection.share * 100))
  const expected = `about ${String(projection.requests)} expected`
  return locked
    ? {
        text: `≈${pct}% of last year's applications had arrived by this point → ${expected} · R1 + R2 ≈ ${roughly(projection.round1_and_2)}`,
        dimmed: true,
      }
    : {
        text: `Projected: by this point last year ${pct}% had arrived → ${expected} · if the rest arrive like last year: Round 1 ≈ ${roughly(projection.round1)}`,
        dimmed: false,
      }
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

/** The Below the line popover's rows (§S5 E). Counts and asks, so their changes are plain, never coloured. */
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

/** The By tier popover (§S5 E): each tier's Round 1 (and Round 2 after the lock), and its Round 1 + 2 change. */
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
