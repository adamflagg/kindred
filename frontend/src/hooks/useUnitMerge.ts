/**
 * Merging a house into one card, or splitting it back into rooms.
 *
 * ## Why this is not `useUnitAvailability` with a different body
 *
 * Availability carries NO scenario — 1500000135, a burst pipe closes a cabin in
 * every plan for that weekend. A draw level is the opposite: it is a planning
 * choice, so it lives only in a draft and the write is gated on having a
 * scenario selected. Copying the availability hook's gating would let the
 * CampMinder mirror write an override it must never have.
 *
 * ## What it shares
 *
 * The invalidation is BY PREFIX, for the reason `useUnitAvailability`
 * documents: the roster key carries a scenario (#1967), so invalidating only
 * the visible key leaves every other draft of the weekend drawing the house at
 * the old level. `invalidateLodgingRegistryQueries` already invalidates
 * `['weekend-roster']`, `['weekend-summary']` and `['weekend-sessions']` as
 * prefixes.
 *
 * And there is no optimistic layer, for the same reason: nothing moves under
 * the pointer. The card is replaced when the roster returns, and patching the
 * cache optimistically would have to patch every cached scenario of the
 * weekend.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import toast from 'react-hot-toast'

import { setSlotMerge } from '../services/lodgingApi'
import { invalidateLodgingRegistryQueries } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export interface UseUnitMergeOptions {
  year: number
  /** The weekend. `0` is "no weekend selected" and refuses to write. */
  sessionCmId: number
  /** `''` is the CampMinder mirror, which refuses to write. */
  scenario: string
}

export function useUnitMerge({ year, sessionCmId, scenario }: UseUnitMergeOptions) {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (vars: { unitId: string; unitName: string; combined: boolean }) =>
      setSlotMerge(fetchWithAuth, {
        year,
        session_cm_id: sessionCmId,
        scenario,
        unit_id: vars.unitId,
        combined: vars.combined,
      }),
    onSuccess: () => {
      invalidateLodgingRegistryQueries(queryClient)
    },
    onError: (error: unknown, vars) => {
      toast.error(
        `Could not ${vars.combined ? 'merge' : 'split'} ${vars.unitName}: ${
          error instanceof Error ? error.message : 'unknown error'
        }`
      )
    },
  })

  const setCombined = useCallback(
    async (unitId: string, unitName: string, combined: boolean) => {
      // THREE conditions, matching `canPlace` on the board. `sessionCmId > 0`
      // is in there because the schema declares `gt=0`, and the board defaults
      // it to 0 for the tests that do not exercise writes.
      if (scenario === '' || sessionCmId <= 0) return
      await mutation.mutateAsync({ unitId, unitName, combined })
    },
    [mutation, scenario, sessionCmId]
  )

  return {
    setCombined,
    /** The unit whose write is in flight, so its card can disable itself. */
    pendingUnitId: mutation.isPending ? mutation.variables.unitId : null,
  }
}
