import { useContext, createContext } from 'react'

export interface CurrentYearContextType {
  currentYear: number
  setCurrentYear: (year: number) => void
  availableYears: number[]
  isTransitioning: boolean
  isYearReady: boolean
  /** The dashboard's configured season N (sync status), once known: the season picker marks older than N-1 closed. */
  configuredYear?: number
}

export const CurrentYearContext = createContext<CurrentYearContextType | undefined>(undefined)

export function useCurrentYear() {
  const context = useContext(CurrentYearContext)
  if (!context) {
    throw new Error('useCurrentYear must be used within a CurrentYearProvider')
  }
  return context
}

/** The dashboard's configured season N, once known (undefined until then, or outside the provider). */
export function useConfiguredYear(): number | undefined {
  return useContext(CurrentYearContext)?.configuredYear
}

// Helper hook for components that need just the year value
export function useYear() {
  const { currentYear } = useCurrentYear()
  return currentYear
}
