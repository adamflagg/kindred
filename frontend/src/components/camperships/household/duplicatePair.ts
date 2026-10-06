import { useAidApplication } from '../../../hooks/camperships/useAidApplication'
import type { DuplicateWaitingOut } from '../../../types/api-generated'
import type {
  ApiAidApplication,
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
} from '../../../types/api-types'
import { namedHolder } from './caseworkModel'
import { camperOf, labelOf, labelWords } from './householdModel'

/**
 * A request's place in a duplicate pair (item 11, owner ruling 10-05): the other request, by id, and
 * the card itself when it is on this page (null on another household's page). With #3024 the server
 * keeps either request of the pair: `keepThis` is on both cards (the active one marks the pending
 * request the duplicate, as `_mark_duplicate` always has; the pending one closes the active request
 * it waits on and takes its place, as `_keep_pending` does), and `keepOther` is the ACTIVE card's
 * (the same swap, asked from the request that closes). The pending card's Keep the Other Request… is
 * the older `DuplicateForm`. A revived duplicate's pair keeps neither: its hold's release keeps it.
 *
 * Owner ruling 10-05 late: a pair on ONE page shows only Keep This Request… on each card; a pair
 * across two households keeps both buttons on both cards. `waiting` is the active card's twin as the
 * server names it (#3031 `duplicates_waiting`), which is how a twin on another page is known at all.
 */
export interface DuplicatePair {
  readonly otherId: string
  readonly other: ApiAidHouseholdRequest | null
  readonly waiting: DuplicateWaitingOut | null
  readonly keepThis: boolean
  readonly keepOther: boolean
}

/**
 * The other request as staff read it (owner call 10-05 late: never its raw id): camper · session,
 * plus its household's label (and tie-break) when it is on another page and the server named it. A
 * twin on another page that nothing names is the same camper and session as this card, by definition
 * of a duplicate pair.
 */
export function twinName(pair: DuplicatePair, request: ApiAidHouseholdRequest): string {
  if (pair.other !== null) return `${camperOf(pair.other)} · ${pair.other.row.session_name}`
  const w = pair.waiting
  if (w === null) return `${camperOf(request)} · ${request.row.session_name}`
  const label = labelOf(w)
  return [w.camper_name, w.session_name, ...(label === null ? [] : [labelWords(label)])].join(' · ')
}

/**
 * The active card's pair from the server's `duplicates_waiting` (#3031): its first pending twin, on
 * this page or another. Null when nothing waits on it.
 */
function waitingPair(
  page: ApiAidHouseholdPage,
  request: ApiAidHouseholdRequest
): DuplicatePair | null {
  if (request.row.request_status !== 'active') return null
  const waiting = request.duplicates_waiting?.[0]
  if (waiting === undefined) return null
  const other = page.requests.find((r) => r.row.request_id === waiting.request_id) ?? null
  return { otherId: waiting.request_id, other, waiting, keepThis: true, keepOther: other === null }
}

const isPending = (request: ApiAidHouseholdRequest) =>
  request.row.request_status === 'duplicate_pending'

/**
 * Pairs by intake's own naming (`duplicate_of` on the application), not by matching camper and
 * session: a pending duplicate with its named holder; an active request with the pending duplicate
 * on this page that names it. Nothing until the application is read.
 */
export function duplicatePair(
  page: ApiAidHouseholdPage,
  application: ApiAidApplication | undefined,
  request: ApiAidHouseholdRequest
): DuplicatePair | null {
  const served = waitingPair(page, request)
  if (served !== null) return served
  if (application === undefined) return null
  const id = request.row.request_id
  const onPage = (otherId: string) =>
    page.requests.find((other) => other.row.request_id === otherId) ?? null
  if (isPending(request)) {
    const holder = namedHolder(application, id)
    // Its Keep the Other Request… is the older DuplicateForm, offered only when the holder is on
    // another page (owner ruling): see WorkingRequestCard.
    return holder === ''
      ? null
      : { otherId: holder, other: onPage(holder), waiting: null, keepThis: true, keepOther: false }
  }
  if (request.row.request_status !== 'active') return null
  const naming = page.requests.find(
    (other) => isPending(other) && namedHolder(application, other.row.request_id) === id
  )
  return naming === undefined
    ? null
    : {
        otherId: naming.row.request_id,
        other: naming,
        waiting: null,
        keepThis: true,
        keepOther: false,
      }
}

/**
 * The card's pair, reading an application only on a page that holds a pending duplicate: the one
 * that names its holder, the pending request's own household's (as Keep the Other Request… reads
 * it). Every card on the page shares that key, so it is one read.
 */
export function useDuplicatePair(
  page: ApiAidHouseholdPage,
  request: ApiAidHouseholdRequest,
  enabled: boolean
): DuplicatePair | null {
  // The server's duplicates_waiting names the active card's twin with no read at all.
  const served = enabled ? waitingPair(page, request) : null
  const pending = isPending(request) ? request : page.requests.find(isPending)
  const wanted = enabled && served === null && pending !== undefined
  const application = useAidApplication(pending?.row.household_cm_id ?? 0, { enabled: wanted })
  if (served !== null) return served
  return wanted ? duplicatePair(page, application.data, request) : null
}

const REVIVED_HOLD = 'duplicate_survivor_withdrawn'

/**
 * Item 4c (owner ruling 10-05): a revived duplicate's hold and the withdrawn request it was the
 * duplicate of, by intake's own naming (its `duplicate_survivor_withdrawn` flag's
 * `withdrawn_survivor`), with that card when it is on this page. Nothing to keep: the card keeps
 * itself through its hold's Keep This Request…, which is the hold's release.
 */
export function withdrawnPair(
  page: ApiAidHouseholdPage,
  application: ApiAidApplication | undefined,
  request: ApiAidHouseholdRequest
): DuplicatePair | null {
  const flag = application?.requests
    .find((r) => r.id === request.row.request_id)
    ?.flags.find((f) => f.code === REVIVED_HOLD)
  const survivor = flag?.detail?.['withdrawn_survivor']
  if (typeof survivor !== 'string' || survivor === '') return null
  const other = page.requests.find((r) => r.row.request_id === survivor) ?? null
  return { otherId: survivor, other, waiting: null, keepThis: false, keepOther: false }
}

/** The revived duplicate's pair, reading its household's application only while it holds that hold. */
export function useWithdrawnPair(
  page: ApiAidHouseholdPage,
  request: ApiAidHouseholdRequest
): DuplicatePair | null {
  const held = request.row.holds.some((hold) => hold.code === REVIVED_HOLD)
  const application = useAidApplication(request.row.household_cm_id, { enabled: held })
  return held ? withdrawnPair(page, application.data, request) : null
}
