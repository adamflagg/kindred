/**
 * To place's outside-grant lines: their words and the bulk confirm's plan (spec §8.2; D16, D55,
 * D126; S3-6; P-17; M5). Pure.
 */
import type { ApiAidNeedsCamper } from '../../../types/api-types'
import { formatShortDate } from '../kit/dates'
import { formatMoney } from '../kit/money'

export const needsKey = (n: ApiAidNeedsCamper) => String(n.grant.transaction_cm_id)

/** The server's limit on one placement of grant campers (`PlaceGrantsIn`: 500 placements). */
export const MAX_GRANT_PLACEMENTS = 500

/** "$1,500 · Grantor B · posted to the household · Apr 3". */
export function grantLineWords(n: ApiAidNeedsCamper): string {
  const g = n.grant
  const who = g.grantor_key === '' ? g.description || 'no grantor yet' : g.grantor_name
  const parts = [formatMoney(g.amount), who, 'posted to the household']
  if (g.recorded_on !== '') parts.push(formatShortDate(g.recorded_on))
  return parts.join(' · ')
}

/** What the table's line cell says, leading with what differs line to line: "Apr 3 · to the household · Grantor B". */
export function grantLineCell(n: ApiAidNeedsCamper): string {
  const g = n.grant
  const who = g.grantor_key === '' ? g.description || 'no grantor yet' : g.grantor_name
  return [
    ...(g.recorded_on === '' ? [] : [formatShortDate(g.recorded_on)]),
    'to the household',
    who,
  ].join(' · ')
}

/**
 * A single, exact suggestion (P-17; grants-v2.html Q3: "one applicant camper the grantor funds"): the
 * dashboard suggests the household's one candidate camper. Only these go in a bulk confirm; any other
 * is confirmed beside its evidence.
 */
export function singleSuggestion(n: ApiAidNeedsCamper): boolean {
  const [only] = n.candidates
  return (
    n.suggestion !== null &&
    n.candidates.length === 1 &&
    only?.person_cm_id === n.suggestion.person_cm_id
  )
}

/** A bulk confirm (S3-6): the lines it takes, those it leaves out, those the read no longer lists. */
export interface GrantPlan {
  readonly lines: ReadonlyArray<{ readonly need: ApiAidNeedsCamper; readonly hidden: boolean }>
  readonly leftOut: readonly ApiAidNeedsCamper[]
  /** Ticked lines the read no longer lists (placed since the click): left out. */
  readonly gone: number
}

/**
 * The plan from the lines as the read lists them NOW. The dialog derives it from the current read
 * while it is open, never caching the click's: a grant placement overwrites rather than refuses, so a
 * plan frozen at the click could re-place a line someone else just placed.
 */
export function grantPlan(
  needs: readonly ApiAidNeedsCamper[],
  selected: ReadonlySet<string>,
  hidden: ReadonlySet<string>
): GrantPlan {
  const listed = new Set(needs.map(needsKey))
  const chosen = needs.filter((n) => selected.has(needsKey(n)))
  return {
    lines: chosen
      .filter(singleSuggestion)
      .map((need) => ({ need, hidden: hidden.has(needsKey(need)) })),
    leftOut: chosen.filter((n) => !singleSuggestion(n)),
    gone: [...selected].filter((k) => !listed.has(k)).length,
  }
}

/** "3 lines in 2 households": counts, never money (the dialog adds no sum: number meaning). */
export function planWords(plan: GrantPlan): string {
  const lines = plan.lines.length
  const households = new Set(plan.lines.map(({ need }) => need.grant.household_cm_id)).size
  return `${String(lines)} ${lines === 1 ? 'line' : 'lines'} in ${String(households)} ${households === 1 ? 'household' : 'households'}`
}
