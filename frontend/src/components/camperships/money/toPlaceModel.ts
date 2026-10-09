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
import { labelWords } from '../household/householdModel'
import { familyLabel } from '../kit/familyLabel'
import { formatMoney, moneyCsv, toCents } from '../kit/money'
import { aidSessionName } from '../kit/sessionShort'
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
> & {
  /** The parts the answer is for (a placement preview has them; the read's suggestion has its own). */
  readonly parts?: ApiAidToPlaceSuggestion['parts']
}

/** A line of a group's callout: an optional lead-in, a bold lead, then the words (→ and the result). */
export interface DoesLine {
  readonly pre?: string
  readonly lead?: string
  readonly text: string
  /** The Posted footnote mark follows these words ("marks the round Posted⁴"). */
  readonly posted?: true
  /** A ✓ closes the line. */
  readonly ok?: true
}
export interface GroupDoes {
  readonly tone: 'default' | 'warn' | 'grant'
  readonly lines: readonly DoesLine[]
}

/**
 * What Confirm does, by reason, as the callout on its own line under the group heading (design-language
 * §16; mock `GRP`): a bold lead, then → and the result. A line with no request has nothing to mark
 * Posted, so it is reclassified or left with a note instead (amber rule).
 */
export const GROUP_DOES = {
  several: {
    tone: 'default',
    lines: [{ lead: 'Confirm', text: ' → marks the round Posted', posted: true, ok: true }],
  },
  program_mismatch: {
    tone: 'default',
    lines: [
      { lead: 'Confirm', text: ' → marks the round Posted', ok: true },
      { pre: 'Or ', lead: 'Reclassify', text: ' if the money belongs to that other program' },
    ],
  },
  no_request: {
    tone: 'warn',
    lines: [{ lead: 'Nothing to mark Posted', text: ' → Reclassify it, or Leave With a Note' }],
  },
} as const satisfies Record<ToPlaceReason, GroupDoes>

/** The outside-grant group's callout: its Confirm lowers a camper's share; Posted and the budget don't move. */
export const GRANT_DOES = {
  tone: 'grant',
  lines: [
    { lead: 'Confirm', text: " → lowers the camper's share in that round" },
    { text: "Posted and the camp's budget don't move" },
  ],
} as const satisfies GroupDoes

/** The same callout in one plain line, for the CSV's "What Confirm does" cell. */
export const GRANT_CONFIRM_DOES =
  "Confirm → lowers the camper's share in that round; Posted and the camp's budget don't move"

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

