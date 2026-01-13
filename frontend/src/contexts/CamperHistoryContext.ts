import { createContext } from 'react';

export interface CamperHistory {
  year: number;
  sessionName: string;
  sessionType: string;
  bunkName: string;
  startDate?: string;
  endDate?: string;
}

interface CamperHistoryContextValue {
  // Get last year's history for a specific camper
  getLastYearHistory: (personCmId: number) => CamperHistory | null;
  // Loading state
  isLoading: boolean;
  error: Error | null;
}

export const CamperHistoryContext = createContext<CamperHistoryContextValue | undefined>(undefined);