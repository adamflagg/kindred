/**
 * Money › To place's words and writes (spec §8.1; D12, D16, D58, D146, D151, D152; money-v2.html).
 * Pure: every figure is the server's (D21). The screen names, joins and labels; it never adds a
 * figure up. What Confirm will mark posted is the server's own preview: the read's
 * `SuggestionOut.would_*`, or the fresh `PlacePreviewOut` asked for when a line opens (P-4).
 * Staff words (owner 10-05, 10-06): "the dashboard", never "Kindred"; Posted is checked, never ticked.
 */
import type {
  ApiAidPlaceLineIn,
  ApiAidPlaceOut,
  ApiAidSourceRow,
  ApiAidToPlace,
  ApiAidToPlaceCandidate,
  ApiAidToPlaceLine,
  ApiAidToPlaceSuggestion,
} from '../../../types/api-types'
import type { HouseholdLabel } from '../household/householdModel'
import { aidCsvFilename } from '../kit/csv'
import { formatShortDate } from '../kit/dates'
import { familyLabel } from '../kit/familyLabel'
import { formatMoney, moneyCsv, toCents } from '../kit/money'
import type { ApiAidNeedsCamper } from '../../../types/api-types'
import { grantLineWords } from '../grants/needsModel'
import { suggestionCell } from '../grants/placeModel'

export type ToPlaceReason = ApiAidToPlaceLine['reason']

/**
 * What a placement would do, as the server works it out: the read's suggestion carries it, and so
 * does the placement preview (`PlacePreviewOut` has the same four fields).
 */
export type PlacementWould = Pick<
  ApiAidToPlaceSuggestion,
  'would_tick' | 'would_lock' | 'would_leave' | 'would_not_tick'
>

/**
 * What Confirm does, by reason: said in each group's heading (M5, mock Q4). A line with no request
 * has nothing to mark Posted, so it is reclassified or left with a note instead.
 */
export const CONFIRM_DOES = {
  several: 'Camp aid: Confirm marks the round Posted.',
  program_mismatch: 'Camp aid: Confirm marks the round Posted.',
  no_request:
    'Camp aid: this line has no request to mark, so it is reclassified or left with a note.',
} as const satisfies Record<ToPlaceReason, string>

/** The outside-grant group's sentence: its Confirm lowers a camper's share, never Posted or the budget. */
export const GRANT_CONFIRM_DOES =
  "Confirm puts it on a camper's request; it lowers their share in the round it counts in, never Posted or the camp's budget."

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** A money figure as the server's Decimal reads it: exact to the cent, no float noise ("780.00"). */
export function exactAmount(value: number): string {
  return (toCents(value) / 100).toFixed(2)
}

/**
 * The line's family as the household page names it (ruling D; #3080): `household_label` with its
 * muted `household_label_tiebreak`, else the old `family` name. (Not `label`: on the group, that is
 * the reason's label.)
 */
export function lineFamily(line: ApiAidToPlaceLine): HouseholdLabel {
  return familyLabel(
    { label: line.household_label, label_tiebreak: line.household_label_tiebreak },
    line.family
  )
}

/** Who CampMinder posted the line to: a person, or the household (person 0). */
export function postedToWords(line: ApiAidToPlaceLine): string {
  return line.person_cm_id === 0 || line.person === ''
    ? 'posted to the household'
    : `posted to ${line.person}`
}

/** "$3,620 · Camp aid · Summer · posted to the household · May 14". */
export function lineWords(line: ApiAidToPlaceLine): string {
  const parts = [
    formatMoney(line.amount),
    line.description || 'no description',
    postedToWords(line),
  ]
  if (line.posted_on !== null) parts.push(formatShortDate(line.posted_on))
  return parts.join(' · ')
}

/**
 * Ruling B (owner 10-06): "· $1,000 still not placed" under the line only where part of it already
 * sits on a request (the two differ to the cent); null when none of it is placed.
 */
export function stillNotPlacedWords(line: ApiAidToPlaceLine): string | null {
  return toCents(line.unplaced) === toCents(line.amount)
    ? null
    : `· ${formatMoney(line.unplaced)} still not placed`
}

/** "Emma Johnson · Session 2"; a household's own request (person 0) is "Johnson household". */
export function candidateLabel(candidate: ApiAidToPlaceCandidate): string {
  const who =
    candidate.person_cm_id === 0 || candidate.camper === ''
      ? `${candidate.family || 'The'} household`
      : candidate.camper
  return candidate.session === '' ? who : `${who} · ${candidate.session}`
}

