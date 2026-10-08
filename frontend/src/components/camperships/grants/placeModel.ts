/**
 * Placing a household-level grant line on a camper (spec §8.2; D16, D126; P-17): the suggestion in
 * words, the placement the route takes, and what it did. Pure; shared by the household page's
 * "Place on a Camper…" (part 3a) and To place's outside-grant group (part 3b).
 */
import type {
  ApiAidGrants,
  ApiAidHouseholdPage,
  ApiAidNeedsCamper,
  ApiAidPlaceGrantsOut,
  ApiAidPlacementIn,
} from '../../../types/api-types'
import { programLabel } from '../requests/programLabel'

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

/** "Liam Garcia (Summer)": the suggested camper and the program, in the server's `program_label`, else the rules' words. */
export function suggestedWords(
  need: ApiAidNeedsCamper,
  names: Readonly<Record<string, string>>
): string {
  const s = need.suggestion
  if (s === null) return 'No suggestion: pick the camper'
  return s.program_family === ''
    ? s.camper_name
    : `${s.camper_name} (${s.program_label || programLabel(names, s.program_family)})`
}

/**
 * The line placed on a camper: the suggestion's session goes with the suggested camper; any other
 * camper is placed with no session and the server finds it (P-17).
 */
export function placementFor(need: ApiAidNeedsCamper, personCmId: number): ApiAidPlacementIn {
  const s = need.suggestion
  const session =
    s !== null && s.person_cm_id === personCmId && s.session_cm_id > 0 ? s.session_cm_id : null
  return {
    transaction_cm_id: need.grant.transaction_cm_id,
    person_cm_id: personCmId,
    session_cm_id: session,
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
