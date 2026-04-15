/**
 * Re-orders a sorted list so the pinned item sits directly after its
 * "originator" — the row the user was on when they triggered the pin.
 *
 * When the pin is set via clicking a sibling request in an expanded camper
 * panel, the originator is the currently-expanded row (same requester). Placing
 * the pinned row adjacent keeps related requests clustered visually.
 *
 * Returns the input unchanged when no repositioning is needed.
 */
export function positionPinnedAdjacent<T extends { id: string }>(
  sorted: readonly T[],
  pinnedId: string | null,
  pinOriginatorId: string | null
): T[] {
  if (!pinnedId || !pinOriginatorId || pinnedId === pinOriginatorId) {
    return sorted as T[]
  }
  const originatorIdx = sorted.findIndex((r) => r.id === pinOriginatorId)
  const pinnedIdx = sorted.findIndex((r) => r.id === pinnedId)
  if (originatorIdx < 0 || pinnedIdx < 0) return sorted as T[]
  if (pinnedIdx === originatorIdx + 1) return sorted as T[]

  const result = [...sorted]
  const [pinned] = result.splice(pinnedIdx, 1)
  if (!pinned) return sorted as T[]
  // Indices shift left only when we removed an item before the originator.
  const insertIdx = pinnedIdx < originatorIdx ? originatorIdx : originatorIdx + 1
  result.splice(insertIdx, 0, pinned)
  return result
}
