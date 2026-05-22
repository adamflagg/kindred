import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { useApiWithAuth } from './useApiWithAuth'
import { queryKeys, syncDataOptions } from '../utils/queryKeys'

export interface WaitlistedPerson {
  person_id: number
  first_name: string
  last_name: string
  preferred_name?: string | null
  grade?: number | null
  position: number
}

interface GenderAvailability {
  min_grade: number | null
  max_grade: number | null
  enrolled: number
  waitlisted: number
  capacity: number | null
  status: 'open' | 'limited' | 'full'
  waitlisted_by_grade: Record<number, number>
  waitlisted_persons: WaitlistedPerson[]
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
  status: 'open' | 'limited' | 'full'
  waitlisted_by_grade: Record<number, number>
  waitlisted_persons: WaitlistedPerson[]
}

export interface TeenSessionAvailabilityData {
  session_cm_id: number
  session_name: string
  session_type: string
  min_grade: number | null
  max_grade: number | null
  enrolled: number
  waitlisted: number
  capacity: number | null
  status: 'open' | 'limited' | 'full'
  waitlisted_by_grade: Record<number, number>
  waitlisted_persons: WaitlistedPerson[]
}

export interface SessionAvailabilityResponse {
  sessions: SessionAvailabilityData[]
  ag_sessions: AGSessionAvailabilityData[]
  teen_sessions: TeenSessionAvailabilityData[]
  limited_threshold: number
}

export function useSessionAvailability(
  year: number,
  sessionTypes?: string,
  sessionCmId?: number,
  duration?: string
) {
  const { fetchWithAuth, isAuthLoading } = useApiWithAuth()

  return useQuery({
    queryKey: queryKeys.sessionAvailability(year, sessionTypes, sessionCmId, duration),
    queryFn: async (): Promise<SessionAvailabilityResponse> => {
      const params = new URLSearchParams({ year: String(year) })
      if (sessionTypes) params.set('session_types', sessionTypes)
      if (sessionCmId != null) params.set('session_cm_id', String(sessionCmId))
      if (duration) params.set('duration', duration)

      const response = await fetchWithAuth(`/api/metrics/session-availability?${params}`)
      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.detail ?? 'Failed to fetch session availability')
      }
      return response.json()
    },
    enabled: year > 0 && !isAuthLoading,
    placeholderData: keepPreviousData,
    ...syncDataOptions,
  })
}
