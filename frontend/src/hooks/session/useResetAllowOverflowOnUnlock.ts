import { useEffect, useRef } from 'react'

/**
 * Resets `allowOverflow` to false on the >0 → 0 lockedCount transition
 * (the user just unlocked the last bunk in scope). Preserves the user's
 * toggle in every other case — staying at 0, 0 → N, or N → M — so flipping
 * overflow on at lockedCount=0 sticks across full solves.
 */
export function useResetAllowOverflowOnUnlock(
  lockedCount: number,
  setAllowOverflow: (v: boolean) => void
) {
  const prevLockedCountRef = useRef(lockedCount)
  useEffect(() => {
    const prev = prevLockedCountRef.current
    prevLockedCountRef.current = lockedCount
    if (prev > 0 && lockedCount === 0) {
      setAllowOverflow(false)
    }
  }, [lockedCount, setAllowOverflow])
}
