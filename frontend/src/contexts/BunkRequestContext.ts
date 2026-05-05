import { createContext } from 'react'
import type { BunkRequest } from '../types/app-types'
import type { CamperSatisfaction } from '../types/satisfaction'

// Bunkmate info needed for satisfaction calculation
export interface BunkmateInfo {
  cmId: number
  grade: number | null
}

// Stage 3a parent-paramount Shape A. Three independent slices:
//   - materialParent  → source_field === 'bunk_with'      (parent must-have)
//   - bestEffortParent → source_field === 'socialize_with' (parent nice-to-have)
//   - staff            → source === 'staff'                (staff request)
// Plus derived violation flags surfaced for badges/alerts:
//   - parentMinOneViolation: material parent has >=1 unsatisfied request
//   - staffUnsatisfiedAlert: staff has >=1 request and zero satisfied
export interface RequestSlice {
  total: number
  satisfied: number
  satisfactionRate: number
}

export interface SatisfiedRequestInfo {
  materialParent: RequestSlice
  bestEffortParent: RequestSlice
  staff: RequestSlice
  parentMinOneViolation: boolean
  staffUnsatisfiedAlert: boolean
}

interface BunkRequestContextValue {
  // All requests for the session
  allRequests: BunkRequest[]
  // Lookup if a camper has any requests
  hasRequests: (personCmId: number) => boolean
  // Get all requests for a specific camper
  getRequestsForCamper: (personCmId: number) => BunkRequest[]
  // Get satisfied request info for a camper (fetched from /api/satisfaction)
  getSatisfiedRequestInfo: (personCmId: number) => CamperSatisfaction
  // Loading state
  isLoading: boolean
  error: Error | null
}

export const BunkRequestContext = createContext<BunkRequestContextValue | undefined>(undefined)
