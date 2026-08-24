import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

export type SortColumn = 'grade' | 'requester' | 'request' | 'confidence' | 'status'

/**
 * Default sort applied on every mount of the requests tab. Staff asked for
 * youngest-first (grade ascending) with a name tiebreaker — this is the
 * "group by grade" behavior. Column-header clicks replace this default
 * ephemerally; the default comes back on page refresh because the panel
 * no longer persists sort state to localStorage.
 */
export const DEFAULT_SORT_BY: SortColumn = 'grade'
export const DEFAULT_SORT_ORDER: 'asc' | 'desc' = 'asc'

/**
 * Stable sort of bunk requests for the requests tab.
 *
 * The `grade` sort is the requests-tab default: it orders rows by the
 * requester's grade (ascending → youngest first) with a first-name /
 * last-name tiebreaker so same-grade campers stay alphabetized. Campers
 * with no grade (0 or undefined) land at the end of an ascending sort.
 *
 * All other columns are pure single-key sorts that match the column
 * header click behavior: clicking a header replaces the grade default
 * for the rest of the session.
 */
export function sortRequests(
  requests: BunkRequestsResponse[],
  personMap: Map<number, PersonsResponse>,
  sortBy: SortColumn,
  sortOrder: 'asc' | 'desc'
): BunkRequestsResponse[] {
  const direction = sortOrder === 'asc' ? 1 : -1
  const copy = [...requests]

  if (sortBy === 'grade') {
    return copy.sort((a, b) => {
      const aP = personMap.get(a.requester_id)
      const bP = personMap.get(b.requester_id)
      // Missing/zero grades sort after real grades regardless of direction:
      // staff reviewing by grade want the graded campers grouped together,
      // with the unknown-grade rows parked at the bottom.
      const aGrade = aP?.grade && aP.grade > 0 ? aP.grade : null
      const bGrade = bP?.grade && bP.grade > 0 ? bP.grade : null

      // Ungraded rows always sort to the bottom regardless of sort direction.
      // Handle the ungraded cases before applying the direction multiplier.
      if (aGrade === null && bGrade === null) {
        // Both ungraded — tiebreak by name, always ascending (stable, not direction-inverted).
        const aFirst = (aP?.first_name ?? '').toLowerCase()
        const bFirst = (bP?.first_name ?? '').toLowerCase()
        if (aFirst !== bFirst) return aFirst < bFirst ? -1 : 1
        const aLast = (aP?.last_name ?? '').toLowerCase()
        const bLast = (bP?.last_name ?? '').toLowerCase()
        if (aLast < bLast) return -1
        if (aLast > bLast) return 1
        return 0
      }
      if (aGrade === null) return 1 // a goes after b regardless of direction
      if (bGrade === null) return -1 // a goes before b regardless of direction

      if (aGrade !== bGrade) return (aGrade - bGrade) * direction

      const aFirst = (aP?.first_name ?? '').toLowerCase()
      const bFirst = (bP?.first_name ?? '').toLowerCase()
      if (aFirst !== bFirst) return (aFirst < bFirst ? -1 : 1) * direction

      const aLast = (aP?.last_name ?? '').toLowerCase()
      const bLast = (bP?.last_name ?? '').toLowerCase()
      if (aLast === bLast) return 0
      return (aLast < bLast ? -1 : 1) * direction
    })
  }

  return copy.sort((a, b) => {
    let aValue: string | number
    let bValue: string | number

    switch (sortBy) {
      case 'requester': {
        const aP = personMap.get(a.requester_id)
        const bP = personMap.get(b.requester_id)
        aValue = aP ? `${aP.first_name || ''} ${aP.last_name || ''}` : ''
        bValue = bP ? `${bP.first_name || ''} ${bP.last_name || ''}` : ''
        break
      }
      case 'request': {
        const aP = a.requestee_id ? personMap.get(a.requestee_id) : null
        const bP = b.requestee_id ? personMap.get(b.requestee_id) : null
        aValue = aP ? `${aP.first_name || ''} ${aP.last_name || ''}` : a.parse_notes || ''
        bValue = bP ? `${bP.first_name || ''} ${bP.last_name || ''}` : b.parse_notes || ''
        break
      }
      case 'confidence':
        aValue = a.confidence_score
        bValue = b.confidence_score
        break
      case 'status':
        aValue = a.status
        bValue = b.status
        break
    }

    if (aValue === bValue) return 0
    return aValue < bValue ? -direction : direction
  })
}

/**
 * Order `picked` by each member's position in `table`, without mutating either.
 *
 * kindred#2538: the merge dialog seeds `selectedTargetId` from `requests[0]`
 * and POSTs that as `keep_target_from`, so the order of the pair it is handed
 * decides which request survives a merge by default. RequestReviewPanel opens
 * that dialog from two places — the toolbar button and the conflict banner —
 * and they must agree.
 *
 * `picked` is sourced from the UNFILTERED request list on purpose while the
 * ORDER comes from the visible, sorted table. Sourcing from the table itself
 * would let an active search filter drop a legitimate merge member and open a
 * one-item dialog; anything the table does not contain is therefore kept, and
 * parked at the end.
 */
export function orderByTablePosition<T extends { id: string }>(
  picked: T[],
  table: { id: string }[]
): T[] {
  const position = new Map(table.map((r, i) => [r.id, i]))
  return [...picked].sort(
    (a, b) =>
      (position.get(a.id) ?? Number.POSITIVE_INFINITY) -
      (position.get(b.id) ?? Number.POSITIVE_INFINITY)
  )
}
