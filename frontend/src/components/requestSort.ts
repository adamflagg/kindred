import type { BunkRequestsResponse, PersonsResponse } from '../types/pocketbase-types'

export type SortColumn = 'grade' | 'requester' | 'request' | 'priority' | 'confidence' | 'status'

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
 * requester's grade (ascending → youngest first) with a last-name /
 * first-name tiebreaker so same-grade campers stay alphabetized. Campers
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
      const aGrade = aP?.grade && aP.grade > 0 ? aP.grade : Number.POSITIVE_INFINITY
      const bGrade = bP?.grade && bP.grade > 0 ? bP.grade : Number.POSITIVE_INFINITY
      if (aGrade !== bGrade) return (aGrade - bGrade) * direction

      const aLast = (aP?.last_name ?? '').toLowerCase()
      const bLast = (bP?.last_name ?? '').toLowerCase()
      if (aLast !== bLast) return aLast < bLast ? -direction : direction

      const aFirst = (aP?.first_name ?? '').toLowerCase()
      const bFirst = (bP?.first_name ?? '').toLowerCase()
      if (aFirst === bFirst) return 0
      return aFirst < bFirst ? -direction : direction
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
      case 'priority':
        aValue = a.priority
        bValue = b.priority
        break
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
