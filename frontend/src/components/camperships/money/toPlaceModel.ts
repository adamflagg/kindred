/**
 * Money › To place's words and writes (spec §8.1; D12, D16, D58, D146, D151, D152; money-v2.html).
 * Pure: every figure is the server's (D21). The screen names, joins and labels; it never adds a
 * figure up, and what Confirm will tick is the server's own preview (`SuggestionOut.would_*`).
 */
import type {
  ApiAidPlaceLineIn,
  ApiAidPlaceOut,
  ApiAidToPlace,
  ApiAidToPlaceCandidate,
  ApiAidToPlaceLine,
} from '../../../types/api-types'
import { aidCsvFilename } from '../kit/csv'
import { formatShortDate } from '../kit/dates'
import { formatMoney, toCents } from '../kit/money'

export type ToPlaceReason = ApiAidToPlaceLine['reason']

const plural = (n: number, one: string, many: string) => `${String(n)} ${n === 1 ? one : many}`

/** A money figure as the server's Decimal reads it: exact to the cent, no float noise ("780.00"). */
export function exactAmount(value: number): string {
  return (toCents(value) / 100).toFixed(2)
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

/** "$1,000 of it not placed" when a line is partly placed; null when none of it is. */
export function unplacedWords(line: ApiAidToPlaceLine): string | null {
  return toCents(line.unplaced) === toCents(line.amount)
    ? null
    : `${formatMoney(line.unplaced)} of it not placed`
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

/** Kindred's suggestion in words: "Place on Liam Garcia · Session 2", or the split it proposes. */
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

/** What Confirm says when it ticks, withholds and leaves nothing (the mock's own words). */
export const NOTHING_TICKED = 'Ticks nothing.'

/** Whether a Confirm line is a tick (green): "Ticks nothing." is not one. */
export const isTickLine = (words: string) => words.startsWith('Ticks ') && words !== NOTHING_TICKED

/**
 * What Confirm will do, before the click (§4.10: computed at the click, what you confirm is what's
 * written), from the server's preview of the very write it runs: the rounds it ticks and locks, the
 * rounds whose tick D152 withholds (placed, but ticked by hand), and those it leaves (D146: a round
 * it doesn't cover in full).
 */
export function confirmLines(line: ApiAidToPlaceLine): string[] {
  const suggestion = line.suggestion
  if (suggestion === null) return []
  const labels = requestLabels([line])
  const ticks = (suggestion.would_tick ?? []).map(
    (t) =>
      `Ticks ${labelOf(labels, t.request_id)} · Round ${String(t.round)} · ${formatMoney(t.amount)} locked`
  )
  const withheld = (suggestion.would_not_tick ?? []).map(
    (n) => `Places the money; doesn't tick ${labelOf(labels, n.request_id)}: ${n.why}`
  )
  const left = (suggestion.would_leave ?? []).map(
    (l) => `Leaves ${labelOf(labels, l.request_id)} · Round ${String(l.round)}: ${l.why}`
  )
  const all = [...ticks, ...withheld, ...left]
  return all.length > 0 ? all : [NOTHING_TICKED]
}

/** The short form for the table's column: "Ticks 1 round · $780 locked", "Places; 1 to tick by hand". */
export function confirmSummary(line: ApiAidToPlaceLine): string {
  const suggestion = line.suggestion
  if (suggestion === null) return line.reason === 'no_request' ? 'Nothing to confirm' : '—'
  const ticks = suggestion.would_tick ?? []
  const byHand = (suggestion.would_not_tick ?? []).length + (suggestion.would_leave ?? []).length
  const parts: string[] = []
  if (ticks.length > 0) {
    parts.push(
      `Ticks ${plural(ticks.length, 'round', 'rounds')} · ${formatMoney(suggestion.would_lock ?? 0)} locked`
    )
  }
  if (byHand > 0) parts.push(`${String(byHand)} to tick by hand`)
  return parts.length > 0 ? parts.join(' · ') : 'Ticks nothing'
}

/**
 * Confirm's body: the suggestion's parts, and what it showed it would lock (`expected_locked`), so
 * the write refuses (422) if the season moved since the read rather than lock a different total.
 */
export function confirmBody(line: ApiAidToPlaceLine): ApiAidPlaceLineIn | null {
  const suggestion = line.suggestion
  if (suggestion === null || suggestion.parts.length === 0) return null
  return {
    parts: suggestion.parts.map((p) => ({
      request_id: p.request_id,
      amount: exactAmount(p.amount),
    })),
    note: '',
    expected_locked: exactAmount(suggestion.would_lock ?? 0),
  }
}

/** Whether the line can be worked: an open line (not left, not reclassified) of a ticked season. */
export function isOpen(line: ApiAidToPlaceLine): boolean {
  return (line.left_note ?? '') === '' && (line.reclassified_to ?? '') === ''
}

/**
 * What a placement did, in words (§4.10: "the result lists exactly what was ticked"): the rounds it
 * ticked, those whose tick D152 withheld, those it left, and any rules sections it couldn't lock.
 */
export function placedWords(
  out: ApiAidPlaceOut,
  lines: readonly ApiAidToPlaceLine[],
  labels: ReadonlyMap<string, string>
): string {
  const placed = new Set(out.placed)
  const which = lines.filter((l) => placed.has(l.transaction_cm_id))
  const head =
    which.length === 1 && which[0] !== undefined
      ? `${which[0].family}: ${formatMoney(which[0].amount)} placed`
      : `${plural(out.placed.length, 'line', 'lines')} placed`
  const parts = [head]
  if (out.ticked.length > 0) {
    const ticked = out.ticked.map(
      (t) =>
        `${labelOf(labels, t.request_id)} Round ${String(t.round)} · ${formatMoney(t.amount)} locked`
    )
    parts.push(`Ticked Posted: ${ticked.join(', ')}`)
  } else {
    parts.push('Nothing ticked')
  }
  const notTicked = out.not_ticked ?? []
  if (notTicked.length > 0) {
    const named = notTicked.map((n) => `${labelOf(labels, n.request_id)} (${n.why})`)
    parts.push(`Not ticked, tick by hand: ${named.join(', ')}`)
  }
  if (out.left_to_tick.length > 0) {
    const named = out.left_to_tick.map(
      (l) => `${labelOf(labels, l.request_id)} Round ${String(l.round)} (${l.why})`
    )
    parts.push(`Left unticked: ${named.join(', ')}`)
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
