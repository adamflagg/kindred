/**
 * Pure helper: filter a locked-bunk set down to only the ids that exist in
 * the given bunk list.
 *
 * Used in SessionView to prevent stale cross-session locks from leaking into
 * the solver (#1609 fix #2) and to keep lock/unlock counts consistent with
 * the visible bunk set (#1609 fix #6).
 */

/**
 * Returns a new Set containing only the locked ids that are present in
 * `bunks`. Stale ids (from a previously-viewed session) are silently dropped.
 *
 * @param locked  - The raw locked set from useLockedBunks()
 * @param bunks   - The bunks currently in scope (full list or area-filtered)
 */
export function scopeLockedToBunks(
  locked: ReadonlySet<number>,
  bunks: Array<{ cm_id: number }>
): Set<number> {
  return new Set([...locked].filter((id) => bunks.some((b) => b.cm_id === id)))
}
