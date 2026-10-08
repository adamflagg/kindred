import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Writes one Reports URL parameter (§3.6; D15), replacing the entry, so Back leaves the page rather
 * than undoing a chip. `null` (or a default) removes it. Stable through a ref, as slice 1's
 * `useGridParams.setParam`: react-router's setter changes identity with every URL change.
 */
export function useReportParam(): (name: string, value: string | null) => void {
  const [, setParams] = useSearchParams()
  const setRef = useRef(setParams)
  useEffect(() => {
    setRef.current = setParams
  }, [setParams])
  return useCallback((name: string, value: string | null) => {
    setRef.current(
      (previous) => {
        const next = new URLSearchParams(previous)
        if (value === null) next.delete(name)
        else next.set(name, value)
        return next
      },
      { replace: true }
    )
  }, [])
}
