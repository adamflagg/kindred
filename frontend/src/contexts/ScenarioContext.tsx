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

  // Any mutation in flight. Tracked separately from `isLoading` so UI that
  // renders list content (e.g. ScenarioManagementModal) doesn't replace the
  // list with a placeholder while a delete/clear is processing.
  const isMutating =
    createScenarioMutation.isPending ||
    updateScenarioMutation.isPending ||
    deleteScenarioMutation.isPending ||
    clearScenarioMutation.isPending

  // Load scenarios for a session
  const loadScenarios = useCallback(async (sessionId: number) => {
    setCurrentSessionId(sessionId)
    // React Query will automatically fetch when sessionId changes
  }, [])

  // Create a new scenario. useCreateScenario already returns Scenario-shaped
  // data (POST /api/scenarios resolves session_cm_id server-side, kindred#2021)
  // — no savedScenarioToScenario unwrap needed, unlike updateScenario below,
  // which still goes through the raw PocketBase SDK.
  const createScenario = useCallback(
    async (
      name: string,
      sessionId: number,
      year: number,
      description?: string,
      copyOptions?: { fromProduction: boolean } | { fromScenario: string }
    ): Promise<Scenario> => {
      const scenario = await createScenarioMutation.mutateAsync({
        name,
        session_cm_id: sessionId,
        year,
        ...(description !== undefined && { description }),
        ...(copyOptions !== undefined && { copyOptions }),
      })

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
    async (scenarioId: string, year: number, sessionCmId: number) => {
      await clearScenarioMutation.mutateAsync({
        scenarioId,
        year,
        sessionCmId,
      })
    },
    [clearScenarioMutation]
  )

  // Tracks the sessionId whose restore phase has completed; prevents persist effect from
  // clearing the stored key before restore runs.
  const restoreCompletedForSessionRef = useRef<number | undefined>(undefined)

  // Persist current scenario selection to localStorage (per session).
  // Uses useEffectEvent so currentSessionId / currentScenario are always fresh without
  // being reactive dependencies (which would cause double-fire loops).
  const persistScenarioSelection = useEffectEvent(
    (sessionId: number | undefined, scenarioId: string | null) => {
      if (!sessionId) return

      if (scenarioId) {
        // Only write if the scenario belongs to this session — on session switch,
        // currentScenario still holds the previous session's value for one render cycle.
        if (currentScenario && currentScenario.session_cm_id !== sessionId) return
        setStoredScenarioId(sessionId, scenarioId)
      } else if (restoreCompletedForSessionRef.current === sessionId) {
        // Only clear once restore has run for this session; null before that is
        // default React state, not a user "switch to production" action.
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

      if (currentScenario) {
        const stillExists = availableScenarios.find((s) => s.id === currentScenario.id)
        if (!stillExists) {
          if (storedScenarioId) {
            const savedScenario = availableScenarios.find((s) => s.id === storedScenarioId)
            if (savedScenario) {
              return savedScenario
            }
          }
          return null
        }
        // undefined = no change needed
        return undefined
      }

      if (storedScenarioId && availableScenarios.length > 0) {
        const scenario = availableScenarios.find((s) => s.id === storedScenarioId)
        if (scenario) {
          return scenario
        }
        // Stale key — stored scenario was deleted; clear it.
        if (currentSessionId) {
          clearStoredScenarioId(currentSessionId)
        }
      }

      // undefined = no change needed
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
    isLoading,
    isMutating,
    error,
    loadScenarios,
    createScenario,
    selectScenario,
    updateScenario,
    deleteScenario,
    clearScenario,
  }

  return <ScenarioContext value={value}>{children}</ScenarioContext>
}
