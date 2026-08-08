import { useContext, createContext } from 'react'

export interface Scenario {
  id: string
  name: string
  session_cm_id: number
  created_by?: string
  created?: string
  updated?: string
  is_active: boolean
  description?: string
}

export interface ScenarioContextType {
  // Current scenario state
  currentScenario: Scenario | null
  isProductionMode: boolean
  scenarios: Scenario[]

  // Loading states
  // `isLoading` reflects the initial React Query fetch — use this for
  // empty/placeholder UI. `isMutating` reflects any in-flight mutation
  // (create/update/delete/clear) — don't use it to hide list content, since
  // doing so causes the list to "vanish" mid-mutation. Callers that need a
  // combined busy signal can derive it locally: `isLoading || isMutating`.
  isLoading: boolean
  isMutating: boolean
  error: string | null

  // Actions
  loadScenarios: (sessionId: number) => Promise<void>
  createScenario: (
    name: string,
    sessionId: number,
    year: number,
    description?: string,
    copyOptions?: { fromProduction: boolean } | { fromScenario: string }
  ) => Promise<Scenario>
  selectScenario: (scenarioId: string | null) => void
  updateScenario: (
    scenarioId: string,
    updates: { name?: string; description?: string }
  ) => Promise<void>
  deleteScenario: (scenarioId: string) => Promise<void>
  /** `sessionCmId` is the scenario's own session — used for cache
   * invalidation only; the server decides what to clear from the
   * scenario's `session` relation, not from this. */
  clearScenario: (scenarioId: string, year: number, sessionCmId: number) => Promise<void>
}

export const ScenarioContext = createContext<ScenarioContextType | undefined>(undefined)

export const useScenario = () => {
  const context = useContext(ScenarioContext)
  if (!context) {
    throw new Error('useScenario must be used within a ScenarioProvider')
  }
  return context
}
