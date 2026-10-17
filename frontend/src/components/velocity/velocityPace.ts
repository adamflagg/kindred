/**
 * The Velocity pace card's model (#3207 PR 12, DELTA-PACE; owner rulings #92–#102, decision 19).
 *
 * Every number comes from the By Session table's own reads: "now" is a session's Latest Enrolled, and
 * "last" is its prior summary found by `sessionPriorOf`, read at the same registration day while the
 * viewed season is live and at the final once it is over (#98, the server's `prior_basis`). The one
 * exception is the fold (#97, only when asked): it adds retired embedded sessions to their host's "last"
 * on the card alone, so a folded row's "last" is the table's plus the folded sessions it names.
 */
import type { PriorYearSessionSummary, VelocityCurve } from '../../types/velocity'
import { sessionPriorOf } from './velocityCompare'

/** Decision 19 / ruling #93: a session within this many campers of last year reads "level" and draws no bar. */
export const PACE_LEVEL_CAMPERS = 2

/** The bar scale's floor, so a one-camper swing in a quiet season never fills a bar. */
export const PACE_MIN_SCALE = 5

export type PaceBasis = 'same_point' | 'final'

export interface PacePart {
  name: string
  prior: number
}

export interface PaceRow {
  cmId: number
  name: string
  now: number
  prior: number
  change: number
  level: boolean
  embedded: boolean
  /** Retired embedded sessions folded into this row's prior figure (#97, only when asked). */
  folded: PacePart[]
}

export interface PaceModel {
  /** The comparable sessions, most behind first (#101). */
  rows: PaceRow[]
  counts: { behind: number; level: number; ahead: number; new: number }
  /** The largest change on the card, at least PACE_MIN_SCALE: half the bar track. */
  scale: number
  /** Last year's sessions this year does not offer (#96): outside the counts and the scale. */
  notOffered: PacePart[]
  /** True when a retired embedded session has a main session to fold into, so the toggle has work to do. */
  canFold: boolean
}

interface PaceInput {
  /** The By Session table's rows, in its order (the tie-break). */
  sessions: readonly VelocityCurve[]
  priorSessionMap: ReadonlyMap<number | string, PriorYearSessionSummary>
  /** The comparison year's session summaries. */
  summaries: readonly PriorYearSessionSummary[]
  basis: PaceBasis
  fold: boolean
  /** Current embedded session ids: own rows always (#97), marked "embedded". */
  embeddedIds: ReadonlySet<number>
}

function priorValue(summary: PriorYearSessionSummary, basis: PaceBasis): number | null {
  return basis === 'final' ? summary.final_enrolled : summary.enrolled_at_current_week
}

export function buildPaceModel({
  sessions,
  priorSessionMap,
  summaries,
  basis,
  fold,
  embeddedIds,
}: PaceInput): PaceModel {
  const rows: PaceRow[] = []
  const claimed = new Set<PriorYearSessionSummary>()
  let fresh = 0
  for (const session of sessions) {
    const summary = sessionPriorOf(session, priorSessionMap)
    if (!summary) {
      fresh += 1
      continue
    }
    claimed.add(summary)
    const prior = priorValue(summary, basis)
    if (prior == null || session.session_cm_id == null) continue
    const now = session.weekly.at(-1)?.enrolled ?? 0
    rows.push({
      cmId: session.session_cm_id,
      name: session.session_name ?? `Session ${String(session.session_cm_id)}`,
      now,
      prior,
      change: 0,
      level: false,
      embedded: embeddedIds.has(session.session_cm_id),
      folded: [],
    })
  }

  const notOffered: PacePart[] = []
  let canFold = false
  for (const summary of summaries) {
    if (claimed.has(summary)) continue
    // Matched to a session this year that has no row yet (no enrollments): offered, so never "not offered".
    if (summary.current_session_cm_id != null) continue
    const prior = priorValue(summary, basis)
    if (prior == null) continue
    const part = { name: summary.session_name ?? `Session ${String(summary.session_cm_id)}`, prior }
    const host =
      summary.folds_into_session_cm_id != null
        ? rows.find((row) => row.cmId === summary.folds_into_session_cm_id)
        : undefined
    if (host) canFold = true
    if (host && fold) {
      host.prior += prior
      host.folded.push(part)
    } else {
      notOffered.push(part)
    }
  }

  const counts = { behind: 0, level: 0, ahead: 0, new: fresh }
  for (const row of rows) {
    row.change = row.now - row.prior
    row.level = Math.abs(row.change) <= PACE_LEVEL_CAMPERS
    if (row.level) counts.level += 1
    else if (row.change < 0) counts.behind += 1
    else counts.ahead += 1
  }
  const scale = Math.max(PACE_MIN_SCALE, ...rows.map((row) => Math.abs(row.change)))
  // Array.prototype.sort is stable: equal changes keep the table's order.
  rows.sort((a, b) => a.change - b.change)
  return { rows, counts, scale, notOffered, canFold }
}

/** Two columns (#101): the ranked list cut in half, not behind-left / ahead-right. */
export function paceColumns<T>(rows: readonly T[]): [T[], T[]] {
  const half = Math.ceil(rows.length / 2)
  return [rows.slice(0, half), rows.slice(half)]
}
