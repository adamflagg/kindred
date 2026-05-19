// Sort key: targetPerson.first_name then last_name.
// Field origin documented in CamperDetailsPanel/BunkingStatusPanel consumer wiring.
//
// `targetPerson` is NOT a field on the canonical EnhancedBunkRequest — it is
// added by CamperDetailsPanel as `PanelBunkRequest.targetPerson: PersonsResponse | null`.
// This function accepts a generic constraint so callers may pass any request
// type that carries targetPerson (or not), without requiring changes to the
// EnhancedBunkRequest type itself.

import { SourceField } from '../types/sourceField'

type SortableTarget = { first_name?: string; last_name?: string } | null | undefined

export interface PartitionableRequest {
  id: string
  request_type: string
  source_field?: string | null
  source?: string
  targetPerson?: SortableTarget
}

interface Partitioned<T extends PartitionableRequest> {
  parent: T[]
  staff: T[]
  age: T[]
}

export function partitionRequestsBySource<T extends PartitionableRequest>(
  requests: T[]
): Partitioned<T> {
  const parent: T[] = []
  const staff: T[] = []
  const age: T[] = []

  for (const r of requests) {
    if (r.request_type === 'age_preference') {
      age.push(r)
      continue
    }
    if (
      r.source_field === SourceField.BUNK_REQUEST_FORM ||
      r.source_field === SourceField.SOCIALIZE_WITH
    ) {
      parent.push(r)
      continue
    }
    staff.push(r)
  }

  const byName = (a: T, b: T): number => {
    const af = a.targetPerson?.first_name ?? ''
    const bf = b.targetPerson?.first_name ?? ''
    if (af !== bf) return af.localeCompare(bf)
    const al = a.targetPerson?.last_name ?? ''
    const bl = b.targetPerson?.last_name ?? ''
    return al.localeCompare(bl)
  }

  parent.sort(byName)
  staff.sort(byName)
  return { parent, staff, age }
}
