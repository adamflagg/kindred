/**
 * Hook for fetching original CSV bunk request data
 * Returns the raw data as stored from CampMinder sync
 *
 * The original_bunk_requests table stores each field type as separate records:
 * - requester: relation to persons
 * - field: "bunk_request_form" | "staff_not_bunk_with" | "bunking_notes" | "internal_notes" | "socialize_with"
 * - content: the raw text content
 *
 * This hook fetches all records for a person and transforms them into a denormalized object.
 */

import { useQuery } from '@tanstack/react-query'
import { pb } from '../../lib/pocketbase'
import type { OriginalBunkRequestsResponse, PersonsResponse } from '../../types/pocketbase-types'
import type { OriginalBunkData } from './types'
import { queryKeys } from '../../utils/queryKeys'

export interface UseOriginalBunkDataResult {
  originalBunkData: OriginalBunkData | null
  isLoading: boolean
  error: Error | null
}

export function useOriginalBunkData(
  personCmId: number | undefined,
  currentYear: number
): UseOriginalBunkDataResult {
  const {
    data: originalBunkData = null,
    isLoading,
    error,
  } = useQuery({
    queryKey: queryKeys.originalBunkRequestsByRequesterCmId(personCmId, currentYear),
    queryFn: async (): Promise<OriginalBunkData | null> => {
      if (!personCmId) {
        throw new Error('No camper person ID')
      }

      // Filter by relation field and year
      const filter = `requester.cm_id = ${personCmId} && year = ${currentYear}`
      const records = await pb
        .collection('original_bunk_requests')
        .getList<OriginalBunkRequestsResponse<{ requester?: PersonsResponse }>>(1, 100, {
          filter,
          expand: 'requester',
        })

      if (records.items.length === 0) {
        return null
      }

      // Transform normalized records into denormalized object
      const result: OriginalBunkData = {
        person_cm_id: personCmId,
      }

      for (const record of records.items) {
        const fieldName = record.field
        const content = record.content
        const updated = record.updated
        const processed = record.processed

        switch (fieldName) {
          case 'bunk_request_form':
            result.share_bunk_with = content
            if (updated) result.share_bunk_with_updated = updated
            if (processed) result.share_bunk_with_processed = processed
            break
          case 'staff_not_bunk_with':
            result.do_not_share_bunk_with = content
            if (updated) result.do_not_share_bunk_with_updated = updated
            if (processed) result.do_not_share_bunk_with_processed = processed
            break
          case 'bunking_notes':
            result.bunking_notes_notes = content
            if (updated) result.bunking_notes_notes_updated = updated
            if (processed) result.bunking_notes_notes_processed = processed
            break
          case 'internal_notes':
            result.internal_bunk_notes = content
            if (updated) result.internal_bunk_notes_updated = updated
            if (processed) result.internal_bunk_notes_processed = processed
            break
          case 'socialize_with':
            result.ret_parent_socialize_with_best = content
            if (updated) result.ret_parent_socialize_with_best_updated = updated
            if (processed) result.ret_parent_socialize_with_best_processed = processed
            break
        }
      }

      // Get first/last name from expanded requester if available
      const firstRecord = records.items[0]
      const requester = firstRecord?.expand.requester
      if (requester?.first_name) {
        result.first_name = requester.first_name
      }
      if (requester?.last_name) {
        result.last_name = requester.last_name
      }

      return result
    },
    enabled: !!personCmId,
  })

  return {
    originalBunkData,
    isLoading,
    error: error,
  }
}
