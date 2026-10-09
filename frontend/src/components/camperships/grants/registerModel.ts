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
import { aidSessionName } from '../kit/sessionShort'

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

/** The opened row's line under the grant (money-grants.html): a commitment's date and how it stands, else the cell's long words. */
export function openedStanding(row: ApiAidGrantRow): string {
  return row.kind === 'commitment'
    ? `${standingNote(row)} · not yet in CampMinder`
    : standingCsv(row)
}

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
 * A row's session, short for its one-line cell and full for the title (design-language §14; the shared
 * `aidSessionName`: FC1 for Family Camp, the short form for the rest). "" when the row has none.
 */
export function sessionWords(row: ApiAidGrantRow): { short: string; full: string } {
  return { short: aidSessionName(row.session_name, undefined), full: row.session_name }
}

/** "Session 2 · " in front of a share's words, or nothing when the row has no session. */
const withSession = (session: string, words: string) =>
  session === '' ? words : `${session} · ${words}`

/**
 * "Aid request it offsets" (money-grants.html): the camper's session, then each share's round
 * ("Session 2 · R1 $1,420"), "didn't apply" (a counted row on no request), "applied · no camper yet" (a
 * line in the read's needs-a-camper set), else "—" (a reversed line or a cancelled camper's commitment
 * offsets nothing). The session is the row's own: the read names none per share.
 */
export function offsetWords(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): string {
  if (didntApply(row, needsCamper)) return "didn't apply"
  if (!row.counts) {
    return row.kind === 'ledger' && needsCamper.has(row.transaction_cm_id)
      ? 'applied · no camper yet'
      : '—'
  }
  return withSession(sessionWords(row).short, row.requests.map(shareWords).join(' · '))
}

/** Why a row offsets nothing, as the cell's title (the opened row says the same in a sentence). */
export function offsetTitle(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): string {
  if (didntApply(row, needsCamper)) {
    return 'The family has no aid request this season: the grant counts, and offsets nothing'
  }
  if (row.is_reversed) return 'A reversed line offsets nothing'
  if (row.kind === 'commitment' && row.cancelled) return 'The camper cancelled: it offsets nothing'
  if (!row.counts) {
    return needsCamper.has(row.transaction_cm_id)
      ? 'Applied · waiting for its camper'
      : 'It offsets nothing'
  }
  const session = sessionWords(row).full
  return row.requests
    .map(
      (share) =>
        `${withSession(session, shareWords(share))} · ${formatMoney(share.amount)} of the grant`
    )
    .join(' · ')
}

/**
 * ⚠ Number meaning (owner, spec §8.2): what the Register's total counts. A row the server counts, OR a
 * "didn't apply" row: a never-applied household's household-level line is the grant the family
 * received, so it counts though the server has no camper to put it on. A reversed line, a line still
 * waiting for its camper (its household applied) and a commitment whose camper cancelled are shown and
 * left out; a posted grant for a cancelled camper counts until CampMinder reverses it.
 */
export const countsInTotal = (row: ApiAidGrantRow, needsCamper: ReadonlySet<number>) =>
  row.counts || didntApply(row, needsCamper)

/** ⚠ The Register's total (P-15; spec §8.2), in whole cents. The server sends no Register total. */
export function registerTotal(
  rows: readonly ApiAidGrantRow[],
  needsCamper: ReadonlySet<number>
): number {
  return (
    rows.reduce(
      (cents, row) => cents + (countsInTotal(row, needsCamper) ? toCents(row.amount) : 0),
      0
    ) / 100
  )
}

/** "9 grants · 3 not counted" for the footer: counts, never money. "Didn't apply" rows count. */
export function footerWords(
  rows: readonly ApiAidGrantRow[],
  needsCamper: ReadonlySet<number>
): string {
  const notCounted = rows.filter((r) => !countsInTotal(r, needsCamper)).length
  const grants = `${String(rows.length)} ${rows.length === 1 ? 'grant' : 'grants'}`
  return notCounted === 0 ? grants : `${grants} · ${String(notCounted)} not counted`
}

/** The never-applied lines the total counts: how many, and what they add up to. */
function neverApplied(rows: readonly ApiAidGrantRow[], needsCamper: ReadonlySet<number>) {
  const lines = rows.filter((r) => !r.counts && didntApply(r, needsCamper))
  const sum = lines.reduce((cents, r) => cents + toCents(r.amount), 0) / 100
  return { count: lines.length, sum }
}

/**
 * The footer note on the "Aid request it offsets" column, in full (money-grants.html): how many
 * household-level lines of families who didn't apply the total counts, and what they add up to. It is
 * the short note's title. "" when none.
 */
export function neverAppliedNote(
  rows: readonly ApiAidGrantRow[],
  needsCamper: ReadonlySet<number>
): string {
  const { count, sum } = neverApplied(rows, needsCamper)
  if (count === 0) return ''
  return `The total counts ${String(count)} household-level ${count === 1 ? 'line' : 'lines'} of families who didn't apply (${formatMoney(sum)})`
}

/** The same note short enough for the column's own footer cell (design-language §10). "" when none. */
export function neverAppliedShort(
  rows: readonly ApiAidGrantRow[],
  needsCamper: ReadonlySet<number>
): string {
  const { count, sum } = neverApplied(rows, needsCamper)
  return count === 0 ? '' : `incl. ${formatMoney(sum)} didn't apply`
}

