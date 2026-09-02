/**
 * Hook returning a map of (other_person_cm_id) → { type, mutual } for
 * confirmed bunk_with / not_bunk_with requests where the OTHER camper
 * is the requester and the source camper is the requestee — i.e. who else
 * has asked to (or asked NOT to) bunk with the source camper.
 *
 * `mutual` is set when the source camper has a confirmed request of the
 * SAME type back at the other camper (Beckett requested Jesse, Jesse also
 * requested Beckett).
 *
 * Rationale: when a staffer is resolving a vague "bunk with X from Y" request
 * on Jesse's panel, the useful signal is who has already asked for him —
 * Jesse's own outgoing requests are already visible in the bunking-preferences
 * section above. Surfacing only incoming requests here keeps the modal focused
 * on new information.
 *
 * Confirmed = status='resolved' AND requestee_id > 0.
 * Other request_types (e.g. same_age) are ignored.
 */
import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, userDataOptions } from '../utils/queryKeys'

export type RequestRelationType = 'bunk_with' | 'not_bunk_with'

export interface RequestRelation {
  type: RequestRelationType
  /** True when the source camper also requested this other camper (same type). */
  mutual: boolean
}

/**
 * Read-only view exposed to consumers — prevents accidental mutation of the
 * shared module-level `EMPTY` default that React Query returns while the
 * query is disabled or pending.
 */
export type CohortRelationsMap = ReadonlyMap<number, RequestRelation>

interface BunkRequestSlim {
  id: string
  requester_id: number
  requestee_id: number
  request_type: string
  status: string
}

export interface UseCohortRequestRelationsResult {
  relations: CohortRelationsMap
  isLoading: boolean
}

const EMPTY: CohortRelationsMap = new Map()

export function useCohortRequestRelations(
  personCmId: number | null,
  sessionCmId: number,
  year: number
): UseCohortRequestRelationsResult {
  const enabled = !!personCmId && sessionCmId > 0

  const { data: relations = EMPTY, isLoading } = useQuery({
    queryKey: queryKeys.cohortRequestRelations(personCmId, sessionCmId, year),
    queryFn: async (): Promise<CohortRelationsMap> => {
      if (!personCmId || sessionCmId <= 0) return EMPTY
      const selfCmId: number = personCmId

      // bunk_requests.session_id is the CampMinder session ID column (number),
      // not a PocketBase relation — distinct from useCamperCohorts which queries
      // attendees via the `session.cm_id` relation expansion. Same value, different
      // column shape.
      const filter =
        `session_id = ${sessionCmId} && year = ${year} && status = "resolved" ` +
        `&& (requester_id = ${selfCmId} || requestee_id = ${selfCmId}) ` +
        `&& (request_type = "bunk_with" || request_type = "not_bunk_with")`

      const requests = await pb.collection('bunk_requests').getFullList<BunkRequestSlim>({ filter })

      // Pass 1: collect outgoing pairs (self → other) by type, so we can
      // mark mutual when an incoming request matches.
      const outgoing = new Map<number, Set<RequestRelationType>>()
      for (const r of requests) {
        if (r.status !== 'resolved') continue
        if (!r.requestee_id || r.requestee_id <= 0) continue
        if (r.request_type !== 'bunk_with' && r.request_type !== 'not_bunk_with') continue
        if (r.requester_id !== selfCmId) continue
        const otherCmId = r.requestee_id
        if (otherCmId === selfCmId) continue
        let set = outgoing.get(otherCmId)
        if (!set) {
          set = new Set()
          outgoing.set(otherCmId, set)
        }
        set.add(r.request_type)
      }

      // Pass 2: only INCOMING requests (other → self) populate the map.
      // Local mutable Map; widened to the read-only CohortRelationsMap on return.
      const map = new Map<number, RequestRelation>()
      for (const r of requests) {
        if (r.status !== 'resolved') continue
        if (!r.requestee_id || r.requestee_id <= 0) continue
        if (r.request_type !== 'bunk_with' && r.request_type !== 'not_bunk_with') continue
        if (r.requestee_id !== selfCmId) continue
        const otherCmId = r.requester_id
        if (otherCmId === selfCmId) continue
        // not_bunk_with takes precedence over bunk_with if a person somehow
        // sent both (rare/edge — surface the conflict over hiding it).
        const existing = map.get(otherCmId)
        if (existing?.type === 'not_bunk_with') continue
        const type = r.request_type
        const mutual = outgoing.get(otherCmId)?.has(type) ?? false
        map.set(otherCmId, { type, mutual })
      }
      return map
    },
    enabled,
    ...userDataOptions,
  })

  return { relations, isLoading: enabled ? isLoading : false }
}
