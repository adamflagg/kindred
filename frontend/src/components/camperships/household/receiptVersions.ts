/**
 * The request card's receipt versions (round 3, household-v3.html section 1 (B)): one per posted
 * round as it was locked, then the live one, each diffed against the version before it. The diff is
 * worked out here from the receipts the payload carries, line by line on the engine's step keys.
 */
import type { ApiAidReceipt } from '../../../types/api-types'
import { formatShortDate } from '../kit/dates'
import { stepValue, type AidTraceStep } from '../kit/receiptModel'

export interface ReceiptVersion {
  /** Stable across refetches: "r1" for a posted round, "current" for the live receipt. */
  readonly key: string
  /** "Round 1 as posted", "Current". */
  readonly name: string
  /** "Mar 9" for a lock, "live" for the live receipt; null when the lock has no date. */
  readonly date: string | null
  /** The receipt's own total, as its total line words it; null when the trace has none. */
  readonly total: string | null
  readonly receipt: ApiAidReceipt
}

function totalOf(trace: readonly AidTraceStep[]): string | null {
  const total = trace.find((step) => step.key === 'total')
  return total === undefined ? null : stepValue(total)
}

/**
 * Oldest first: each posted (or reproduced) round's snapshot, then the live receipt. The server
 * gives every unposted round the same live receipt (M8), so it is one version, read from the latest
 * round (whose label carries a Round 3 decider).
 */
export function receiptVersions(receipts: readonly ApiAidReceipt[]): ReceiptVersion[] {
  const fixed = receipts
    .filter((r) => r.label.kind !== 'live')
    .sort((a, b) => a.round - b.round)
    .map((receipt): ReceiptVersion => {
      const n = String(receipt.round)
      // M18: a reproduced receipt was rebuilt from the season's sheet, never posted from Kindred.
      const as =
        receipt.label.kind === 'reproduced'
          ? `reproduced from the ${String(receipt.label.season)} sheet`
          : 'posted'
      return {
        key: `r${n}`,
        name: `Round ${n} as ${as}`,
        date: receipt.label.locked_on ? formatShortDate(receipt.label.locked_on) : null,
        total: totalOf(receipt.trace),
        receipt,
      }
    })
  const live = receipts
    .filter((r) => r.label.kind === 'live')
    .reduce<ApiAidReceipt | null>(
      (best, r) => (best === null || r.round > best.round ? r : best),
      null
    )
  if (live === null) return fixed
  return [
    ...fixed,
    { key: 'current', name: 'Current', date: 'live', total: totalOf(live.trace), receipt: live },
  ]
}

/** How a line reads against the version before it. */
export type LineMark = 'same' | 'changed' | 'new' | 'gone' | 'superseded'

export interface LineDiff {
  readonly mark: LineMark
  /** The earlier version's value, as its line words it: a changed or a gone line's. */
  readonly was: string | null
}

/** A round's worked-out lines, which its lock line supersedes once the round is posted. */
const WORKED_OUT: Readonly<Record<string, readonly string[]>> = {
  r1_locked: ['r1_pct', 'r1_potential', 'r1'],
  r2_locked: ['r2_cap', 'r2'],
  r3_locked: ['r3'],
  top_up_locked: ['top_up'],
  discretionary_locked: ['discretionary'],
}

const SAME: LineDiff = { mark: 'same', was: null }

/**
 * Each line of `trace` against `prev`, keyed by the step's key (never its position), plus a "gone"
 * entry for each line only `prev` had. Values compare as the receipt words them. The first version
 * (`prev` null) is all "same": nothing before it to compare.
 *
 * Two lines are not news, as the mock draws them: a posted round's worked-out lines (its lock line
 * is what counts, so they are muted), and a lock line that carries the figure the earlier version
 * already had as that round's award.
 */
export function diffMarks(
  prev: readonly AidTraceStep[] | null,
  trace: readonly AidTraceStep[]
): Map<string, LineDiff> {
  const marks = new Map<string, LineDiff>()
  if (prev === null) {
    for (const step of trace) marks.set(step.key, SAME)
    return marks
  }
  const before = new Map(prev.map((step) => [step.key, stepValue(step)]))
  const superseded = new Set(trace.flatMap((step) => WORKED_OUT[step.key] ?? []))
  for (const step of trace) {
    const now = stepValue(step)
    const was = before.get(step.key)
    if (superseded.has(step.key)) {
      marks.set(step.key, { mark: 'superseded', was: null })
    } else if (was === undefined) {
      const award = step.key.endsWith('_locked')
        ? before.get(step.key.slice(0, -'_locked'.length))
        : undefined
      marks.set(step.key, award === now ? SAME : { mark: 'new', was: null })
    } else {
      marks.set(step.key, was === now ? SAME : { mark: 'changed', was })
    }
  }
  const keys = new Set(trace.map((step) => step.key))
  for (const step of prev) {
    if (!keys.has(step.key) && !superseded.has(step.key)) {
      marks.set(step.key, { mark: 'gone', was: stepValue(step) })
    }
  }
  return marks
}

/** "2 changed, 1 new", "1 gone", "nothing changed". */
export function versionCompareWords(marks: ReadonlyMap<string, LineDiff>): string {
  const count = (mark: LineMark) => [...marks.values()].filter((m) => m.mark === mark).length
  const parts = (
    [
      [count('changed'), 'changed'],
      [count('new'), 'new'],
      [count('gone'), 'gone'],
    ] as const
  )
    .filter(([n]) => n > 0)
    .map(([n, words]) => `${String(n)} ${words}`)
  return parts.length > 0 ? parts.join(', ') : 'nothing changed'
}
