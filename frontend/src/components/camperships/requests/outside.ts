/**
 * The money a round pays outside the budget (spec §12.2): a named full-cost fund's whole round, or the
 * remainder of a full-cost-after-aid round. The server says how much (`RoundOut.outside_budget`) and
 * which fund (`outside_label`); this works out what each cell, the footer and the opened row say.
 * A clawed-back round counts nowhere, so it carries no tag (Review Focus 5).
 */
import type { ApiAidGridRow, ApiAidRound } from '../../../types/api-types'
import { formatMoney, toCents } from '../kit/money'

/** `whole`: the cell's whole amount is outside (the tag reads "outside", not "$1,224 outside"). */
export interface CellOutside {
  readonly amount: number
  readonly whole: boolean
}

/** The tag word every line ends with; the opened row draws it muted. */
export const OUTSIDE_WORD = 'outside'

/** Staff words for a round with no label sent (a posted round whose type has left the rules). */
const FALLBACK_FUND = 'Outside fund'

export const OUTSIDE_FOOTNOTE =
  "Outside: the part of a round a named fund pays outside the budget. Rounds & budget doesn't count it, so a list opened from one of its figures can add up to more than the figure."

function outsideAmount(round: ApiAidRound): number {
  if (round.clawed_back) return 0
  const amount = round.outside_budget ?? 0
  return amount > 0 ? amount : 0
}

function cellOf(amount: number, of: number | null | undefined): CellOutside | null {
  if (toCents(amount) <= 0) return null
  return { amount, whole: of !== null && of !== undefined && toCents(amount) >= toCents(of) }
}

const sum = (rounds: readonly ApiAidRound[]) =>
  rounds.reduce((total, round) => total + outsideAmount(round), 0)

/** Round n's outside money against what the round decided. */
export function outsideOfRound(row: ApiAidGridRow, n: 1 | 2 | 3): CellOutside | null {
  const round = row.rounds.find((r) => r.round === n)
  return round ? cellOf(outsideAmount(round), round.decided) : null
}

/** Every round's outside money against Total Decided. */
export function outsideOfTotal(row: ApiAidGridRow): CellOutside | null {
  return cellOf(sum(row.rounds), row.total_decided)
}

/** The posted, not-clawed-back rounds' outside money against Total Posted. */
export function outsideOfPosted(row: ApiAidGridRow): CellOutside | null {
  return cellOf(sum(row.rounds.filter((r) => r.status === 'posted')), row.total_posted)
}

/** "outside" or "$1,224 outside". */
export function outsideTagWords(cell: CellOutside): string {
  return cell.whole ? OUTSIDE_WORD : `${formatMoney(cell.amount)} ${OUTSIDE_WORD}`
}

/** What the footer adds up: every shown row's Total-cell outside money. */
export function listOutside(rows: readonly ApiAidGridRow[]): number {
  return rows.reduce((total, row) => total + (outsideOfTotal(row)?.amount ?? 0), 0)
}

/** One line per round with outside money, for the opened row. */
export function fundLines(row: ApiAidGridRow): string[] {
  const lines: string[] = []
  for (const round of row.rounds) {
    const outside = outsideAmount(round)
    if (toCents(outside) <= 0) continue
    const fund = round.outside_label ?? FALLBACK_FUND
    const decided = round.decided
    const campAward =
      decided !== null && toCents(outside) < toCents(decided) ? decided - outside : null
    const camp = campAward === null ? '' : `camp award ${formatMoney(campAward)} · `
    lines.push(
      `Round ${String(round.round)} · ${camp}${fund} ${formatMoney(outside)} ${OUTSIDE_WORD}`
    )
  }
  return lines
}