/** "$2,200 not yet in CampMinder" (D151, owner ruling Group 3a Q1), and "cancelled" when it is. */
export function candidateDetail(candidate: ApiAidToPlaceCandidate): string {
  const due = `${formatMoney(candidate.not_yet_in_campminder)} not yet in CampMinder`
  return candidate.cancelled ? `${due} · cancelled` : due
}

/** Every request a set of lines could land on, by id, so a server answer naming ids reads in names. */
export function requestLabels(lines: readonly ApiAidToPlaceLine[]): ReadonlyMap<string, string> {
  return new Map(lines.flatMap((l) => l.candidates.map((c) => [c.request_id, candidateLabel(c)])))
}

const labelOf = (labels: ReadonlyMap<string, string>, requestId: string) =>
  labels.get(requestId) ?? 'another request'

/** Every line the read sends: open (by reason, in the server's order), left, reclassified. */
export function allLines(data: ApiAidToPlace): ApiAidToPlaceLine[] {
  return [
    ...data.groups.flatMap((g) => g.lines),
    ...(data.left ?? []),
    ...(data.reclassified ?? []),
  ]
}

/** The suggestion in words: "Place on Liam Garcia · Session 2", or the split it proposes. */
export function suggestionWords(line: ApiAidToPlaceLine): string {
  const suggestion = line.suggestion
  if (suggestion === null) {
    return line.reason === 'no_request' ? 'Nothing to suggest: no request.' : 'No suggestion.'
  }
  const labels = requestLabels([line])
  const [only] = suggestion.parts
  if (suggestion.parts.length === 1 && only !== undefined) {
    return `Place on ${labelOf(labels, only.request_id)}`
  }
  const parts = suggestion.parts.map(
    (p) => `${formatMoney(p.amount)} on ${labelOf(labels, p.request_id)}`
  )
  return `Split: ${parts.join(' · ')}`
}

/** The suggestion's evidence, as the server words it (exact amount, the person, the date…). */
export function evidenceWords(line: ApiAidToPlaceLine): string {
  return (line.suggestion?.evidence ?? []).map((e) => e.text).join(' ')
}

/** What Confirm says when it marks nothing posted, withholds nothing and leaves nothing. */
export const NOTHING_MARKED = 'Marks nothing posted.'

const MARKS = 'Marks Posted: '

/** Whether a "What Confirm does" line marks a round posted (drawn green): "Marks nothing posted." is not one. */
export const isMarkLine = (words: string) => words.startsWith(MARKS)

/**
 * What placing would do, in words, from the server's own answer to the very write (the read's
 * suggestion, or a fresh `PlacePreviewOut` for the parts asked): the rounds it marks posted and
 * locks, the rounds whose check D152 withholds (placed, but marked posted by hand), and those it
 * leaves (D146: a round it doesn't cover in full). Split… and Place on Another Request… show it for
 * the parts typed (part 1b), on any line with candidates, suggested or not.
 */
export function wouldLines(line: ApiAidToPlaceLine, would: PlacementWould): string[] {
  const labels = requestLabels([line])
  const marks = (would.would_tick ?? []).map(
    (t) =>
      `${MARKS}${labelOf(labels, t.request_id)} · Round ${String(t.round)} · ${formatMoney(t.amount)} locked`
  )
  const withheld = (would.would_not_tick ?? []).map(
    (n) => `Places the money; doesn't mark ${labelOf(labels, n.request_id)} posted: ${n.why}`
  )
  const left = (would.would_leave ?? []).map(
    (l) => `Leaves ${labelOf(labels, l.request_id)} · Round ${String(l.round)}: ${l.why}`
  )
  const all = [...marks, ...withheld, ...left]
  return all.length > 0 ? all : [NOTHING_MARKED]
}

/**
 * What Confirm will do, before the click (§4.10: what you confirm is what's written), from the
 * server's preview of the very write it runs (`wouldLines`). `would` is the fresh preview when one
 * has answered, else the read's. A line with no suggestion has nothing to confirm.
 */
export function confirmLines(
  line: ApiAidToPlaceLine,
  would: PlacementWould | null = line.suggestion
): string[] {
  if (line.suggestion === null || would === null) return []
  return wouldLines(line, would)
}

