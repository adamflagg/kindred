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

/**
 * Writes several Reports URL parameters in one step (Rows clears `table`, `round` and `decided` as it
 * sets `rows`): react-router's functional setter does not queue, so two calls would lose the first.
 */
export function useReportParams(): (changes: Readonly<Record<string, string | null>>) => void {
  const [, setParams] = useSearchParams()
  const setRef = useRef(setParams)
  useEffect(() => {
    setRef.current = setParams
  }, [setParams])
  return useCallback((changes: Readonly<Record<string, string | null>>) => {
    setRef.current(
      (previous) => {
        const next = new URLSearchParams(previous)
        for (const [name, value] of Object.entries(changes)) {
          if (value === null) next.delete(name)
          else next.set(name, value)
        }
        return next
      },
      { replace: true }
    )
  }, [])
}
