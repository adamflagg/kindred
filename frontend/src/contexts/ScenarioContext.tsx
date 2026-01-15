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

  // Pure function to determine validated scenario state
  // Uses useEffectEvent to read currentScenario without adding it as a dependency
  // Returns the scenario to set (or null to clear), or undefined if no change needed
  const getValidatedScenario = useEffectEvent((availableScenarios: Scenario[]): Scenario | null | undefined => {
    // Get stored scenario for THIS session
    const stored = localStorage.getItem('scenarioBySession');
    const scenarioBySession: Record<string, string> = stored ? JSON.parse(stored) : {};
    const storedScenarioId = currentSessionId ? scenarioBySession[currentSessionId] : null;

    // If we have a current scenario, check if it exists in the new session's scenarios
    if (currentScenario) {
      const stillExists = availableScenarios.find(s => s.id === currentScenario.id);
      if (!stillExists) {
        // Current scenario doesn't exist in this session - try to restore this session's saved scenario
        if (storedScenarioId) {
          const savedScenario = availableScenarios.find(s => s.id === storedScenarioId);
          if (savedScenario) {
            return savedScenario;
          }
        }
        // No saved scenario for this session - reset to production
        return null;
      }
      // Current scenario is valid, no change needed
      return undefined;
    }

    // No current scenario - try to restore from localStorage for this session
    if (storedScenarioId && availableScenarios.length > 0) {
      const scenario = availableScenarios.find(s => s.id === storedScenarioId);
      if (scenario) {
        return scenario;
      }
    }

    // No restoration possible, stay as-is
    return undefined;
  });

  // Validate scenario exists when scenarios list or session changes
  // Only depends on scenarios + currentSessionId, not currentScenario (avoids re-run loop)
  // setState is called here, not inside useEffectEvent
  useEffect(() => {
    const validatedResult = getValidatedScenario(scenarios);
    // undefined means no change needed, null/Scenario means update
    if (validatedResult !== undefined) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- Legitimate sync: restore scenario from localStorage on session change. Using useEffectEvent avoids dependency cycle. NOT a cascading render - only fires on scenarios/session change.
      setCurrentScenario(validatedResult);
    }
  }, [scenarios, currentSessionId]);
  
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