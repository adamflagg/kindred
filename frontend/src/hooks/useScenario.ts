import { useContext, createContext } from 'react';

export interface Scenario {
  id: string;
  name: string;
  session_cm_id: number;
  created_by?: string;
  created?: string;
  updated?: string;
  is_active: boolean;
  description?: string;
}

export interface ScenarioContextType {
  // Current scenario state
  currentScenario: Scenario | null;
  isProductionMode: boolean;
  scenarios: Scenario[];
  
  // Loading states
  loading: boolean;
  error: string | null;
  
  // Actions
  loadScenarios: (sessionId: number) => Promise<void>;
  createScenario: (name: string, sessionId: number, year: number, description?: string, copyOptions?: { fromProduction: boolean } | { fromScenario: string }) => Promise<Scenario>;
  selectScenario: (scenarioId: string | null) => void;
  updateScenario: (scenarioId: string, updates: { name?: string; description?: string }) => Promise<void>;
  deleteScenario: (scenarioId: string) => Promise<void>;
  clearScenario: (scenarioId: string, year: number) => Promise<void>;
}

export const ScenarioContext = createContext<ScenarioContextType | undefined>(undefined);

export const useScenario = () => {
  const context = useContext(ScenarioContext);
  if (!context) {
    throw new Error('useScenario must be used within a ScenarioProvider');
  }
  return context;
};