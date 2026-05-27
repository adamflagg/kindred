import { useEffect } from 'react'

/**
 * Clears per-session partial-resolve lock state (#1609) whenever the selected
 * session changes, so stale locks/overflow never leak into a different session's solve.
 */
export function useResetPartialResolveOnSessionChange(
  selectedSession: string,
  unlockAll: () => void,
  setAllowOverflow: (v: boolean) => void
) {
  // unlockAll is a stable useCallback and setAllowOverflow is a stable useState
  // setter, so the effect re-fires only when selectedSession actually changes.
  useEffect(() => {
    unlockAll()
    setAllowOverflow(false)
  }, [selectedSession, unlockAll, setAllowOverflow])
}
