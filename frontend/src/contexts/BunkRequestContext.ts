import { createContext } from 'react'
import type { BunkRequest } from '../types/app-types'

// Bunkmate info needed for satisfaction calculation
export interface BunkmateInfo {
  cmId: number
  grade: number | null
}

// Stage 2 parent-paramount split. Parent = source==='family' (bunk_with +
// socialize_with). Staff = source==='staff' (not_bunk_with + bunking_notes +
// internal_notes). Requests with source==='notes' or unset fall through both
// splits but still count in the aggregate totalRequests/satisfiedCount.
export interface SatisfiedRequestInfo {
  totalRequests: number
  satisfiedCount: number
  topPrioritySatisfied: boolean
  priorityLevels: number[]
  hasLockedPriority: boolean
  parentTotal: number
  parentSatisfied: number
  staffTotal: number
  staffSatisfied: number
}

interface BunkRequestContextValue {
  // All requests for the session
  allRequests: BunkRequest[]
  // Lookup if a camper has any requests
  hasRequests: (personCmId: number) => boolean
  // Get all requests for a specific camper
  getRequestsForCamper: (personCmId: number) => BunkRequest[]
  // Get satisfied request info for a camper in a specific bunk
  getSatisfiedRequestInfo: (
    personCmId: number,
    bunkCmId: number,
    campersInBunk: BunkmateInfo[],
    requesterGrade: number | null
  ) => SatisfiedRequestInfo
  // Loading state
  isLoading: boolean
  error: Error | null
}

export const BunkRequestContext = createContext<BunkRequestContextValue | undefined>(undefined)
