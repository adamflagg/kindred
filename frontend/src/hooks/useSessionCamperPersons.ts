import { useQuery } from '@tanstack/react-query'
import { pb } from '../lib/pocketbase'
import type { PersonsResponse, AttendeesResponse } from '../types/pocketbase-types'
import { queryKeys } from '../utils/queryKeys'

interface ExpandedAttendee {
  person?: PersonsResponse
}

/**
 * Fetches enrolled camper persons for a given session and year.
 * Returns PersonsResponse[] — the canonical shape for this queryKey.
 */
export function useSessionCamperPersons(
  sessionId: number,
  year: number,
  options?: { enabled?: boolean }
) {
  return useQuery<PersonsResponse[]>({
    queryKey: queryKeys.sessionCampers(sessionId, year),
    queryFn: async () => {
      const attendees = await pb.collection<AttendeesResponse>('attendees').getFullList({
        filter: `session.cm_id = ${sessionId} && year = ${year} && status = "enrolled"`,
        expand: 'person',
      })

      return attendees
        .map((attendee) => {
          const expanded = attendee.expand as ExpandedAttendee | undefined
          return expanded?.person
        })
        .filter((p): p is PersonsResponse => p !== undefined)
    },
    ...(options?.enabled !== undefined && { enabled: options.enabled }),
  })
}
