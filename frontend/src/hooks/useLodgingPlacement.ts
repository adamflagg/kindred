/**
 * Writing one placement, optimistically, inside a scenario.
 *
 * ## Why the optimistic layer is written from scratch
 *
 * The spec names summer's `useCamperMovement` as the exemplar. It is not one:
 * it has no `onMutate` at all, only `onSuccess` invalidation. So this hook is
 * the first optimistic mutation in the tree rather than a copy of an existing
 * pattern, and the rollback contract below is the part worth reading.
 *
 * ## Why it is mandatory rather than a polish item
 *
 * React Query serves the PREVIOUS data while a refetch is in flight, and
 * `LodgingBoard` derives its entire layout from `parties`. An
 * invalidate-only path therefore rubber-bands the dragged card back into the
 * cabin it came from until the roster returns — and `build_roster` issues
 * eleven PocketBase fetches, so that is seconds. `HANDOFF.md:612-613` also
 * requires it in as many words: "A rejected write must roll the card back with
 * a toast… A silent revert is not acceptable."
 *
 * ## Invalidation is not optional either
 *
 * The weekend queries carry the app-default 30 minute staleTime (PR #1965, to
 * match summer). Nothing refreshes on its own. The roster key carries a
 * scenario dimension (#1967), so the write must invalidate THIS scenario's
 * slot — invalidating the mirror's would leave the draft stale for half an
 * hour, which is the kind of failure nobody reports because it looks like the
 * board simply disagreeing.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import toast from 'react-hot-toast'

import {
  partyGrainBody,
  applyPlacement,
  type PlacementIntent,
} from '../components/weekend/dragPlacement'
import { placeParty, unplaceParty } from '../services/lodgingApi'
import type { WeekendRoster } from '../types/lodging'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export interface UseLodgingPlacementOptions {
  year: number
  sessionCmId: number
  /** `''` is the CampMinder mirror, where nothing may be written. */
  scenario: string
}

export interface UseLodgingPlacementReturn {
  move: (intent: PlacementIntent) => Promise<void>
  isMoving: boolean
}

/** What `onMutate` hands `onError` to undo an optimistic apply. */
interface PlacementContext {
  previous: WeekendRoster | undefined
}

export function useLodgingPlacement({
  year,
  sessionCmId,
  scenario,
}: UseLodgingPlacementOptions): UseLodgingPlacementReturn {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()
  const rosterKey = queryKeys.weekendRoster(year, sessionCmId, scenario)

  // Generics inferred rather than spelled out: writing `<void, …>` for TData
  // trips `no-invalid-void-type`, and React Query already infers TContext from
  // what `onMutate` returns — which is where the rollback value comes from.
  const mutation = useMutation({
    mutationFn: async (intent: PlacementIntent) => {
      const base = {
        year,
        sessionCmId,
        scenario,
        grain: partyGrainBody(intent.party),
      }
      if (intent.kind === 'place') {
        await placeParty(fetchWithAuth, { ...base, unitIds: [intent.unitId] })
        return
      }
      await unplaceParty(fetchWithAuth, base)
    },

    onMutate: async (intent): Promise<PlacementContext> => {
      // Without this an in-flight roster refetch can land AFTER the optimistic
      // write and overwrite it with pre-move data, which looks exactly like
      // the drag silently failing.
      await queryClient.cancelQueries({ queryKey: rosterKey })

      const previous = queryClient.getQueryData<WeekendRoster>(rosterKey)
      queryClient.setQueryData<WeekendRoster>(rosterKey, (current) =>
        current === undefined ? current : applyPlacement(current, intent)
      )
      return { previous }
    },

    onError: (error, _intent, context) => {
      // Restore the exact object captured before the apply. `applyPlacement`
      // is purely functional precisely so this snapshot is still the
      // pre-mutation state rather than an alias of the optimistic one.
      if (context?.previous !== undefined) {
        queryClient.setQueryData(rosterKey, context.previous)
      }
      toast.error(error.message)
    },

    // On BOTH outcomes. A rejected write can still have changed the server —
    // `place_party`'s unique-index race surfaces as a failure over a row that
    // now exists — so rolling back without refetching would leave the board
    // confidently wrong.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: rosterKey })
      void queryClient.invalidateQueries({ queryKey: queryKeys.weekendSummary(year) })
    },
  })

  const { mutateAsync } = mutation
  const move = useCallback(
    async (intent: PlacementIntent) => {
      // With no scenario the board is read-only for everyone, mirroring
      // summer's `isProductionMode`. The drop targets are already disabled;
      // this is the belt to that braces, and it refuses BEFORE the optimistic
      // apply so a blocked write cannot leave the mirror's cache edited.
      if (scenario === '') {
        throw new Error('Select a scenario before moving families.')
      }
      await mutateAsync(intent)
    },
    [mutateAsync, scenario]
  )

  return { move, isMoving: mutation.isPending }
}
