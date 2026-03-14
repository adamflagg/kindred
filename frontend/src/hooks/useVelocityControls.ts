import { useState, useMemo } from 'react'

export function useVelocityControls(availableYears: number[], currentYear: number) {
  const [selectedPriorYears, setSelectedPriorYears] = useState<number[]>([])
  const [splitByGender, setSplitByGender] = useState(false)

  const priorYearOptions = useMemo(
    () => availableYears.filter((y) => y < currentYear).sort((a, b) => b - a),
    [availableYears, currentYear]
  )

  const togglePriorYear = (year: number) => {
    if (splitByGender) {
      // When gender split is on, only allow 1 prior year
      setSelectedPriorYears((prev) => (prev.includes(year) ? [] : [year]))
    } else {
      setSelectedPriorYears((prev) =>
        prev.includes(year) ? prev.filter((y) => y !== year) : [...prev, year]
      )
    }
  }

  const handleGenderToggle = (enabled: boolean) => {
    setSplitByGender(enabled)
    // When enabling gender, limit prior years to max 1
    if (enabled && selectedPriorYears.length > 1) {
      setSelectedPriorYears(selectedPriorYears.slice(0, 1))
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
