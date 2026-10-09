/**
 * Placing a household-level grant line on a camper (spec §8.2; D16, D126; P-17): the suggestion in
 * words, the placement the route takes, and what it did. Pure; shared by the household page's
 * "Place on a Camper…" (part 3a) and To place's outside-grant group (part 3b).
 */
import type { EffectLine } from '../money/toPlaceModel'
import { aidSessionName } from '../kit/sessionShort'
import { formatMoney } from '../kit/money'
import type {
  ApiAidCandidateSession,
  ApiAidGrants,
  ApiAidHouseholdPage,
  ApiAidNeedsCamper,
  ApiAidPlaceGrantsOut,
  ApiAidPlacementIn,
} from '../../../types/api-types'

/**
 * How the ledger sync placed the line on its suggested camper (`CamperSuggestionOut.method`, Go's
 * `attribution_method`: "the screen turns it into words"). Only the rules that name a person reach a
 * suggestion; any other is spelled out.
 */
const METHOD_WORDS: Readonly<Record<string, string>> = {
  household_single_camper: "the household's one camper enrolled this season",
  posted_person_single_enrollment: 'CampMinder posted it to this camper',
  single_person_multi_enrollment: "the household's one camper enrolled, in more than one session",
  source_implied: 'the one camper in the program the description names',
  fa_application_program: 'the program the aid application asked for',
  household_single_session: 'the one session every camper in the household shares',
  override_staff: 'placed by staff before',
  override_sheet_2026_match: 'placed by staff before',
  decision: 'on an aid request',
}

/** The suggestion's evidence, in a sentence. */
export function evidenceWords(need: ApiAidNeedsCamper): string {
  const s = need.suggestion
  if (s === null) return 'The dashboard has no suggestion: pick the camper.'
  if (s.basis === 'commitment') {
    const grantor = need.grant.grantor_name === '' ? 'the grantor' : need.grant.grantor_name
    return `A commitment from ${grantor} names ${s.camper_name}${s.amount_matches ? ', for this amount' : ''}.`
  }
  const words = METHOD_WORDS[s.method] ?? s.method.replaceAll('_', ' ')
  return `${s.camper_name}: ${words}.`
}

/**
 * The suggestion's evidence, one fact per line (§16): a ✓ for each, none when the dashboard has no
 * suggestion (the line above says so). Its camper is the bold line above, so the facts do not name them again.
 */
export function evidenceLines(need: ApiAidNeedsCamper): string[] {
  const s = need.suggestion
  if (s === null) return []
  if (s.basis === 'commitment') {
    const grantor = need.grant.grantor_name === '' ? 'the grantor' : need.grant.grantor_name
    return [
      `✓ a commitment from ${grantor} names ${s.camper_name}${s.amount_matches ? ', for this amount' : ''}`,
    ]
  }
  return [`✓ ${METHOD_WORDS[s.method] ?? s.method.replaceAll('_', ' ')}`]
}

/**
 * To place's suggestion cell, short (§14; mock `grantTable`): "Liam Garcia · Session 2", with the
 * session in the one-line form (FC2 for a Family Camp, the short form for the rest). The session's
 * type is not on this read, so it is told apart by its name. The full name goes in the title.
 */
export function suggestionShort(
  need: ApiAidNeedsCamper,
  sessions: ReadonlyMap<number, string> | undefined
): string {
  const s = need.suggestion
  if (s === null) return 'No suggestion: pick the camper'
  const name = s.session_cm_id > 0 ? sessions?.get(s.session_cm_id) : undefined
  const short = name === undefined || name === '' ? '' : aidSessionName(name, undefined) || name
  return short === '' ? s.camper_name : `${s.camper_name} · ${short}`
}

/**
 * What Confirm does on a grant line, one effect per line (§16): it lowers the suggested camper's share in
 * the round the grant counts in, and a Posted round stands. With no suggestion there is nothing to
 * confirm yet: pick the camper.
 */
