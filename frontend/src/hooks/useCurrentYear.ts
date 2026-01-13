import { useContext, createContext } from 'react';

export interface CurrentYearContextType {
  currentYear: number;
  setCurrentYear: (year: number) => void;
  availableYears: number[];
  isTransitioning: boolean;
}

export const CurrentYearContext = createContext<CurrentYearContextType | undefined>(undefined);

export function useCurrentYear() {
  const context = useContext(CurrentYearContext);
  if (!context) {
    throw new Error('useCurrentYear must be used within a CurrentYearProvider');
  }
  return context;
}

// Helper hook for components that need just the year value
export function useYear() {
  const { currentYear } = useCurrentYear();
  return currentYear;
}