import { createContext } from 'react';
import type { BunkRequest } from '../types/app-types';

// Bunkmate info needed for satisfaction calculation
export interface BunkmateInfo {
  cmId: number;
  grade: number | null;
}

interface BunkRequestContextValue {
  // All requests for the session
  allRequests: BunkRequest[];
  // Lookup if a camper has any requests
  hasRequests: (personCmId: number) => boolean;
  // Get all requests for a specific camper
  getRequestsForCamper: (personCmId: number) => BunkRequest[];
  // Get satisfied request info for a camper in a specific bunk
  getSatisfiedRequestInfo: (
    personCmId: number,
    bunkCmId: number,
    campersInBunk: BunkmateInfo[],
    requesterGrade: number | null
  ) => {
    totalRequests: number;
    satisfiedCount: number;
    topPrioritySatisfied: boolean;
    priorityLevels: number[];
    hasLockedPriority: boolean;
  };
  // Loading state
  isLoading: boolean;
  error: Error | null;
}

export const BunkRequestContext = createContext<BunkRequestContextValue | undefined>(undefined);