/** The line's words without its amount, for the opened row (the amount is drawn bold before them). */
export function lineWordsBare(line: ApiAidToPlaceLine): string {
  return lineWords(line).split(' · ').slice(1).join(' · ')
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

/** A candidate's session in a one-line cell (§14): FC2 for a Family Camp weekend, the short form for the rest. */
export const candidateSession = (candidate: ApiAidToPlaceCandidate): string =>
  aidSessionName(candidate.session, candidate.session_type) || candidate.session

/** A household-level candidate (a Family Camp request, person 0). */
const isHouseholdCandidate = (candidate: ApiAidToPlaceCandidate) =>
  candidate.person_cm_id === 0 || candidate.camper === ''

/**
 * A candidate by who and which session, short (§14, §15): "Emma Johnson · Session 2", or for a household
 * request "⌂ Mia & Noah Johnson · FC2": the line's own household by its label, another household that
 * shares the request by its family. The full session name belongs in a title (`candidateLabel`).
 */
export function candidateShort(candidate: ApiAidToPlaceCandidate, line: ApiAidToPlaceLine): string {
  const who = isHouseholdCandidate(candidate)
    ? `⌂ ${
        candidate.household_cm_id === line.household_cm_id
          ? lineFamily(line).text
          : `${candidate.family || 'The'} household`
      }`
    : candidate.camper
  const session = candidateSession(candidate)
  return session === '' ? who : `${who} · ${session}`
}

/** What the line is, leading with what differs line to line (§16, mock `lineCell`): "May 14 · to the household · Camp aid · Summer". */
export function lineCell(line: ApiAidToPlaceLine): string {
  const to = line.person_cm_id === 0 || line.person === '' ? 'the household' : line.person
  return [
    ...(line.posted_on === null ? [] : [formatShortDate(line.posted_on)]),
    `to ${to}`,
    line.description || 'no description',
  ].join(' · ')
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

/** The suggestion in a cell, short and bold (§16, mock `suggShort`): where it goes, the split's amounts, or why there is none. */
export function suggestionShort(line: ApiAidToPlaceLine): string {
  const suggestion = line.suggestion
  if (suggestion === null) {
    if (line.reason === 'no_request') return 'Nothing to suggest: no request'
    const tied = equalMatches(line)
    return tied.length >= 2
      ? `No suggestion: ${countWord(tied.length)} equal matches`
      : 'No suggestion'
  }
  const [only] = suggestion.parts
  if (suggestion.parts.length === 1 && only !== undefined) {
    const c = line.candidates.find((x) => x.request_id === only.request_id)
    return `Place on ${c === undefined ? 'another request' : candidateShort(c, line)}`
  }
  return `Split ${suggestion.parts.map((p) => formatMoney(p.amount)).join(' / ')}`
}

const COUNT_WORDS: Readonly<Record<number, string>> = { 2: 'two', 3: 'three', 4: 'four' }
const countWord = (n: number) => COUNT_WORDS[n] ?? String(n)

/**
 * The candidates that each need exactly what the line still holds, when the dashboard has no suggestion:
 * the "equal matches" it never chooses between (D12).
 */
export function equalMatches(line: ApiAidToPlaceLine): ApiAidToPlaceCandidate[] {
  if (line.suggestion !== null) return []
  return line.candidates.filter(
    (c) =>
      c.not_yet_in_campminder > 0 && toCents(c.not_yet_in_campminder) === toCents(line.unplaced)
  )
}

/**
 * The suggestion's evidence, one fact per line (§16: never a · chain that wraps): each of the server's
 * facts with a ✓; for equal matches, the two ○ facts that say why the dashboard doesn't choose.
 */
export function evidenceLines(line: ApiAidToPlaceLine): string[] {
  if (line.suggestion !== null) return line.suggestion.evidence.map((e) => `✓ ${e.text}`)
  const tied = equalMatches(line)
  if (tied.length < 2) return []
  const names = tied.map((c) => candidateShort(c, line))
  const list =
    names.length === 2
      ? names.join(' and ')
      : `${names.slice(0, -1).join(', ')} and ${names.at(-1) ?? ''}`
  return [
    `○ ${list} each need exactly ${formatMoney(line.unplaced)}`,
    '○ the dashboard never chooses between equal matches',
  ]
}

/** What Confirm says when it marks nothing Posted, withholds nothing and leaves nothing. */
export const NOTHING_MARKED = 'Marks nothing Posted.'

/** One line of "What Confirm does": a symbol, an optional bold lead, the words and an optional → next step. */
export interface EffectLine {
  readonly sym: 'ok' | 'hand' | 'warn' | 'info'
  readonly lead?: string
  readonly text: string
  readonly then?: string
}

const round = (n: number) => `R${String(n)}`
const joinWords = (texts: readonly string[]) =>
  texts.length === 1
    ? (texts[0] ?? '')
    : `${texts.slice(0, -1).join(', ')} and ${texts.at(-1) ?? ''}`
const postedDay = (iso: string) => formatShortDate(iso)

/** The labels a request id reads as in "Places $X on …" and "Marks Posted · …": who · session, short. */
function requestShort(line: ApiAidToPlaceLine): ReadonlyMap<string, string> {
  return new Map(line.candidates.map((c) => [c.request_id, candidateShort(c, line)] as const))
}

/**
 * What placing would do, one effect per line (§4.10; design-language §16; ★6): ✓ the rounds it marks
 * Posted, ⚠ the rounds D152 withholds, ○ the rounds D146 leaves, and a plain "Places $X on …" for a part
 * nothing is marked on. From the server's own answer to the very write (the read's suggestion, or a
 * fresh `PlacePreviewOut` for the parts asked): the screen lays out the parts, it never reads a
 * sentence. Split… and Place on Another Request… show it for the parts typed (part 1b).
 */
export function confirmEffects(
  line: ApiAidToPlaceLine,
  would: PlacementWould | null = line.suggestion
): EffectLine[] {
  if (would === null) return []
  if (line.suggestion === null && would.parts === undefined) return []
  const labels = requestShort(line)
  const labelOf = (id: string) => labels.get(id) ?? 'another request'
  const parts = would.parts ?? line.suggestion?.parts ?? []
  const ticks = would.would_tick ?? []
  const withheld = would.would_not_tick ?? []
  const left = would.would_leave ?? []
  const out: EffectLine[] = []
  const seenWhy = new Set<string>()
  const lines = (id: string): EffectLine[] => [
    ...ticks
      .filter((t) => t.request_id === id)
      .map((t): EffectLine => ({
        sym: 'ok',
        lead: 'Marks Posted',
        text: ` · ${labelOf(id)} · ${round(t.round)} · ${formatMoney(t.amount)}`,
      })),
    ...withheld
      .filter((n) => n.request_id === id)
      .map((n): EffectLine => {
        const day = postedDay(n.posted_on)
        // A later round withheld for the very same changes says so, and leaves the next step to the first.
        const key = `${n.posted_on}|${n.reasons.join('|')}`
        if (seenWhy.has(key)) {
          return {
            sym: 'warn',
            lead: `${round(n.round)} not marked Posted`,
            text: ': the same changes as above',
          }
        }
        seenWhy.add(key)
        return {
          sym: 'warn',
          lead: `${round(n.round)} not marked Posted`,
          text: `: ${joinWords(n.reasons)}, after the ${day} posting`,
          then: `→ Check the offer, then Mark Posted · it keeps the higher of ${day}'s amount and today's`,
        }
      }),
    ...left
      .filter((l) => l.request_id === id)
      .map((l): EffectLine => {
        if (l.kind === 'unchecked') {
          return {
            sym: 'hand',
            lead: `${round(l.round)} stays unchecked`,
            text: ': you unchecked Posted',
            then: "→ Mark Posted again if that's right",
          }
        }
        if (
          l.holds !== null &&
          l.holds !== undefined &&
          l.needs !== null &&
          l.needs !== undefined
        ) {
          return {
            sym: 'hand',
            lead: `${round(l.round)} stays unchecked`,
            text: `: CampMinder holds ${formatMoney(l.holds)} · ${round(l.round)} needs ${formatMoney(l.needs)}`,
            then: "→ Mark Posted by hand if that's right",
          }
        }
        return { sym: 'hand', lead: `${round(l.round)} stays unchecked`, text: `: ${l.why}` }
      }),
  ]
  for (const part of parts) {
    const marks = ticks.some((t) => t.request_id === part.request_id)
    if (!marks) {
      out.push({
        sym: 'info',
        text: `Places ${formatMoney(part.amount)} on ${labelOf(part.request_id)}`,
      })
    }
    out.push(...lines(part.request_id))
  }
  // A round on a request none of the parts names (an answer that carries no parts): its lines alone.
  const named = new Set(parts.map((p) => p.request_id))
  const others = [...ticks, ...withheld, ...left]
    .map((x) => x.request_id)
    .filter((id, i, all) => !named.has(id) && all.indexOf(id) === i)
  for (const id of others) out.push(...lines(id))
  const nothing = ticks.length === 0 && withheld.length === 0 && left.length === 0
  if (nothing) out.push({ sym: 'info', text: NOTHING_MARKED })
  return out
}

/**
 * What Confirm says for a line the dashboard has no suggestion for (mock `fx`): ○ why there is nothing to
 * mark Posted and → what to do instead, so the opened row's "What Confirm does" is never empty.
 */
export function noSuggestionEffects(line: ApiAidToPlaceLine): EffectLine[] {
  if (line.suggestion !== null) return []
  if (line.reason === 'no_request') {
    return [
      {
        sym: 'hand',
        lead: 'Nothing to mark Posted',
        text: ': no application this season',
        then: '→ Reclassify… or Leave With a Note…',
      },
    ]
  }
  const tied = equalMatches(line)
  if (tied.length >= 2) {
    const names = tied.map((c) => candidateShort(c, line))
    return [
      {
        sym: 'hand',
        lead: "The dashboard doesn't choose",
        text: `: ${joinWords(names)} each need ${formatMoney(line.unplaced)}`,
        then: '→ Place on Another Request… and pick one',
      },
    ]
  }
  return [
    {
      sym: 'hand',
      lead: 'No suggestion',
      text: ': nothing matches closely enough',
      then: '→ Place on Another Request…, or Split… it',
    },
  ]
}

/** The effects in plain words, for a title: "Marks Posted · Emma Johnson · Session 2 · R2 · $780 · Places …". */
export function effectsPlain(lines: readonly EffectLine[]): string {
  return lines
    .map((l) => `${l.lead ?? ''}${l.text}${l.then === undefined ? '' : ` ${l.then}`}`)
    .join(' · ')
}

/**
 * What Confirm will do, before the click (§4.10: what you confirm is what's written), from the server's
 * preview of the very write it runs. `would` is the fresh preview when one has answered, else the read's.
 * A line with no suggestion has nothing to confirm.
 */
export function confirmLines(
  line: ApiAidToPlaceLine,
  would: PlacementWould | null = line.suggestion
): EffectLine[] {
  if (line.suggestion === null || would === null) return []
  return confirmEffects(line, would)
}

/** The table's "What Confirm does" cell: a symbol, a few words, the full ones in the title (§13). */
export interface ConfirmCell {
  readonly sym: 'ok' | 'hand' | 'warn' | null
  readonly words: string
  readonly title: string
}

const roundList = (rounds: readonly number[]) => rounds.map(round).join(', ')

export function confirmCell(line: ApiAidToPlaceLine): ConfirmCell {
  const suggestion = line.suggestion
  if (suggestion === null) {
    if (line.reason === 'no_request') {
      return {
        sym: null,
        words: 'Nothing to confirm',
        title: 'Nothing to confirm: no request to mark Posted',
      }
    }
    const tied = equalMatches(line)
    if (tied.length >= 2) {
      return {
        sym: 'hand',
        words: `Pick one of ${String(tied.length)}`,
        title: `${COUNT_WORDS[tied.length]?.replace(/^./, (c) => c.toUpperCase()) ?? String(tied.length)} equal matches: Place on Another Request… and pick one`,
      }
    }
    return { sym: null, words: '—', title: 'No suggestion to confirm' }
  }
  const marks = suggestion.would_tick ?? []
  const withheld = suggestion.would_not_tick ?? []
  const left = suggestion.would_leave ?? []
  const byHand = [...withheld.map((n) => n.round), ...left.map((l) => l.round)]
  const title = effectsPlain(confirmEffects(line, suggestion))
  const posted =
    marks.length === 1 && marks[0] !== undefined
      ? `${round(marks[0].round)} Posted · ${formatMoney(suggestion.would_lock ?? 0)}`
      : `${String(marks.length)} rounds Posted · ${formatMoney(suggestion.would_lock ?? 0)}`
  if (marks.length > 0) {
    return {
      sym: 'ok',
      words: byHand.length > 0 ? `${posted} · ${roundList(byHand)} by hand` : posted,
      title,
    }
  }
  if (byHand.length > 0) {
    return {
      sym: withheld.length > 0 ? 'warn' : 'hand',
      words: `${roundList(byHand)} by hand`,
      title,
    }
  }
  return { sym: null, words: 'Nothing marked', title }
}

const SYM_CHAR = { ok: '✓', hand: '○', warn: '⚠' } as const

/** The cell as one plain string for sorting, searching and the CSV: "✓ R2 Posted · $780". */
export function confirmSummary(line: ApiAidToPlaceLine): string {
  const cell = confirmCell(line)
  return cell.sym === null ? cell.words : `${SYM_CHAR[cell.sym]} ${cell.words}`
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

const SECTION_WORDS = (sections: readonly string[]) =>
  sections.map((x) => x.replaceAll('_', ' ')).join(', ')

/**
 * What a placement did, short, for the toolbar's status slot (design-language §5, §16; mock `confirmLine`):
 * how much is placed, then ✓ the rounds marked Posted and what they lock, ⚠ the rounds withheld and ○
 * the rounds left for a person ("by hand"). Every request is named in the title (`placedTitle`).
 * `familyOf` names the line's family (the household label, ruling D).
 */
export function placedWords(
  out: ApiAidPlaceOut,
  lines: readonly ApiAidToPlaceLine[],
  familyOf: (line: ApiAidToPlaceLine) => string = (line) => line.family
): string {
  const placed = new Set(out.placed)
  const which = lines.filter((l) => placed.has(l.transaction_cm_id))
  const [first] = which
  const parts = [
    which.length === 1 && first !== undefined
      ? `${familyOf(first)}: ${formatMoney(first.amount)} placed`
      : `${plural(out.placed.length, 'line', 'lines')} placed`,
  ]
  if (out.ticked.length > 0) {
    const cents = out.ticked.reduce((sum, t) => sum + toCents(t.amount), 0)
    const [only] = out.ticked
    parts.push(
      out.ticked.length === 1 && only !== undefined
        ? `✓ ${round(only.round)} Posted · ${formatMoney(cents / 100)}`
        : `✓ ${plural(out.ticked.length, 'round', 'rounds')} Posted · ${formatMoney(cents / 100)}`
    )
  } else {
    parts.push('nothing marked Posted')
  }
  const withheld = out.not_ticked ?? []
  if (withheld.length > 0) parts.push(`⚠ ${roundList(withheld.map((n) => n.round))} by hand`)
  if (out.left_to_tick.length > 0) {
    parts.push(`○ ${roundList(out.left_to_tick.map((l) => l.round))} by hand`)
  }
  const sections = out.sections_not_locked ?? []
  if (sections.length > 0) parts.push('rules not locked yet')
  return parts.join(' · ')
}

/**
 * The same result in full (§4.10: "the result lists exactly what was marked Posted"), for the status's
 * title: every request named, with the rounds it marked, withheld, left and the rules it couldn't lock.
 */
export function placedTitle(
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
      (t) => `${labelOf(labels, t.request_id)} Round ${String(t.round)} · ${formatMoney(t.amount)}`
    )
    parts.push(`Marked Posted: ${marked.join(', ')}`)
  } else {
    parts.push('Nothing marked Posted')
  }
  const withheld = out.not_ticked ?? []
  if (withheld.length > 0) {
    const named = withheld.map((n) => `${labelOf(labels, n.request_id)} (${n.why})`)
    parts.push(`Not marked Posted: ${named.join(', ')}`)
  }
  if (out.left_to_tick.length > 0) {
    const named = out.left_to_tick.map(
      (l) => `${labelOf(labels, l.request_id)} Round ${String(l.round)} (${l.why})`
    )
    parts.push(`Left unchecked: ${named.join(', ')}`)
  }
  const sections = out.sections_not_locked ?? []
  if (sections.length > 0) parts.push(`Rules not locked yet: ${SECTION_WORDS(sections)}`)
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
 * "7 lines open · $6,920 camp aid · $2,000 outside grants", as the toolbar's lead and its muted rest
 * (§5: the count bold, the figures muted). N counts both kinds of line; the camp-aid figure is the
 * server's `open_total`, the outside-grant figure the sum of those lines' amounts (exact to the cent).
 * The grant part shows only when there are grant lines.
 */
export function leadWords(
  campCount: number,
  campTotal: number,
  grants: ReadonlyArray<{ readonly amount: number }>
): { readonly head: string; readonly rest: string } {
  const n = campCount + grants.length
  const camp = `${formatMoney(campTotal)} camp aid`
  if (grants.length === 0) return { head: `${plural(n, 'line', 'lines')} open`, rest: camp }
  const cents = grants.reduce((sum, g) => sum + toCents(g.amount), 0)
  return {
    head: `${plural(n, 'line', 'lines')} open`,
    rest: `${camp} · ${formatMoney(cents / 100)} outside grants`,
  }
}

/** The lead as one line, for a title or a test. */
export function openLineWords(
  campCount: number,
  campTotal: number,
  grants: ReadonlyArray<{ readonly amount: number }>
): string {
  const { head, rest } = leadWords(campCount, campTotal, grants)
  return `${head} · ${rest}`
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
 * CampMinder, Requests it could belong to, Suggestion, What Confirm does, Amount, then Household CM id,
 * Line, Still not placed, Group), so the one To place file holds every line the tab counts (final audit O8).
 * A grant line is wholly unplaced, so its amount is the figure still not placed.
 */
export function grantCsvRows(
  needs: readonly ApiAidNeedsCamper[],
  sessions: ReadonlyMap<number, string> | undefined
): string[][] {
  return needs.map((n) => [
    labelWords(familyLabel(n.grant, n.grant.family_name)),
    grantLineWords(n),
    n.candidates.map((c) => c.name).join(', '),
    suggestionCell(n, sessions),
    GRANT_CONFIRM_DOES,
    moneyCsv(n.grant.amount),
    String(n.grant.household_cm_id),
    String(n.grant.transaction_cm_id),
    moneyCsv(n.grant.amount),
    GRANT_GROUP_WORDS,
  ])
}