export function grantEffects(
  need: ApiAidNeedsCamper,
  sessions: ReadonlyMap<number, string> | undefined
): EffectLine[] {
  if (need.suggestion === null) {
    const names = need.candidates.map((c) => c.name)
    return [
      {
        sym: 'hand',
        lead: 'Nothing to confirm yet',
        text: ': pick the camper',
        ...(names.length === 0
          ? {}
          : {
              then: `→ Another Camper… and choose ${names.length === 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} or ${names.at(-1) ?? ''}`}`,
            }),
      },
    ]
  }
  return [
    {
      sym: 'info',
      text: `Lowers ${suggestionShort(need, sessions)}'s share by ${formatMoney(need.grant.amount)} in the round it counts in`,
    },
    { sym: 'hand', text: 'A Posted round stands' },
  ]
}

/**
 * To place's suggestion cell (mock Q4): "Emma Haddad · Session 2", the suggested camper and the
 * session's name; just the camper when the suggestion has no session or its name isn't loaded.
 */
export function suggestionCell(
  need: ApiAidNeedsCamper,
  sessions: ReadonlyMap<number, string> | undefined
): string {
  const s = need.suggestion
  if (s === null) return 'No suggestion: pick the camper'
  const session = s.session_cm_id > 0 ? sessions?.get(s.session_cm_id) : undefined
  return session === undefined || session === '' ? s.camper_name : `${s.camper_name} · ${session}`
}

/** The sessions a candidate is actively enrolled in that the grant could pay for ([] = none known). */
export function candidateSessions(
  need: ApiAidNeedsCamper,
  personCmId: number
): ApiAidCandidateSession[] {
  return need.candidates.find((c) => c.person_cm_id === personCmId)?.sessions ?? []
}

/**
 * The session Another Camper… places on: the one picked when it is one of the camper's, else the
 * suggestion's when it names this camper, else the first they have, else none (the server finds it).
 * `picked` is the picker's value ("" = untouched).
 */
export function pickedSession(
  need: ApiAidNeedsCamper,
  personCmId: number,
  picked: string
): number | null {
  const sessions = candidateSessions(need, personCmId)
  const suggested = suggestedSession(need, personCmId)
  if (sessions.length === 0) return suggested
  const chosen = sessions.find((s) => String(s.session_cm_id) === picked)
  if (chosen !== undefined) return chosen.session_cm_id
  return (
    sessions.find((s) => s.session_cm_id === suggested)?.session_cm_id ??
    sessions[0]?.session_cm_id ??
    null
  )
}

function suggestedSession(need: ApiAidNeedsCamper, personCmId: number): number | null {
  const s = need.suggestion
  return s !== null && s.person_cm_id === personCmId && s.session_cm_id > 0 ? s.session_cm_id : null
}

/**
 * The line placed on a camper. `session` is the one Another Camper… picked (null = none); left out, the
 * suggestion's session goes with the suggested camper and any other camper is placed with no session and
 * the server finds it (P-17).
 */
export function placementFor(
  need: ApiAidNeedsCamper,
  personCmId: number,
  session?: number | null
): ApiAidPlacementIn {
  return {
    transaction_cm_id: need.grant.transaction_cm_id,
    person_cm_id: personCmId,
    session_cm_id: session === undefined ? suggestedSession(need, personCmId) : session,
  }
}

/**
 * A household page grant row the page shows as "needs a camper" (`grantCamper`): a CampMinder line
 * on no camper that isn't a household program's. Only such a row can carry "Place on a Camper…".
 */
export const needsCamperOnPage = (grant: ApiAidHouseholdPage['grants'][number]) =>
  grant.kind === 'ledger' && grant.person_cm_id === 0 && grant.camper_basis !== 'household'

/** Whether a read still lists the line as needing a camper (a placement overwrites, never refuses). */
export function stillNeedsCamper(data: ApiAidGrants, transactionCmId: number): boolean {
  return data.needs_camper.some((n) => n.grant.transaction_cm_id === transactionCmId)
}

/** What a placement did: "2 lines placed on their campers"; the unchanged said apart. */
export function placedGrantWords(out: ApiAidPlaceGrantsOut): string {
  const one = out.placed === 1
  const placed = `${String(out.placed)} ${one ? 'line' : 'lines'} placed on ${one ? 'its camper' : 'their campers'}`
  const same = out.unchanged > 0 ? `, ${String(out.unchanged)} already placed that way` : ''
  return `${placed}${same}. An unposted round re-prices with the grant; a posted amount stands.`
}

/** The sentence beside every placement (review item 8). */
export const SUGGESTS_CONFIRMS = 'The dashboard suggests; a person confirms.'
