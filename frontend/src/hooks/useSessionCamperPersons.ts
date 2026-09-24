import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import type {
  AttendeesResponse,
  CampSessionsResponse,
  PersonsResponse,
} from '../types/pocketbase-types'
import { queryKeys } from '../utils/queryKeys'

interface ExpandedAttendee {
  person?: PersonsResponse
  session?: Pick<CampSessionsResponse, 'start_date'>
}

/**
 * An enrolled person, plus the start date of the session they were fetched
 * for — the picker reads a prior year's age at it (owner ruling 2026-09-24,
 * see utils/displayAge.ts). Still assignable to `PersonsResponse`.
 */
export type SessionCamperPerson = PersonsResponse & { session_start_date?: string }

/**
 * Fetches enrolled camper persons for a given session and year.
 * Returns SessionCamperPerson[] — the canonical shape for this queryKey.
 */
export function useSessionCamperPersons(
  sessionId: number,
  year: number,
  options?: { enabled?: boolean }
) {
  return useQuery<SessionCamperPerson[]>({
    queryKey: queryKeys.sessionCampers(sessionId, year),
    queryFn: async () => {
      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter: `session.cm_id = ${sessionId} && year = ${year} && status = "enrolled"`,
        expand: 'person,session',
      })

      return attendees.flatMap((attendee): SessionCamperPerson[] => {
        const expanded = attendee.expand as ExpandedAttendee | undefined
        const person = expanded?.person
        if (!person) return []
        const start = expanded.session?.start_date
        return [start ? { ...person, session_start_date: start } : person]
      })
    },
    ...(options?.enabled !== undefined && { enabled: options.enabled }),
  })
}
