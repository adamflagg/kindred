import { useState, useMemo, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router'
import type { GenderBasis } from '../types/velocity'
import { GENDER_BASIS_PARAM, parseGenderBasis } from '../components/velocity/velocityGenderSeries'

/**
 * Ticked prior years live in the link as `?priors=` (ruling 6, #3209), so the selection
 * survives reload and carries across Velocity ↔ Cancellations. Absent → the latest prior
 * year, written into the link once the years load; present and empty → none. Deliberately not Registration's `compare=`.
 */
const PRIORS_PARAM = 'priors'

const PACE_FOLD_PARAM = 'retired'

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

  // True until staff pick a prior year themselves: the link carried no `priors=` when the page opened.
  // The default is written into the link right away, so the link alone cannot tell it from a pick.
  const [priorsAreDefault, setPriorsAreDefault] = useState(() => !searchParams.has(PRIORS_PARAM))
  // The default prior year this page dropped for having nothing to compare with (the page says so once).
  const [droppedDefaultPrior, setDroppedDefaultPrior] = useState<number | null>(null)

  const priorsRaw = searchParams.get(PRIORS_PARAM)
  const selectedPriorYears = useMemo(
    () => parsePriors(priorsRaw, priorYearOptions),
    [priorsRaw, priorYearOptions]
  )

  // Write the implicit default into the link once the year list has loaded, so a copied link
  // keeps its comparison year after a newer season exists. Never while options are still empty:
  // that would write `priors=` (none ticked) over the default.
  const defaultPrior = priorYearOptions[0]
  // The default prior year while it is still only the default; null once staff pick, or when none applies.
  const implicitDefaultPrior =
    priorsAreDefault &&
    defaultPrior != null &&
    selectedPriorYears.length === 1 &&
    selectedPriorYears[0] === defaultPrior
      ? defaultPrior
      : null
  useEffect(() => {
    if (priorsRaw !== null || defaultPrior == null) return
    setSearchParams(
      (prev) => {
        if (prev.has(PRIORS_PARAM)) return prev
        const newParams = new URLSearchParams(prev)
        newParams.set(PRIORS_PARAM, String(defaultPrior))
        return newParams
      },
      { replace: true }
    )
  }, [priorsRaw, defaultPrior, setSearchParams])

  // Read-modify-write against the latest params, so consecutive updates compose.
  const updatePriors = useCallback(
    (update: (current: number[]) => number[], picked = true) => {
      if (picked) setPriorsAreDefault(false)
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

  // Untick the default comparison year without it counting as a pick (it had nothing to compare with).
  const dropDefaultPrior = (year: number) => {
    setDroppedDefaultPrior(year)
    setPriorsAreDefault(false)
    updatePriors(() => [], false)
  }

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

  // #2898 owner answer #78: the Gender picker lives in the link (`gender=identity`), like a tab, so a copied
  // link keeps it; the default (the Gender field) writes nothing.
  const genderBasis = parseGenderBasis(searchParams.get(GENDER_BASIS_PARAM))
  const setGenderBasis = useCallback(
    (basis: GenderBasis) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          if (basis === 'identity') newParams.set(GENDER_BASIS_PARAM, basis)
          else newParams.delete(GENDER_BASIS_PARAM)
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

  // #3207 PR 12, ruling #97: the pace card's fold of retired embedded sessions lives in the link
  // (`retired=fold`); the default, the not-offered line, writes nothing.
  const paceFold = searchParams.get(PACE_FOLD_PARAM) === 'fold'
  const setPaceFold = useCallback(
    (fold: boolean) => {
      setSearchParams(
        (prev) => {
          const newParams = new URLSearchParams(prev)
          if (fold) newParams.set(PACE_FOLD_PARAM, 'fold')
          else newParams.delete(PACE_FOLD_PARAM)
          return newParams
        },
        { replace: true }
      )
    },
    [setSearchParams]
  )

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
    genderBasis,
    setGenderBasis,
    priorYearOptions,
    implicitDefaultPrior,
    dropDefaultPrior,
    droppedDefaultPrior,
    togglePriorYear,
    handleGenderToggle,
    paceFold,
    setPaceFold,
  }
}
