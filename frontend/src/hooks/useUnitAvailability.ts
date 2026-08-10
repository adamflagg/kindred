/**
 * Writing somebody into one cabin for a weekend, or releasing one to families.
 *
 * ## Why this is not `useLodgingPlacement` with a different body
 *
 * A placement belongs to a scenario. Availability does not — that is the whole
 * of 1500000135: a burst pipe closes a cabin in every plan for that weekend, so
 * the table lost its scenario column and the endpoint takes none. Two things
 * follow, and both are easy to get wrong by copying the placement hook:
 *
 * 1. **The write is not gated on having a scenario selected.** Requiring one
 *    would put the deleted dimension straight back at the UI layer: staff
 *    looking at the CampMinder mirror could not record a burst pipe.
 * 2. **The invalidation is by PREFIX, across every scenario.** The roster key
 *    carries a scenario (#1967), so invalidating only the visible key leaves
 *    the mirror and every other draft of the same weekend showing the cabin as
 *    open. `invalidateLodgingRegistryQueries` is the helper that already
 *    invalidates `['weekend-roster']`, `['weekend-summary']` and
 *    `['weekend-sessions']` as prefixes.
 *
 * ## Why there is no optimistic layer
 *
 * The placement hook has one because dnd-kit drops the card the moment the
 * pointer is released, so an invalidate-only path rubber-bands it back into
 * its old cabin for the seconds `build_roster` takes. Nothing here moves under
 * the pointer: the control disables itself, the toast confirms, and the board
 * redraws when the roster returns. Patching the cache optimistically would have
 * to patch every cached scenario of the weekend — the same reason the
 * invalidation is a prefix — for a click that is not a direct-manipulation
 * gesture.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import toast from 'react-hot-toast'

import { setUnitAvailability } from '../services/lodgingApi'
import { invalidateLodgingRegistryQueries } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export interface UseUnitAvailabilityOptions {
  year: number
  /** The weekend. `0` is "no weekend selected" and refuses to write. */
  sessionCmId: number
}

/** One unit's availability for this weekend, as the card states it. */
export interface AvailabilityIntent {
  unitId: string
  /** For the confirmation only — the write names the unit by id. */
  unitName: string
  /**
   * `false` writes an occupant into the unit, `true` releases it, `null`
   * DELETES the row so the unit's own role decides again. Never read for
   * truthiness.
   */
  familyAvailable: boolean | null
  /**
   * WHO is in the room (kindred#2078). Required by the card on a write-in;
   * `''` on a release and when clearing.
   */
  occupantName: string
  /** OPTIONAL on a write-in, required on a release; `''` when clearing. */
  reason: string
}

export interface UseUnitAvailabilityReturn {
  setAvailability: (intent: AvailabilityIntent) => Promise<void>
  /**
   * The unit id currently being written, or `''`.
   *
   * Not a bare `isPending`: 81 cards share one hook, and a boolean would
   * disable the control on all of them while one cabin is being held.
   */
  pendingUnitId: string
}

/**
 * Outcome wording, matching the badge vocabulary in `unitBadges.ts`.
 *
 * The write-in line NAMES the occupant, because that is the fact the staff
 * member just asserted and the one they can check the card against. It falls
 * back to the cabin alone if the name is somehow empty — the write schema is
 * permissive where the control is not — rather than confirming a blank.
 */
function confirmation({ unitName, familyAvailable, occupantName }: AvailabilityIntent): string {
  if (familyAvailable === null) return `${unitName} follows its usual role again`
  if (familyAvailable) return `${unitName} is released to families for this weekend`
  const named = occupantName.trim()
  return named === ''
    ? `${unitName} is written in for this weekend`
    : `${named} is written into ${unitName} for this weekend`
}

export function useUnitAvailability({
  year,
  sessionCmId,
}: UseUnitAvailabilityOptions): UseUnitAvailabilityReturn {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (intent: AvailabilityIntent) => {
      await setUnitAvailability(fetchWithAuth, {
        year,
        sessionCmId,
        unitId: intent.unitId,
        familyAvailable: intent.familyAvailable,
        occupantName: intent.occupantName,
        reason: intent.reason,
      })
    },

    onSuccess: (_result, intent) => {
      toast.success(confirmation(intent))
    },

    onError: (error) => {
      toast.error(error.message)
    },

    // On BOTH outcomes, for the reason the placement hook gives: a failure
    // here is not a race the server recovered from internally, and
    // `set_availability`'s own lost-race recovery can fail after the create
    // landed. Refetching is what makes the board agree with the server either
    // way.
    onSettled: () => {
      invalidateLodgingRegistryQueries(queryClient)
    },
  })

  const { mutateAsync } = mutation
  const setAvailability = useCallback(
    async (intent: AvailabilityIntent) => {
      // Refused BEFORE the write, the way the placement hook refuses an empty
      // scenario. `sessionCmId` defaults to 0 on the board for the tests that
      // do not exercise writes, and the schema declares `gt=0`.
      if (sessionCmId <= 0) {
        throw new Error('Select a weekend before changing availability.')
      }
      await mutateAsync(intent)
    },
    [mutateAsync, sessionCmId]
  )

  return {
    setAvailability,
    pendingUnitId: mutation.isPending ? mutation.variables.unitId : '',
  }
}