/** Why a line is left out of the total, in the mock's words (★16): the amount's title. */
export function notCountedWhy(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): string {
  if (countsInTotal(row, needsCamper)) return ''
  if (row.is_reversed) return 'reversed'
  if (row.kind === 'commitment' && row.cancelled) return 'a commitment whose camper cancelled'
  return 'waiting for its camper'
}

/**
 * The footer label's title: every row shown, and the lines left out with the reasons
 * ("9 grants shown · 3 not counted (1 reversed, 1 waiting for its camper, ...)").
 */
export function footerTitleWords(
  rows: readonly ApiAidGrantRow[],
  needsCamper: ReadonlySet<number>
): string {
  const shown = `${String(rows.length)} ${rows.length === 1 ? 'grant' : 'grants'} shown`
  // The mock's order, whatever order the rows come in.
  const order = ['reversed', 'waiting for its camper', 'a commitment whose camper cancelled']
  const parts = order
    .map(
      (reason) =>
        [reason, rows.filter((r) => notCountedWhy(r, needsCamper) === reason).length] as const
    )
    .filter(([, n]) => n > 0)
  if (parts.length === 0) return shown
  const total = parts.reduce((sum, [, n]) => sum + n, 0)
  return `${shown} · ${String(total)} not counted (${parts.map(([reason, n]) => `${String(n)} ${reason}`).join(', ')})`
}

/** The chip of a commitment: one line, the details in `committedTitle` (★18). */
export const COMMITTED_CHIP = 'Committed · not in CM'

/** A commitment's chip title: when, by whom, and that CampMinder doesn't have it yet. */
export function committedTitle(row: ApiAidGrantRow): string {
  const on =
    row.committed_on === undefined || row.committed_on === '' ? row.recorded_on : row.committed_on
  return `Committed ${formatShortDate(on)} · entered by hand · not yet posted in CampMinder`
}

/** A posted line's cell words (★18): "in CM · Mar 12", plus "· reversed Apr 1" on a reversed line. */
export function cmWords(row: ApiAidGrantRow): string {
  const posted = row.recorded_on === '' ? 'in CM' : `in CM · ${formatShortDate(row.recorded_on)}`
  if (!row.is_reversed) return posted
  return `${posted} · reversed${row.reversal_date === '' ? '' : ` ${formatShortDate(row.reversal_date)}`}`
}

/** A posted line's title: the long words, with what the cell leaves out (fulfils, after the offer). */
export function postedTitle(row: ApiAidGrantRow): string {
  const posted =
    row.recorded_on === ''
      ? 'Posted in CampMinder'
      : `Posted in CampMinder ${formatShortDate(row.recorded_on)}`
  if (row.is_reversed) {
    return `${posted} · reversed${row.reversal_date === '' ? '' : ` ${formatShortDate(row.reversal_date)}`}`
  }
  return [
    posted,
    row.fulfils_commitment_id === '' ? '' : 'fulfils a commitment',
    isAfterOffer(row) ? 'after the offer: extra for the family' : '',
  ]
    .filter((w) => w !== '')
    .join(' · ')
}

/** The ⊘'s title: that the camper cancelled, and whether the line still counts (ruling 15). */
export function cancelTitle(row: ApiAidGrantRow): string {
  return `The camper cancelled (from CampMinder enrollment): ${
    row.kind === 'commitment'
      ? "the commitment isn't counted"
      : 'a posted grant still counts until CampMinder reverses it'
  }`
}

/**
 * The camper cell's title (§13): the name, the cancellation, and how the camper was found; a line on
 * no camper names its kind. What the cell cuts is said here in full.
 */
export function camperTitle(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): string {
  const basis = basisWords(row, needsCamper)
  if (row.person_cm_id > 0) {
    return [row.camper_name, row.cancelled ? cancelTitle(row) : '', basis]
      .filter((w) => w !== '')
      .join(' · ')
  }
  return [row.camper_basis === 'household' ? registerFamily(row).text : 'Household level', basis]
    .filter((w) => w !== '')
    .join(' · ')
}

const OTHER_PROGRAM = 'Other program'

/**
 * The Program column (#3090, with #3085's fallbacks as in money/ledgerModel): the server's
 * `program_label`; with none, a line with no program (waiting for its camper, or at household level:
 * the Camper cell says which) reads "—", else "Other program". Never a key.
 */
export function programWords(row: ApiAidGrantRow): string {
  if (row.program_label !== undefined && row.program_label !== '') return row.program_label
  return row.program_family !== '' ? OTHER_PROGRAM : '—'
}

/**
 * The Program column's CSV and search words: the screen draws a dash for a line with no program, the
 * file and the search keep which kind it is: "Not placed" (waiting for its camper) or "Household level".
 */
export function programCsv(row: ApiAidGrantRow, needsCamper: ReadonlySet<number>): string {
  const words = programWords(row)
  if (words !== '—') return words
  return row.kind === 'ledger' && needsCamper.has(row.transaction_cm_id)
    ? 'Not placed'
    : 'Household level'
}

/** Where a row's description or grantor lives in Funders: `?funder=<key>` or `?row=<source_id>`. */
export function funderLink(
  row: ApiAidGrantRow,
  unmapped: ReadonlyArray<{ source_id: string; description: string }>
): { param: 'funder' | 'row'; value: string } | null {
  if (row.grantor_key !== '') return { param: 'funder', value: row.grantor_key }
  const source = unmapped.find((u) => u.description === row.description)
  return source === undefined ? null : { param: 'row', value: source.source_id }
}
