/**
 * Merging a house into one card, or splitting it back into rooms.
 *
 * ## Why this is not `useLodgingPlacement` with a different body
 *
 * A placement is read-only on the mirror because the mirror IS CampMinder's
 * truth and a sync would overwrite a draft write. A draw level has no such
 * truth to protect: no sync ever writes `lodging_slot_merges`, so `scenario:
 * ''` is a legitimate write here — the weekend-level row, seen on the mirror
 * and inherited by every scenario that has not overridden it locally (see the
 * `SlotMergeRequest` doc in `types.gen.ts`). Gating this write on having a
 * scenario selected, the way placement does, would reintroduce a dimension
 * this hook does not need — the same mistake `useUnitAvailability` already
 * exists to avoid, and for the same underlying reason: 1500000135 established
 * that nothing here is CampMinder-sourced.
 *
 * `sessionCmId > 0` is the only refusal left, because the schema declares
 * `session_cm_id` `gt=0` regardless of which scenario (if any) is selected.
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
  /**
   * `''` is the CampMinder mirror — sent through, not refused. A draw level
   * is never CampMinder-sourced, so unlike a placement the mirror is a
   * legitimate write target; `''` becomes the weekend-level row.
   */
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

  const { mutateAsync } = mutation

  const setCombined = useCallback(
    async (unitId: string, unitName: string, combined: boolean) => {
      // ONE condition, not three, and not `scenario === ''` — see the file
      // doc. `sessionCmId > 0` stays because the schema declares
      // `session_cm_id` `gt=0`, and the board defaults it to 0 for the tests
      // that do not exercise writes.
      if (sessionCmId <= 0) return
      await mutateAsync({ unitId, unitName, combined })
    },
    // `mutateAsync`, NOT `mutation` — the whole result object is a new
    // identity on every render, which made `setCombined` unstable, and with it
    // the board's `onSplit`/`onMerge`. That is a prop change on all ~73 unit
    // cards on every board render, defeating their `memo` (measured: 73 of 73
    // card bodies re-rendered on drag start for no reason). Both sibling
    // hooks — `useUnitAvailability` and `useLodgingPlacement` — already depend
    // on `mutateAsync`; this one was the outlier.
    [mutateAsync, sessionCmId]
  )

  return {
    setCombined,
    /** The unit whose write is in flight, so its card can disable itself. */
    pendingUnitId: mutation.isPending ? mutation.variables.unitId : null,
  }
}
