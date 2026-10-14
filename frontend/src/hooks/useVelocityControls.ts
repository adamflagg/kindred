import { useState, useMemo, useCallback } from 'react'
import { useSearchParams } from 'react-router'

/**
 * Ticked prior years live in the link as `?priors=` (ruling 6, #3209), so the selection
 * survives reload and carries across Velocity ↔ Cancellations. Absent → the latest prior
 * year; present and empty → none. Deliberately not Registration's `compare=`.
 */
const PRIORS_PARAM = 'priors'

function parsePriors(raw: string | null, options: number[]): number[] {
  if (raw === null) return options[0] != null ? [options[0]] : []
  const years: number[] = []
  for (const part of raw.split(',')) {
    const year = Number(part)
    if (part !== '' && options.includes(year) && !years.includes(year)) years.push(year)
  }
  return years
}

export function useVelocityControls(availableYears: number[], currentYear: number) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [splitByGender, setSplitByGender] = useState(false)

  const priorYearOptions = useMemo(
    () => availableYears.filter((y) => y < currentYear).sort((a, b) => b - a),
    [availableYears, currentYear]
  )

  const priorsRaw = searchParams.get(PRIORS_PARAM)
  const selectedPriorYears = useMemo(
    () => parsePriors(priorsRaw, priorYearOptions),
    [priorsRaw, priorYearOptions]
  )

  // Read-modify-write against the latest params, so consecutive updates compose.
  const updatePriors = useCallback(
    (update: (current: number[]) => number[]) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          const current = parsePriors(prev.get(PRIORS_PARAM), priorYearOptions)
          newParams.set(PRIORS_PARAM, update(current).join(','))
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams, priorYearOptions]
  )

  const togglePriorYear = (year: number) => {
    if (splitByGender) {
      // When gender split is on, only allow 1 prior year
      updatePriors((prev) => (prev.includes(year) ? [] : [year]))
    } else {
      updatePriors((prev) =>
        prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
      )
    }
  }

  const handleGenderToggle = (enabled: boolean) => {
    setSplitByGender(enabled)
    // When enabling gender, limit prior years to max 1
    if (enabled && selectedPriorYears.length > 1) {
      updatePriors((prev) => prev.slice(0, 1))
    }
  }

  return {
    selectedPriorYears,
    splitByGender,
    priorYearOptions,
    togglePriorYear,
    handleGenderToggle,
  }
}
