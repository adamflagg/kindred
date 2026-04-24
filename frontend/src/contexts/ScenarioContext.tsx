import type { ReactNode } from 'react'
import { type FC, useState, useEffect, useCallback, useMemo, useEffectEvent, useRef } from 'react'
import { ScenarioContext, type Scenario, type ScenarioContextType } from '../hooks/useScenario'
import { useSavedScenarios } from '../hooks/useSavedScenarios'
import { useCreateScenario, useDeleteScenario } from '../hooks/useSavedScenariosMutation'
import { useUpdateScenario, useClearScenario } from '../hooks/useScenarioOperations'
import { useYear } from '../hooks/useCurrentYear'
import { savedScenarioToScenario } from './scenarioTransform'
import {
  getStoredScenarioId,
  setStoredScenarioId,
  clearStoredScenarioId,
} from '../utils/scenarioStorage'

interface ScenarioProviderProps {
  children: ReactNode
}

export const ScenarioProvider: FC<ScenarioProviderProps> = ({ children }) => {
  const [currentScenario, setCurrentScenario] = useState<Scenario | null>(null)
  const [currentSessionId, setCurrentSessionId] = useState<number | undefined>(undefined)
  const currentYear = useYear()

  const isProductionMode = currentScenario === null

  // Use React Query hooks - filter by session and year
  const {
    data: savedScenarios = [],
    isLoading,
    error: queryError,
  } = useSavedScenarios(currentSessionId, currentYear)
  const createScenarioMutation = useCreateScenario()
  const updateScenarioMutation = useUpdateScenario()
  const deleteScenarioMutation = useDeleteScenario()
  const clearScenarioMutation = useClearScenario()

  // Convert SavedScenario[] to Scenario[]
  const scenarios = useMemo(() => savedScenarios.map(savedScenarioToScenario), [savedScenarios])

  // Combine errors from queries and mutations
  const error =
    queryError?.message ??
    createScenarioMutation.error?.message ??
    updateScenarioMutation.error?.message ??
    deleteScenarioMutation.error?.message ??
    clearScenarioMutation.error?.message ??
    null

  // Combined loading state
  const loading =
    isLoading ||
    createScenarioMutation.isPending ||
    updateScenarioMutation.isPending ||
    deleteScenarioMutation.isPending ||
    clearScenarioMutation.isPending

  // Load scenarios for a session
  const loadScenarios = useCallback(async (sessionId: number) => {
    setCurrentSessionId(sessionId)
    // React Query will automatically fetch when sessionId changes
  }, [])

  // Create a new scenario
  const createScenario = useCallback(
    async (
      name: string,
      sessionId: number,
      year: number,
      description?: string,
      copyOptions?: { fromProduction: boolean } | { fromScenario: string }
    ): Promise<Scenario> => {
      const savedScenario = await createScenarioMutation.mutateAsync({
        name,
        session_cm_id: sessionId,
        year,
        ...(description !== undefined && { description }),
        ...(copyOptions !== undefined && { copyOptions }),
      })

      const scenario = savedScenarioToScenario(savedScenario)
      setCurrentScenario(scenario)
      return scenario
    },
    [createScenarioMutation]
  )

  // Select a scenario (null for production mode)
  const selectScenario = useCallback(
    (scenarioId: string | null) => {
      if (scenarioId === null) {
        setCurrentScenario(null)
      } else {
        const scenario = scenarios.find((s) => s.id === scenarioId)
        if (scenario) {
          setCurrentScenario(scenario)
        }
      }
    },
    [scenarios]
  )

  // Update scenario metadata
  const updateScenario = useCallback(
    async (scenarioId: string, updates: { name?: string; description?: string }) => {
      const updatedSavedScenario = await updateScenarioMutation.mutateAsync({
        scenarioId,
        updates,
      })

      const updatedScenario = savedScenarioToScenario(updatedSavedScenario)

      // Update current scenario if it's the one being updated
      if (currentScenario?.id === scenarioId) {
        setCurrentScenario(updatedScenario)
      }
    },
    [currentScenario, updateScenarioMutation]
  )

  // Delete a scenario
  const deleteScenario = useCallback(
    async (scenarioId: string) => {
      await deleteScenarioMutation.mutateAsync(scenarioId)

      // Clear current scenario if it's the one being deleted
      if (currentScenario?.id === scenarioId) {
        setCurrentScenario(null)
      }
    },
    [currentScenario, deleteScenarioMutation]
  )

  // Clear all assignments in a scenario
  const clearScenario = useCallback(
    async (scenarioId: string, year: number) => {
      await clearScenarioMutation.mutateAsync({
        scenarioId,
        year,
      })
    },
    [clearScenarioMutation]
  )

  // Track which session has completed its restore phase.
  // We store the sessionId (not just a boolean) so the persist effect can check
  // "has restore run for THIS session?" rather than "has restore ever run?".
  // This prevents two races:
  //   1. (Finding 1) On session switch, persist fires before restore — the boolean-only
  //      guard would be true from the previous session's restore, causing a premature clear.
  //   2. (Finding 4) Same root cause as Finding 1; covered by the same fix.
  const restoreCompletedForSessionRef = useRef<number | undefined>(undefined)

  // Persist current scenario selection to localStorage (per session).
  // Uses useEffectEvent so currentSessionId / currentScenario are always fresh without
  // being reactive dependencies (which would cause double-fire loops).
  const persistScenarioSelection = useEffectEvent(
    (sessionId: number | undefined, scenarioId: string | null) => {
      if (!sessionId) return

      if (scenarioId) {
        // Finding 2 fix: only write if the scenario actually belongs to this session.
        // When the user switches sessions, currentScenario still holds the previous
        // session's scenario for one render cycle. Writing it under the new session key
        // would corrupt that session's stored selection.
        if (currentScenario && currentScenario.session_cm_id !== sessionId) return
        setStoredScenarioId(sessionId, scenarioId)
      } else if (restoreCompletedForSessionRef.current === sessionId) {
        // Only clear the key once the restore phase for THIS session is done.
        // If we're still in the session-switch cycle (restore hasn't run yet for
        // sessionId), the null is the default React state — not an intentional
        // "switch to production" action.
        clearStoredScenarioId(sessionId)
      }
    }
  )

  // Write to localStorage whenever the selected scenario changes.
  // Depends on currentScenario?.id so it fires on user-driven scenario changes.
  useEffect(() => {
    persistScenarioSelection(currentSessionId, currentScenario?.id ?? null)
  }, [currentScenario?.id, currentSessionId])

  // Restore the last active scenario for the session when scenarios first load.
  // Uses useEffectEvent to read currentScenario without adding it as a dependency
  // (which would cause an infinite re-run loop).
  // Returns the scenario to set (or null to clear), or undefined if no change needed.
  const getValidatedScenario = useEffectEvent(
    (availableScenarios: Scenario[]): Scenario | null | undefined => {
      const storedScenarioId = currentSessionId ? getStoredScenarioId(currentSessionId) : null

      // If we already have a current scenario, verify it still exists in this session.
      if (currentScenario) {
        const stillExists = availableScenarios.find((s) => s.id === currentScenario.id)
        if (!stillExists) {
          // Current scenario was deleted or doesn't belong here — try stored fallback.
          if (storedScenarioId) {
            const savedScenario = availableScenarios.find((s) => s.id === storedScenarioId)
            if (savedScenario) {
              return savedScenario
            }
          }
          // No valid scenario for this session — reset to production mode.
          return null
        }
        // Current scenario is valid; no change needed.
        return undefined
      }

      // No current scenario yet — attempt to restore from localStorage.
      if (storedScenarioId && availableScenarios.length > 0) {
        const scenario = availableScenarios.find((s) => s.id === storedScenarioId)
        if (scenario) {
          return scenario
        }
        // Stored id doesn't match any loaded scenario (was deleted) — clear stale key.
        if (currentSessionId) {
          clearStoredScenarioId(currentSessionId)
        }
      }

      // No restoration possible; stay in production mode.
      return undefined
    }
  )

  // Validate / restore scenario when the scenarios list or session changes.
  // Only depends on scenarios + currentSessionId, not currentScenario (avoids re-run loop).
  // setState is called here, not inside useEffectEvent.
  useEffect(() => {
    const validatedResult = getValidatedScenario(scenarios)
    // undefined means no change needed; null or a Scenario means update state.
    if (validatedResult !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: syncs scenario state when external data (scenarios list, session) changes; useEffectEvent prevents re-run loops
      setCurrentScenario(validatedResult)
    }
    // Mark restore phase complete for this specific session.
    // Using the sessionId (not a boolean) prevents Finding 1: the persist effect
    // checks restoreCompletedForSessionRef.current === sessionId, so a prior
    // session's completion can't unlock writes for the new session.
    restoreCompletedForSessionRef.current = currentSessionId
  }, [scenarios, currentSessionId])

  const value: ScenarioContextType = {
    currentScenario,
    isProductionMode,
    scenarios,
    loading,
    error,
    loadScenarios,
    createScenario,
    selectScenario,
    updateScenario,
    deleteScenario,
    clearScenario,
  }

  return <ScenarioContext.Provider value={value}>{children}</ScenarioContext.Provider>
}
