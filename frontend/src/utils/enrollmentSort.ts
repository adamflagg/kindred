/**
 * Sort comparator: enrolled first (primary), then by session type priority (secondary).
 * Used in enrollment hooks to ensure the primary camper is the enrolled one
 * when a person has mixed-status multi-session records.
 */
const SESSION_TYPE_ORDER: Record<string, number> = {
  main: 1,
  embedded: 2,
  ag: 3,
  quest: 4,
}

export function sortEnrolledFirst(
  aStatus: string | undefined,
  aSessionType: string | undefined,
  bStatus: string | undefined,
  bSessionType: string | undefined
): number {
  const aEnrolled = aStatus === 'enrolled' ? 0 : 1
  const bEnrolled = bStatus === 'enrolled' ? 0 : 1
  if (aEnrolled !== bEnrolled) return aEnrolled - bEnrolled
  return (
    (SESSION_TYPE_ORDER[aSessionType ?? ''] ?? 999) -
    (SESSION_TYPE_ORDER[bSessionType ?? ''] ?? 999)
  )
}
