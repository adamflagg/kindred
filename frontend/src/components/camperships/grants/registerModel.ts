/**
 * Grants › Register's words and total (spec §8.2; D54, D55, D74, D126, D142; grants-v2.html). Pure.
 * Every figure and every flag is the server's: whether a row counts is `counts`, the round a grant
 * offsets is `requests[].offsets/round/round_amount` (slice 3 ask 10, #2975), never re-derived.
 */
import type {
  ApiAidGrantRow,
  ApiAidNeedsCamper,
  ApiAidRequestShare,
} from '../../../types/api-types'
import type { HouseholdLabel } from '../household/householdModel'
import { familyLabel } from '../kit/familyLabel'
import { formatShortDate } from '../kit/dates'
import { formatMoney, toCents } from '../kit/money'

/** A Register row's key: a ledger line by its transaction, a commitment by its id. */
export const grantKey = (row: ApiAidGrantRow) =>
  row.kind === 'ledger' ? `t${String(row.transaction_cm_id)}` : `c${row.commitment_id}`

/** A line on no camper that isn't a household program's (which needs none). */
export const isHouseholdLevel = (row: ApiAidGrantRow) =>
  row.person_cm_id === 0 && row.camper_basis !== 'household'

/**
 * "Didn't apply" (D126; spec §8.2; grants-v2.html): a row of a family with no aid request this
 * season. Two kinds (R5-2):
 * - a row the server counts that sits on no request (a never-applied household's one camper, D142);
 * - a household-level line in a household that never applied and stays at household level: the
 *   server doesn't count it (no camper, not a household program) and it isn't in `needs_camper`,
 *   which holds applied households only (`needsCamper`, from the same read).
 * The server empties `requests` on every row it doesn't count (a reversed line, a line waiting for
 * its camper, a cancelled camper's commitment), so an empty list alone means nothing.
 */
export function didntApply(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): boolean {
  if (row.counts) return row.requests.length === 0
  return (
    row.kind === 'ledger' &&
    !row.is_reversed &&
    isHouseholdLevel(row) &&
    !needsCamper.has(row.transaction_cm_id)
  )
}

/** Ruling G: a grant known after the offer, on any request it sits on. */
export const isAfterOffer = (row: ApiAidGrantRow) =>
  row.requests.some((share) => share.offsets === 'after_offer')

/**
 * The lines that need a camper, from the same read (its `needs_camper`): a Register row doesn't
 * say whether its household applied, so a `none` basis reads this set.
 */
export function needsCamperIds(needs: readonly ApiAidNeedsCamper[]): ReadonlySet<number> {
  return new Set(needs.map((n) => n.grant.transaction_cm_id))
}

/**
 * The family (ruling D, rulings:527): the household card's label from the server's own helper (#3080),
 * its tie-break muted beside it; the family name when the server sends no label.
 */
export const registerFamily = (row: ApiAidGrantRow): HouseholdLabel =>
  familyLabel(row, row.family_name)

/** The camper cell's words: the camper, the household (a household program), or household level. */
export function camperWords(row: ApiAidGrantRow): string {
  if (row.person_cm_id > 0) return row.camper_name
  if (row.camper_basis === 'household') return 'the household'
  return 'household level'
}

/** How the camper was found, when it wasn't on the line (D126, D142); "" when the line named it. */
export function basisWords(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): string {
  switch (row.camper_basis) {
    case 'placed':
      return 'placed by staff'
    case 'sole_camper':
      return "tied by rule: the household's one camper"
    case 'household':
      return 'a household program: needs no camper'
    case 'none':
      return needsCamper.has(row.transaction_cm_id) ? 'needs a camper' : 'stays at household level'
    case 'ledger':
    case 'commitment':
      return ''
  }
}

/** "Where it stands" (D55): in CampMinder since a date, reversed, or committed by hand. */
export function standingWords(row: ApiAidGrantRow): string {
  if (row.kind === 'commitment') return 'committed · not yet in CampMinder'
  const posted =
    row.recorded_on === '' ? 'in CampMinder' : `in CampMinder · ${formatShortDate(row.recorded_on)}`
  if (row.is_reversed) {
    const when = row.reversal_date === '' ? '' : ` ${formatShortDate(row.reversal_date)}`
    return `${posted} · reversed${when}`
  }
  return row.fulfils_commitment_id === '' ? posted : `${posted} · fulfils a commitment`
}