/** The short form for the table's column: "Marks 1 round posted · $780 locked", "1 to mark posted by hand". */
export function confirmSummary(line: ApiAidToPlaceLine): string {
  const suggestion = line.suggestion
  if (suggestion === null) return line.reason === 'no_request' ? 'Nothing to confirm' : '—'
  const marks = suggestion.would_tick ?? []
  const byHand = (suggestion.would_not_tick ?? []).length + (suggestion.would_leave ?? []).length
  const parts: string[] = []
  if (marks.length > 0) {
    parts.push(
      `Marks ${plural(marks.length, 'round', 'rounds')} posted · ${formatMoney(suggestion.would_lock ?? 0)} locked`
    )
  }
  if (byHand > 0) parts.push(`${String(byHand)} to mark posted by hand`)
  return parts.length > 0 ? parts.join(' · ') : 'Marks nothing posted'
}

/**
 * Confirm's body: the suggestion's parts, and what it showed it would lock (`expected_locked`), so
 * the write refuses (422) if the season moved since the preview rather than lock a different total.
 * `would` is the preview the person saw: the fresh one when it answered (P-4), else the read's.
 */
export function confirmBody(
  line: ApiAidToPlaceLine,
  would: PlacementWould | null = line.suggestion
): ApiAidPlaceLineIn | null {
  const suggestion = line.suggestion
  if (suggestion === null || suggestion.parts.length === 0) return null
  return {
    parts: suggestion.parts.map((p) => ({
      request_id: p.request_id,
      amount: exactAmount(p.amount),
    })),
    note: '',
    expected_locked: exactAmount((would ?? suggestion).would_lock ?? 0),
  }
}

/** Whether the line can be worked: an open line (not left, not reclassified). */
export function isOpen(line: ApiAidToPlaceLine): boolean {
  return (line.left_note ?? '') === '' && (line.reclassified_to ?? '') === ''
}

/**
 * What a placement did, in words (§4.10: "the result lists exactly what was marked posted"): the
 * rounds it marked posted, those whose check D152 withheld, those it left, and any rules sections it
 * couldn't lock. `familyOf` names the line's family (the household label, ruling D; Task 6).
 */
export function placedWords(
  out: ApiAidPlaceOut,
  lines: readonly ApiAidToPlaceLine[],
  labels: ReadonlyMap<string, string>,
  familyOf: (line: ApiAidToPlaceLine) => string = (line) => line.family
): string {
  const placed = new Set(out.placed)
  const which = lines.filter((l) => placed.has(l.transaction_cm_id))
  const [first] = which
  const head =
    which.length === 1 && first !== undefined
      ? `${familyOf(first)}: ${formatMoney(first.amount)} placed`
      : `${plural(out.placed.length, 'line', 'lines')} placed`
  const parts = [head]
  if (out.ticked.length > 0) {
    const marked = out.ticked.map(
      (t) =>
        `${labelOf(labels, t.request_id)} Round ${String(t.round)} · ${formatMoney(t.amount)} locked`
    )
    parts.push(`Marked Posted: ${marked.join(', ')}`)
  } else {
    parts.push('Nothing marked posted')
  }
  const withheld = out.not_ticked ?? []
  if (withheld.length > 0) {
    const named = withheld.map((n) => `${labelOf(labels, n.request_id)} (${n.why})`)
    parts.push(`Not marked posted: ${named.join(', ')}`)
  }
  if (out.left_to_tick.length > 0) {
    const named = out.left_to_tick.map(
      (l) => `${labelOf(labels, l.request_id)} Round ${String(l.round)} (${l.why})`
    )
    parts.push(`Left unchecked: ${named.join(', ')}`)
  }
  const sections = out.sections_not_locked ?? []
  if (sections.length > 0) {
    parts.push(`Rules not locked yet: ${sections.map((s) => s.replaceAll('_', ' ')).join(', ')}`)
  }
  return `${parts.join('. ')}.`
}

/** D70's name: "camperships-money-to-place-2027.csv", one household's "…-household-1000001-…". */
export function toPlaceCsvName(year: number, householdCmId: number | null): string {
  return aidCsvFilename({
    surface: 'money',
    view: 'to-place',
    filters: householdCmId === null ? [] : [`household ${String(householdCmId)}`],
    season: year,
  })
}

/**
 * The other ways to place a line (§8.1; D12; money-v2.html): Split… needs two candidates (on a
 * line whose suggestion is itself a split, the button reads "Edit the Split…"); Place on Another
 * Request… needs a candidate the suggestion didn't pick, and is always offered on a program
 * mismatch, as the mock draws it (R1-8a, coordinator 10-08: follow money-v2): there the person
 * places the line on the request they judge right, beside its evidence.
 */
