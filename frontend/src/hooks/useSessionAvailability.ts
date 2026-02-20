import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import { queryKeys, userDataOptions } from '../utils/queryKeys'

interface GenderAvailability {
  min_grade: number | null
  max_grade: number | null
  enrolled: number
  waitlisted: number
  capacity: number | null
  status: 'open' | 'limited' | 'waitlist'
}

export interface SessionAvailabilityData {
  session_cm_id: number
  session_name: string
  session_type: string
  sort_order: number
  girls: GenderAvailability
  boys: GenderAvailability
}

export interface AGSessionAvailabilityData {
  session_cm_id: number
  session_name: string
  parent_session_name: string | null
  min_grade: number | null
  max_grade: number | null
  enrolled: number
  waitlisted: number
  capacity: number | null
  status: 'open' | 'limited' | 'waitlist'
}

export interface SessionAvailabilityResponse {
  sessions: SessionAvailabilityData[]
  ag_sessions: AGSessionAvailabilityData[]
  limited_threshold: number
}

export function useSessionAvailability(year: number) {
  return useQuery({
    queryKey: queryKeys.sessionAvailability(year),
    ...userDataOptions,
    queryFn: async (): Promise<SessionAvailabilityResponse> => {
      const token = pb.authStore.token
      const response = await fetch(`/api/metrics/session-availability?year=${year}`, {
        headers: { Authorization: token },
      })
      if (!response.ok) {
        throw new Error(`Failed to fetch session availability: ${response.status}`)
      }
      return response.json()
    },
    enabled: year > 0,
  })
}
