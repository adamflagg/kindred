import type { ReactNode } from 'react';
import React, { useState, useEffect, useCallback, useMemo, useEffectEvent } from 'react';
import { ScenarioContext, type Scenario, type ScenarioContextType } from '../hooks/useScenario';
import { useSavedScenarios } from '../hooks/useSavedScenarios';
import { useCreateScenario, useDeleteScenario } from '../hooks/useSavedScenariosMutation';
import { useUpdateScenario, useClearScenario } from '../hooks/useScenarioOperations';
import { type SavedScenario } from '../lib/pocketbase';
import { useYear } from '../hooks/useCurrentYear';

interface ScenarioProviderProps {
  children: ReactNode;
}

// Convert SavedScenario to Scenario format
function savedScenarioToScenario(saved: SavedScenario): Scenario {
  // Get the session CM ID from the expanded relation if available
  const sessionCmId = saved.expand?.session?.cm_id || 0;
  
  return {
    id: saved.id,
    name: saved.name,
    session_cm_id: sessionCmId,
    created_by: saved.created_by,
    created: saved['created'],
    updated: saved['updated'],
    is_active: saved.is_active ?? true,
    description: saved.description || '',
  };
}

export const ScenarioProvider: React.FC<ScenarioProviderProps> = ({ children }) => {
  const [currentScenario, setCurrentScenario] = useState<Scenario | null>(null);
  const [currentSessionId, setCurrentSessionId] = useState<number | undefined>(undefined);
  const currentYear = useYear();
  // Track previous values for render-time validation
  const [prevSessionId, setPrevSessionId] = useState<number | undefined>(undefined);
  const [prevScenariosRef, setPrevScenariosRef] = useState<Scenario[]>([]);

  const isProductionMode = currentScenario === null;

  // Use React Query hooks - filter by session and year
  const { data: savedScenarios = [], isLoading, error: queryError } = useSavedScenarios(currentSessionId, currentYear);
  const createScenarioMutation = useCreateScenario();
  const updateScenarioMutation = useUpdateScenario();
  const deleteScenarioMutation = useDeleteScenario();
  const clearScenarioMutation = useClearScenario();
  
  // Convert SavedScenario[] to Scenario[]
  const scenarios = useMemo(() => 
    savedScenarios.map(savedScenarioToScenario),
    [savedScenarios]
  );
  
  // Combine errors from queries and mutations
  const error = queryError?.message || 
    createScenarioMutation.error?.message || 
    updateScenarioMutation.error?.message || 
    deleteScenarioMutation.error?.message || 
    clearScenarioMutation.error?.message || 
    null;
  
  // Combined loading state
  const loading = isLoading || 
    createScenarioMutation.isPending || 
    updateScenarioMutation.isPending || 
    deleteScenarioMutation.isPending || 
    clearScenarioMutation.isPending;
  
  // Load scenarios for a session
  const loadScenarios = useCallback(async (sessionId: number) => {
    setCurrentSessionId(sessionId);
    // React Query will automatically fetch when sessionId changes
  }, []);
  
  // Create a new scenario
  const createScenario = useCallback(async (
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
      ...(copyOptions !== undefined && { copyOptions })
    });

    const scenario = savedScenarioToScenario(savedScenario);
    setCurrentScenario(scenario);
    return scenario;
  }, [createScenarioMutation]);
  
  // Select a scenario (null for production mode)
  const selectScenario = useCallback((scenarioId: string | null) => {
    if (scenarioId === null) {
      setCurrentScenario(null);
    } else {
      const scenario = scenarios.find(s => s.id === scenarioId);
      if (scenario) {
        setCurrentScenario(scenario);
      }
    }
  }, [scenarios]);
  
  // Update scenario metadata
  const updateScenario = useCallback(async (scenarioId: string, updates: { name?: string; description?: string }) => {
    const updatedSavedScenario = await updateScenarioMutation.mutateAsync({
      scenarioId,
      updates
    });
    
    const updatedScenario = savedScenarioToScenario(updatedSavedScenario);
    
    // Update current scenario if it's the one being updated
    if (currentScenario?.id === scenarioId) {
      setCurrentScenario(updatedScenario);
    }
  }, [currentScenario, updateScenarioMutation]);
  
  // Delete a scenario
  const deleteScenario = useCallback(async (scenarioId: string) => {
    await deleteScenarioMutation.mutateAsync(scenarioId);
    
    // Clear current scenario if it's the one being deleted
    if (currentScenario?.id === scenarioId) {
      setCurrentScenario(null);
    }
  }, [currentScenario, deleteScenarioMutation]);
  
  // Clear all assignments in a scenario
  const clearScenario = useCallback(async (scenarioId: string, year: number) => {
    await clearScenarioMutation.mutateAsync({
      scenarioId,
      year
    });
  }, [clearScenarioMutation]);
  
  // Stable localStorage sync using useEffectEvent
  // Stores scenario selection PER SESSION so switching sessions doesn't lose your choice
  const syncToLocalStorage = useEffectEvent((sessionId: number | undefined, scenarioId: string | null) => {
    if (!sessionId) return;

    // Get existing per-session storage
    const stored = localStorage.getItem('scenarioBySession');
    const scenarioBySession: Record<string, string> = stored ? JSON.parse(stored) : {};

    if (scenarioId) {
      scenarioBySession[sessionId] = scenarioId;
    } else {
      // Use Reflect.deleteProperty to satisfy no-dynamic-delete rule
      Reflect.deleteProperty(scenarioBySession, String(sessionId));
    }

    localStorage.setItem('scenarioBySession', JSON.stringify(scenarioBySession));
  });

  // Store current scenario in localStorage for persistence (per session)
  useEffect(() => {
    syncToLocalStorage(currentSessionId, currentScenario?.id ?? null);
  }, [currentScenario?.id, currentSessionId]);

  // Validate scenario exists when scenarios list or session changes (render-time check)
  // Avoids setState in useEffect by checking during render
  const scenariosChanged = scenarios !== prevScenariosRef;
  const sessionIdChanged = currentSessionId !== prevSessionId;
  if (scenariosChanged || sessionIdChanged) {
    if (scenariosChanged) setPrevScenariosRef(scenarios);
    if (sessionIdChanged) setPrevSessionId(currentSessionId);

    // Inline validation logic (can't use useEffectEvent from render)
    const stored = localStorage.getItem('scenarioBySession');
    const scenarioBySession: Record<string, string> = stored ? JSON.parse(stored) : {};
    const storedScenarioId = currentSessionId ? scenarioBySession[currentSessionId] : null;

    let validatedResult: Scenario | null | undefined = undefined;

    if (currentScenario) {
      // Check if current scenario exists in the new session's scenarios
      const stillExists = scenarios.find(s => s.id === currentScenario.id);
      if (!stillExists) {
        // Try to restore this session's saved scenario
        if (storedScenarioId) {
          const savedScenario = scenarios.find(s => s.id === storedScenarioId);
          validatedResult = savedScenario ?? null;
        } else {
          validatedResult = null;
        }
      }
    } else if (storedScenarioId && scenarios.length > 0) {
      // No current scenario - try to restore from localStorage
      const scenario = scenarios.find(s => s.id === storedScenarioId);
      if (scenario) {
        validatedResult = scenario;
      }
    }

    // undefined means no change needed, null/Scenario means update
    if (validatedResult !== undefined) {
      setCurrentScenario(validatedResult);
    }
  }
  
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
  };
  
  return (
    <ScenarioContext.Provider value={value}>
      {children}
    </ScenarioContext.Provider>
  );
};