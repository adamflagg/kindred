/**
 * Build a per-row satisfaction lookup from `/api/satisfaction`'s per_request
 * array. Used by `CamperDetail` and `CamperDetailsPanel` Path 2 (persisted
 * state) to surface tooltip strings on the Met/Unmet pill without re-running
 * the predicate client-side.
 *
 * Surfaces backend-supplied detail for every row that the API returned —
 * including the unassigned-camper case, where every row reads as
 * `(satisfied=false, detail="Requester not assigned")`. Earlier inline
 * implementations in CamperDetail / CamperDetailsPanel short-circuited to
 * `{satisfied: null, detail: null}` whenever the camper had no assignment,
 * which suppressed these legitimate API-provided strings.
 */

import type { PerRequestStatus, SatisfactionEntry } from '../types/satisfaction'

export function buildSatisfactionLookup(
  per_request: PerRequestStatus[]
): (id: string) => SatisfactionEntry {
  const byId = new Map(per_request.map((p) => [p.request_id, p]))
  return (id: string) => {
    const entry = byId.get(id)
    if (!entry) return { satisfied: null, detail: null }
    return { satisfied: entry.satisfied, detail: entry.detail ?? null }
  }
}
