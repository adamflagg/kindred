import { useEffect } from 'react'

/**
 * Clears per-session lock state (#1609) whenever the selected session
 * changes, so stale locks never leak into a different session's solve.
 *
 * Stream C: previously also reset allowOverflow. That state is gone (the
 * solver auto-uses overflow only when needed), so this hook now only resets
 * the lock set.
 */
export function useResetPartialResolveOnSessionChange(
  selectedSession: string,
  unlockAll: () => void
) {
  useEffect(() => {
    unlockAll()
  }, [selectedSession, unlockAll])
}
