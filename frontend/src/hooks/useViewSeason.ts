/**
 * Switch the season Analytics is VIEWING, for the empty state's "view 2026" link.
 *
 * A URL view override: ?year=<year>, keeping every other param. CurrentYearProvider already
 * treats a URL year as a view, not a preference, and never persists it. So the saved season
 * stays on the primary: Summer, Family Camp and Camperships don't move, and a fresh tab or the
 * Dashboard link lands on the primary season again once staff are done looking back.
 *
 * Owner question 2 is still open. If the ruling is "remember it", this whole hook becomes
 * `return useCurrentYear().setCurrentYear`, which writes the saved season too.
 */

import { useCallback } from 'react'
import { useSearchParams } from 'react-router'

export function useViewSeason(): (year: number) => void {
  const [, setSearchParams] = useSearchParams()
  return useCallback(
    (year: number) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        next.set('year', String(year))
        return next
      })
    },
    [setSearchParams]
  )
}