/**
 * The muted line under where a row stands: a commitment's date ("committed Apr 2 · entered by
 * hand"); a line known after Round 1 posted, as grants-v2.html's Register draws it ("after the offer
 * · extra for the family", the owner's 10-08 filter mock, R5-1); else "".
 */
export function standingNote(row: ApiAidGrantRow): string {
  if (row.kind !== 'commitment') {
    return !row.is_reversed && isAfterOffer(row) ? 'after the offer · extra for the family' : ''
  }
  const on =
    row.committed_on === undefined || row.committed_on === '' ? row.recorded_on : row.committed_on
  return `committed ${formatShortDate(on)} · entered by hand`
}

/** Both, for the CSV and the search. */
export const standingCsv = (row: ApiAidGrantRow) =>
  [standingWords(row), standingNote(row)].filter((w) => w !== '').join(' · ')

/**
 * Why no round counts a share, in plain words (`RequestShareOut.offsets`). `satisfies`: a new value
 * from the server fails tsc here.
 */
export const OFFSET_WORDS = {
  after_offer: 'after the offer',
  not_offset_program: "the program doesn't subtract grants",
  not_received: 'counted once received',
  pays_after_camp_aid: 'pays after camp aid',
  incentive: 'an incentive: never subtracted',
  not_priced: "can't be priced now",
} as const satisfies Record<Exclude<NonNullable<ApiAidRequestShare['offsets']>, 'round'>, string>

/** One share: "R1 $1,420" (that round's amount now, A10), or why no round counts it. */
export function shareWords(share: ApiAidRequestShare): string {
  const offsets = share.offsets ?? null
  if (offsets === null) return `${formatMoney(share.amount)} on the request`
  if (offsets !== 'round') return OFFSET_WORDS[offsets]
  const round = share.round == null ? 'R?' : `R${String(share.round)}`
  return share.round_amount == null
    ? `${round} · not decided yet`
    : `${round} ${formatMoney(share.round_amount)}`
}

/**
 * "Aid request it offsets": each share's round, "didn't apply" (a counted row on no request),
 * "applied · no camper yet" (a line in the read's needs-a-camper set), else "—" (a reversed line or a
 * cancelled camper's commitment offsets nothing).
 */
export function offsetWords(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): string {
  if (didntApply(row, needsCamper)) return "didn't apply"
  if (!row.counts) {
    return row.kind === 'ledger' && needsCamper.has(row.transaction_cm_id)
      ? 'applied · no camper yet'
      : '—'
  }
  return row.requests.map(shareWords).join(' · ')
}

/**
 * ⚠ The Register's total (P-15, review §3 B): the amounts of the rows on screen the server counts.
 * A reversed line, a line still waiting for its camper and a commitment whose camper cancelled are
 * shown and left out; a posted grant for a cancelled camper counts until CampMinder reverses it.
 * In whole cents. The server sends no Register total.
 */
export function countedTotal(rows: readonly ApiAidGrantRow[]): number {
  return rows.reduce((cents, row) => cents + (row.counts ? toCents(row.amount) : 0), 0) / 100
}

/** "8 grants · 3 not counted" for the footer: counts, never money. */
export function footerWords(rows: readonly ApiAidGrantRow[]): string {
  const notCounted = rows.filter((r) => !r.counts).length
  const grants = `${String(rows.length)} ${rows.length === 1 ? 'grant' : 'grants'}`
  return notCounted === 0 ? grants : `${grants} · ${String(notCounted)} not counted`
}

/**
 * The sentence under the table: review item 9's words, plus the fourth row the server leaves out of
 * the total (R5-2: a household-level line of a family that didn't apply). ⚠ Number meaning: the
 * owner confirms this before Grants merges (the PR's "Needs the owner" list).
 */
export const REGISTER_FOOTNOTE =
  "A reversed line, a line waiting for its camper, a household-level line of a family that didn't apply and a commitment whose camper cancelled show but stay out of the total; a posted grant counts until CampMinder reverses it. Outside grants are outside the camp's budget: never in Remaining."
