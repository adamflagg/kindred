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
  /**
   * Set only on a `POST /api/scenarios` response that ran a copy: how many
   * source rows named a party or unit that no longer resolves and were
   * skipped. `null`/`undefined` on every other response (list, update —
   * nothing ran a copy) and on a blank creation; `0` means a copy ran and
   * skipped nothing. Summer's copy loop does not count skips
   * (pre-existing), so this is always null for a summer scenario
   * regardless of source. `null`, not just optional, because that is what
   * `bunking.models.SavedScenario.copy_skipped: int | None` serializes to.
   */
  copy_skipped?: number | null
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
  /**
   * `sessionCmId` is the scenario's own session — used for cache
   * invalidation only; the server decides what to clear from the
   * scenario's `session` relation, not from this.
   *
   * Resolves to the server's own message ("Cleared N assignments from
   * scenario for year Y") rather than void, so a caller can report what
   * actually happened instead of a fixed string that would say the same
   * thing whether 0 or 400 rows were deleted.
   */
  clearScenario: (scenarioId: string, year: number, sessionCmId: number) => Promise<string>
}

export const ScenarioContext = createContext<ScenarioContextType | undefined>(undefined)

export const useScenario = () => {
  const context = useContext(ScenarioContext)
  if (!context) {
    throw new Error('useScenario must be used within a ScenarioProvider')
  }
  return context
}
