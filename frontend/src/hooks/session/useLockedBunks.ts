/**
 * Hook for managing the ephemeral set of locked bunk CampMinder IDs
 * for the partial cabin re-solve feature.
 *
 * State is in-memory only — no persistence, cleared on remount/navigation.
 */

import { useCallback, useState } from 'react'

export interface UseLockedBunksResult {
  lockedBunkCmIds: ReadonlySet<number>
  lockedCount: number
  isLocked: (cmId: number) => boolean
  toggleBunkLock: (cmId: number) => void
  lockAll: (cmIds: number[]) => void
  unlockAll: () => void
}

export function useLockedBunks(): UseLockedBunksResult {
  const [locked, setLocked] = useState<Set<number>>(new Set())

  const toggleBunkLock = useCallback((cmId: number) => {
    setLocked((prev) => {
      const next = new Set(prev)
      if (next.has(cmId)) {
        next.delete(cmId)
      } else {
        next.add(cmId)
      }
      return next
    })
  }, [])

  const lockAll = useCallback((cmIds: number[]) => {
    setLocked((prev) => {
      const next = new Set(prev)
      for (const id of cmIds) {
        next.add(id)
      }
      return next
    })
  }, [])

  const unlockAll = useCallback(() => {
    setLocked(new Set())
  }, [])

  const isLocked = useCallback((cmId: number) => locked.has(cmId), [locked])

  return {
    lockedBunkCmIds: locked,
    lockedCount: locked.size,
    isLocked,
    toggleBunkLock,
    lockAll,
    unlockAll,
  }
}
