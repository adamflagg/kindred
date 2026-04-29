/**
 * Hook for checking request satisfaction status
 * Lazy-loads after main data to avoid blocking the page
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import { computeRequestSatisfaction } from '../../utils/requestSatisfaction'
import type { BunkAssignmentsResponse } from '../../types/pocketbase-types'
import type { SatisfactionMap } from './types'
import type { EnhancedBunkRequest } from './useAllBunkRequests'

export interface UseSatisfactionDataResult {
  satisfactionData: SatisfactionMap
  isLoading: boolean
  error: Error | null
}

export function useSatisfactionData(
  personCmId: number | undefined,
  assignedBunkCmId: number | undefined,
  sessionCmId: number | undefined,
  camperGrade: number | undefined,
  currentYear: number,
  allBunkRequests: EnhancedBunkRequest[]
): UseSatisfactionDataResult {
  const {
    data: satisfactionData = {},
    isLoading,
    error,
  } = useQuery<SatisfactionMap>({
    queryKey: [
      'request-satisfaction',
      personCmId,
      assignedBunkCmId,
      sessionCmId,
      camperGrade,
      currentYear,
      allBunkRequests.map((r) => r.id).join(','),
    ],
    queryFn: async () => {
      const results: SatisfactionMap = {}

      if (!assignedBunkCmId || !sessionCmId) {
        // Requester not assigned — pure util would return 'unknown' for every
        // request; preserve historical behavior of returning empty map so the
        // UI shows no pill at all (rather than an unknown badge per request).
        return results
      }

      // Person-based requests we'll evaluate (resolved + valid target only)
      const personRequests = allBunkRequests.filter(
        (r) =>
          r.status === 'resolved' &&
          r.requestee_id &&
          r.requestee_id > 0 &&
          (r.request_type === 'bunk_with' || r.request_type === 'not_bunk_with')
      )

      // Age-pref requests we'll evaluate (resolved + valid target).
      // Spec §2.1: only resolved rows are evaluated. The personRequests
      // filter above already enforces this; matched here so pending /
      // declined age preferences (e.g. SAME_AGE held for staff review)
      // don't render satisfaction badges in CamperDetail full-page view.
      const agePreferenceRequests = allBunkRequests.filter(
        (r) =>
          r.request_type === 'age_preference' && r.status === 'resolved' && r.age_preference_target
      )

      if (personRequests.length === 0 && agePreferenceRequests.length === 0) {
        return results
      }

      try {
        const allAssignments = await pb
          .collection<BunkAssignmentsResponse>('bunk_assignments')
          .getFullList({
            filter: `year = ${currentYear}`,
            expand: 'person,bunk,session',
          })

        interface ExpandedAssignmentData {
          session?: { cm_id?: number }
          person?: { cm_id?: number; grade?: number }
          bunk?: { cm_id?: number }
        }

        // Filter to same session as the requester
        const sessionAssignments = allAssignments.filter((a) => {
          const expanded = a.expand as ExpandedAssignmentData | undefined
          return expanded?.session?.cm_id === sessionCmId
        })

        const personToBunk = new Map<number, number>()
        const bunkToPersons = new Map<number, Array<{ cmId: number; grade: number }>>()

        for (const a of sessionAssignments) {
          const expanded = a.expand as ExpandedAssignmentData | undefined
          const person = expanded?.person
          const bunk = expanded?.bunk
          if (person?.cm_id && bunk?.cm_id) {
            personToBunk.set(person.cm_id, bunk.cm_id)
            if (!bunkToPersons.has(bunk.cm_id)) bunkToPersons.set(bunk.cm_id, [])
            if (person.grade !== undefined) {
              bunkToPersons.get(bunk.cm_id)!.push({ cmId: person.cm_id, grade: person.grade })
            }
          }
        }

        // Requester's bunkmates (excludes requester) — same for all this camper's requests
        const requesterBunkmates = (bunkToPersons.get(assignedBunkCmId) ?? []).filter(
          (b) => b.cmId !== personCmId
        )

        for (const request of [...personRequests, ...agePreferenceRequests]) {
          const targetBunkCmId =
            request.requestee_id && request.requestee_id > 0
              ? (personToBunk.get(request.requestee_id) ?? null)
              : null
          results[request.id] = computeRequestSatisfaction({
            request,
            requesterBunkCmId: assignedBunkCmId,
            requesterBunkmates,
            targetBunkCmId,
            requesterGrade: camperGrade ?? null,
          })
        }

        return results
      } catch (err) {
        console.error('Error checking request satisfaction:', err)
        return results
      }
    },
    enabled: !!personCmId && allBunkRequests.length > 0,
    staleTime: 60000, // Cache for 1 minute
  })

  return {
    satisfactionData,
    isLoading,
    error: error,
  }
}