export function placeChoices(line: ApiAidToPlaceLine): {
  readonly split: boolean
  readonly another: boolean
} {
  const suggested = new Set((line.suggestion?.parts ?? []).map((p) => p.request_id))
  return {
    split: line.candidates.length >= 2,
    another:
      (line.reason === 'program_mismatch' && line.candidates.length > 0) ||
      line.candidates.some((c) => !suggested.has(c.request_id)),
  }
}

/** Whether the suggestion is itself a split: Confirm then reads "Confirm Split" (money-v2.html; review item 6). */
export const suggestsSplit = (line: ApiAidToPlaceLine) => (line.suggestion?.parts.length ?? 0) > 1

/**
 * Where Reclassify may send a line (D104; P-7; the to-place service refuses anything else): a
 * classified aid source, never the description the line already carries (the line names its
 * description, not its key, so the two are matched by description). By description, A to Z.
 */
export function reclassifyTargets(
  sources: readonly ApiAidSourceRow[],
  line: ApiAidToPlaceLine
): ApiAidSourceRow[] {
  return sources
    .filter(
      (s) =>
        s.classified_by !== 'unclassified' && s.counts_as_aid && s.description !== line.description
    )
    .sort((a, b) => a.description.localeCompare(b.description))
}

/** A target as the picker shows it: "Grantor C full-ride program (outside)" (D88's who paid). */
export function targetWords(source: ApiAidSourceRow): string {
  if (source.who_paid === 'the camp') return `${source.description} (camp aid)`
  if (source.who_paid === 'another funder') return `${source.description} (outside)`
  return source.description
}

/** The grant lines that need a camper: all of them, or one household's under `?household=`. */
export function grantLinesFor<T extends { readonly grant: { readonly household_cm_id: number } }>(
  needs: readonly T[],
  householdCmId: number | null
): T[] {
  return householdCmId === null
    ? [...needs]
    : needs.filter((n) => n.grant.household_cm_id === householdCmId)
}

/**
 * "7 lines open · $6,920 camp aid · $2,000 outside grants": N counts both kinds of line; the camp-aid
 * figure is the server's `open_total`, the outside-grant figure the sum of those lines' amounts
 * (exact to the cent). The grant part shows only when there are grant lines.
 */
export function openLineWords(
  campCount: number,
  campTotal: number,
  grants: ReadonlyArray<{ readonly amount: number }>
): string {
  const n = campCount + grants.length
  const head = `${plural(n, 'line', 'lines')} open · ${formatMoney(campTotal)} camp aid`
  if (grants.length === 0) return head
  const cents = grants.reduce((sum, g) => sum + toCents(g.amount), 0)
  return `${head} · ${formatMoney(cents / 100)} outside grants`
}

/**
 * The count on Money's "To place" tab: camp-aid `open_count` plus the outside-grant lines that need a
 * camper, both season-wide. Null until both reads have loaded, and for zero (a 0 is not drawn).
 */
export function toPlaceCount(
  campOpenCount: number | undefined,
  grantLineCount: number | undefined
): number | null {
  if (campOpenCount === undefined || grantLineCount === undefined) return null
  const total = campOpenCount + grantLineCount
  return total > 0 ? total : null
}

/** The CSV's Group column for the outside-grant group (the one file covers everything the tab counts). */
export const GRANT_GROUP_WORDS = 'Outside grant posted to the family'

/** The CSV's Group column for a camp-aid line: its reason heading, under "Camp aid". */
export const campAidGroupWords = (heading: string) => `Camp aid: ${heading}`

/**
 * The outside-grant lines as CSV rows, in the camp-aid table's column order (Family, The line in
 * CampMinder, Requests it could belong to, Suggestion, What Confirm does, then Household CM id, Line,
 * Still not placed, Group), so the one To place file holds every line the tab counts (final audit O8).
 * A grant line is wholly unplaced, so its amount is the figure still not placed.
 */
export function grantCsvRows(
  needs: readonly ApiAidNeedsCamper[],
  sessions: ReadonlyMap<number, string> | undefined
): string[][] {
  return needs.map((n) => [
    familyLabel(n.grant, n.grant.family_name).text,
    grantLineWords(n),
    n.candidates.map((c) => c.name).join(', '),
    suggestionCell(n, sessions),
    GRANT_CONFIRM_DOES,
    String(n.grant.household_cm_id),
    String(n.grant.transaction_cm_id),
    moneyCsv(n.grant.amount),
    GRANT_GROUP_WORDS,
  ])
}
