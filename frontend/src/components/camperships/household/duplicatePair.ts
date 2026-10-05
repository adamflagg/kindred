import { useAidApplication } from '../../../hooks/camperships/useAidApplication'
import type {
  ApiAidApplication,
  ApiAidHouseholdPage,
  ApiAidHouseholdRequest,
} from '../../../types/api-types'
import { namedHolder } from './caseworkModel'

/**
 * A request's place in a duplicate pair (item 11, owner ruling 10-05): the other request, by id, and
 * the card itself when it is on this page (null on another household's page). `keepThis`: this card
 * can keep itself with today's server, which marks the OTHER request as the duplicate. Only the
 * request kept can: the server's `_mark_duplicate` takes an ACTIVE request to keep, so a pending
 * duplicate cannot keep itself over its holder (nor can the active one pick the pending one) until
 * the server accepts a pending survivor.
 */
export interface DuplicatePair {
  readonly otherId: string
  readonly other: ApiAidHouseholdRequest | null
  readonly keepThis: boolean
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
  if (application === undefined) return null
  const id = request.row.request_id
  const onPage = (otherId: string) =>
    page.requests.find((other) => other.row.request_id === otherId) ?? null
  if (isPending(request)) {
    const holder = namedHolder(application, id)
    return holder === '' ? null : { otherId: holder, other: onPage(holder), keepThis: false }
  }
  if (request.row.request_status !== 'active') return null
  const naming = page.requests.find(
    (other) => isPending(other) && namedHolder(application, other.row.request_id) === id
  )
  return naming === undefined
    ? null
    : { otherId: naming.row.request_id, other: naming, keepThis: true }
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
  const pending = isPending(request) ? request : page.requests.find(isPending)
  const wanted = enabled && pending !== undefined
  const application = useAidApplication(pending?.row.household_cm_id ?? 0, { enabled: wanted })
  return wanted ? duplicatePair(page, application.data, request) : null
}
