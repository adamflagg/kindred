/**
 * The bulk confirm in To place (spec §4.10's one exception; D16, D151; P-6; owner ruling Group 3a
 * Q4, review §3 A): which checked lines it takes, what it sends, and its total, labelled an estimate
 * when it holds two or more lines. Pure.
 */
import type { ApiAidPlaceLinesIn, ApiAidToPlaceLine } from '../../../types/api-types'
import { toCents } from '../kit/money'
import { exactAmount, isOpen } from './toPlaceModel'

/** The server's limit on one bulk placement (`PlaceLinesIn.lines`, at most 200). */
export const MAX_BULK_LINES = 200

/**
 * An exact single match (P-6; money-v2.html "one candidate and an exact amount", drawn on
 * "several" only): an open several-requests line whose family holds one request, which the
 * dashboard suggests placing the whole line on, with the exact amount as its evidence. Splits and
 * judgement calls are confirmed one at a time, beside their evidence: a program mismatch is one
 * even with one candidate and an exact amount, since Reclassify may be the right answer (plan
 * review I3).
 */
export function bulkEligible(line: ApiAidToPlaceLine): boolean {
  const suggestion = line.suggestion
  return (
    isOpen(line) &&
    line.reason === 'several' &&
    suggestion !== null &&
    suggestion.parts.length === 1 &&
    line.candidates.length === 1 &&
    suggestion.evidence.some((e) => e.kind === 'amount')
  )
}

export interface BulkLine {
  readonly line: ApiAidToPlaceLine
  /** Checked, but the search hides it (owner ruling 2026-10-02: checks persist across a search). */
  readonly hidden: boolean
}

export interface BulkPlan {
  readonly lines: readonly BulkLine[]
  /** Checked lines a bulk confirm can't take, each with why: confirm them one at a time. */
  readonly leftOut: ReadonlyArray<{ readonly line: ApiAidToPlaceLine; readonly why: string }>
  /** Distinct households (`household_cm_id`), not D26 families: a split family counts twice. */
  readonly households: number
  /** Checked lines the read no longer holds open (placed or left since the click): left out. */
  readonly gone: number
}

/**
 * The one-click button's words (money-v2's "Confirm the N exact single matches…", Title Case). It
 * checks at most the route's 200 (R1-13); past that it says it takes the first 200 of them.
 */
export function exactButtonWords(n: number): string {
  if (n > MAX_BULK_LINES) {
    return `Confirm the First ${String(MAX_BULK_LINES)} of ${String(n)} Exact Single Matches…`
  }
  return `Confirm the ${String(n)} Exact Single ${n === 1 ? 'Match' : 'Matches'}…`
}

/** Why a checked line is left out of the bulk confirm, in staff words. */
function leftOutWhy(line: ApiAidToPlaceLine): string {
  if (line.reason === 'program_mismatch')
    return 'a program mismatch: confirm it beside its evidence'
  if (line.suggestion === null) return 'no suggestion'
  if (line.suggestion.parts.length > 1) return 'a split'
  return 'not an exact single match'
}

/**
 * The plan from the lines as they stand now (§4.10: what you confirm is what's written). The tab
 * derives it from the CURRENT read on every render while the dialog shows, never caching the
 * click's (plan review I4): after a refusal the reads have refreshed, and a line someone else placed
 * meanwhile drops out and is counted in `gone`.
 */
export function bulkPlan(
  open: readonly ApiAidToPlaceLine[],
  selected: ReadonlySet<string>,
  hidden: ReadonlySet<string>,
  /** A line whose own Confirm is still out (`useInFlightLines`): left out, or the batch fails whole (R1-13). */
  saving: (transactionCmId: number) => boolean = () => false
): BulkPlan {
  const openKeys = new Set(open.map((l) => String(l.transaction_cm_id)))
  const checked = open.filter((l) => selected.has(String(l.transaction_cm_id)))
  const takes = (line: ApiAidToPlaceLine) => bulkEligible(line) && !saving(line.transaction_cm_id)
  const lines = checked
    .filter(takes)
    .map((line) => ({ line, hidden: hidden.has(String(line.transaction_cm_id)) }))
  return {
    lines,
    leftOut: checked
      .filter((line) => !takes(line))
      .map((line) => ({
        line,
        why: bulkEligible(line) ? 'still saving: confirm it when it finishes' : leftOutWhy(line),
      })),
    households: new Set(lines.map((b) => b.line.household_cm_id)).size,
    gone: [...selected].filter((k) => !openKeys.has(k)).length,
  }
}

/**
 * ⚠ Number meaning (P-6; the one figure on To place the screen adds up): each line's own preview of
 * what it locks, summed in whole cents. Two lines landing on one request can lock more or less
 * together than apart, so the dialog labels it an estimate whenever it holds two or more lines, and
 * the result lists exactly what was marked posted.
 */
export function estimateLocked(plan: BulkPlan): number {
  return (
    plan.lines.reduce((cents, b) => cents + toCents(b.line.suggestion?.would_lock ?? 0), 0) / 100
  )
}

/**
 * The bulk write: every line's suggested part, one operation, all or nothing. The route refuses
 * `expected_locked` with more than one line; one line sends it, as Confirm does (plan review m6).
 */
export function bulkBody(plan: BulkPlan): ApiAidPlaceLinesIn {
  const [only] = plan.lines
  return {
    lines: plan.lines.map(({ line }) => ({
      transaction_cm_id: line.transaction_cm_id,
      parts: (line.suggestion?.parts ?? []).map((p) => ({
        request_id: p.request_id,
        amount: exactAmount(p.amount),
      })),
    })),
    note: '',
    ...(plan.lines.length === 1 && only !== undefined
      ? { expected_locked: exactAmount(only.line.suggestion?.would_lock ?? 0) }
      : {}),
  }
}
