/**
 * Writing somebody into one cabin for a weekend, or releasing one to families.
 *
 * ## Why this is not `useLodgingPlacement` with a different body
 *
 * A placement REQUIRES a scenario, and refuses to write without one. This
 * write carries one and never requires it, which is a different rule dressed
 * in the same word — the endpoint's `scenario` is optional and blank means the
 * LIVE board, a scope in its own right. Two things follow, and both are easy to
 * get wrong by copying the placement hook:
 *
 * 1. **The write is not gated on having a scenario selected.** Requiring one
 *    would put back at the UI layer the dimension 1500000135 deleted: staff
 *    looking at the CampMinder mirror — which is where most of them look —
 *    could not record a write-in at all.
 * 2. **The invalidation is by PREFIX, across every scenario.** The roster key
 *    carries a scenario (#1967), and one write can move two boards at once: an
 *    occupancy lands on the scenario named below, while a RELEASE is a
 *    weekend-level fact that every scenario of that weekend inherits. So
 *    invalidating only the visible key leaves the mirror and every other draft
 *    of the same weekend showing the cabin as open.
 *    `invalidateLodgingRegistryQueries` is the helper that already invalidates
 *    `['weekend-roster']`, `['weekend-summary']` and `['weekend-sessions']` as
 *    prefixes.
 *
 * ## Why there is no optimistic layer
 *
 * The placement hook has one because dnd-kit drops the card the moment the
 * pointer is released, so an invalidate-only path rubber-bands it back into
 * its old cabin for the seconds `build_roster` takes. Nothing here moves under
 * the pointer: the control disables itself and the board redraws when the
 * roster returns. Patching the cache optimistically would have
 * to patch every cached scenario of the weekend — the same reason the
 * invalidation is a prefix — for a click that is not a direct-manipulation
 * gesture.
 *
 * ## No success toast (owner ruling, 2026-08-18)
 *
 * This hook was the ONLY mutation on the weekend board that confirmed success
 * in a toast. `useLodgingPlacement` (place, move and unplace a family) and
 * `useUnitMerge` (merge and split a building) both raise errors only, and the
 * ruling settled the inconsistency in their favour:
 *
 *   > "dont think we need toasts for adding or removing write ins"
 *
 * The card IS the confirmation — a write-in appears in the well, or its card
 * goes away — so the toast restated what the board had already redrawn. The
 * clear branch was the worst of the three: "<cabin> follows its usual role
 * again" described an internal availability state rather than the thing the
 * staff member had just done, which is what prompted the ruling.
 *
 * ⚠️ A DELIBERATE divergence from summer, stated here because the root
 * CLAUDE.md requires one to be justified where it happens:
 * `session/useCamperMovement.ts` fires `toast.success('Camper moved
 * successfully')`. Summer's move changes a value in a dense table where
 * nothing else marks the write; this board draws or removes a whole card.
 * Errors still toast on both surfaces.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import toast from 'react-hot-toast'

import { deleteWriteIn, setUnitAvailability } from '../services/lodgingApi'
import { invalidateLodgingRegistryQueries } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

export interface UseUnitAvailabilityOptions {
  year: number
  /** The weekend. `0` is "no weekend selected" and refuses to write. */
  sessionCmId: number
  /**
   * WHICH BOARD an occupancy lands on — `''` is the live board (kindred#2382).
   *
   * NOT a gate, unlike `useLodgingPlacement`'s. Blank writes the live
   * occupancy table, which is what staff evaluating the real board need; a
   * scenario id writes that scenario's own draft, which is what closes the gap
   * PR 3 opened by making a scenario's read REPLACE the live rows.
   *
   * Optional and blank-defaulted so the board tests that exercise no writes
   * keep their existing shape, matching the `scenario` prop on `LodgingBoard`
   * that feeds it.
   */
  scenario?: string
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
  /**
   * How many people the write-in is for (kindred#2503). `null` is a REAL
   * value — nobody recorded a count — not a missing one; most write-ins are
   * non-rostered staff and staff will type nothing. Mirrors
   * `UnitAvailabilityWrite.partySize` in `writeIn.ts`, which is where the
   * full producer-by-producer accounting lives.
   */
  partySize: number | null
  /**
   * WHICH ROW this edit is about, when it changes the occupant's own name
   * (kindred#2583 step 4). `null` renames nobody — the Assign modal's create,
   * addressed by `occupantName` as before. A string, `''` included, is the
   * name the pencil LOADED, and the server compare-and-swaps on it.
   *
   * ⚠️ FORWARDED, never re-derived and never collapsed. `?? null`, `|| null`
   * or a truthiness test here turns `''` — the unnamed row's real address —
   * back into "no rename", which is the one row the field exists for. And
   * dropping the key entirely reads as `null` on the wire, so an ordinary
   * rename would silently create a second row the moment step 8 lands.
   */
  previousOccupantName: string | null
}

/** Taking ONE occupant out of one unit, as the card's corner × states it. */
export interface WriteInRemovalIntent {
  /**
   * The unit that HOLDS the row, which is not always the card it was clicked
   * on — the same target `AvailabilityIntent.unitId` carries.
   */
  unitId: string
  /** For the error message only — the removal names the unit by id. */
  unitName: string
  /** WHICH occupant. The other half of the Design B address, and required. */
  occupantName: string
}

export interface UseUnitAvailabilityReturn {
  setAvailability: (intent: AvailabilityIntent) => Promise<void>
  /**
   * Remove ONE occupant, leaving whoever else is in the cabin (kindred#2583
   * step 7's verb, wired up by step 4).
   *
   * A SECOND MUTATION rather than a branch inside `setAvailability`, because
   * it is a different verb on a different endpoint: `PUT /availability` with
   * `familyAvailable: null` still means CLEAR THIS UNIT ENTIRELY — the role
   * row and every occupancy row — and that meaning is unchanged. What moved
   * is which of the two the × sends.
   */
  removeWriteIn: (intent: WriteInRemovalIntent) => Promise<void>
  /**
   * The unit id currently being written, or `''`.
   *
   * Not a bare `isPending`: 81 cards share one hook, and a boolean would
   * disable the control on all of them while one cabin is being held.
   */
  pendingUnitId: string
}

export function useUnitAvailability({
  year,
  sessionCmId,
  scenario = '',
}: UseUnitAvailabilityOptions): UseUnitAvailabilityReturn {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  const mutation = useMutation({
    mutationFn: async (intent: AvailabilityIntent) => {
      await setUnitAvailability(fetchWithAuth, {
        year,
        sessionCmId,
        scenario,
        unitId: intent.unitId,
        familyAvailable: intent.familyAvailable,
        occupantName: intent.occupantName,
        reason: intent.reason,
        partySize: intent.partySize,
        // Straight through, like `partySize` beside it. This glue is not the
        // place to decide whether a write renames anybody — the card that
        // opened the form is the only thing that knows the name it loaded.
        previousOccupantName: intent.previousOccupantName,
      })
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

  /*
   * THE ROW-ADDRESSED REMOVAL, kept beside the write rather than in a hook of
   * its own: they share the weekend, the scenario, the invalidation and the
   * one `pendingUnitId` every corner control on the board keys off. Two hooks
   * would be two answers to "is this card waiting", and the card would have
   * to merge them.
   */
  const removal = useMutation({
    mutationFn: async (intent: WriteInRemovalIntent) => {
      await deleteWriteIn(fetchWithAuth, {
        year,
        sessionCmId,
        scenario,
        unitId: intent.unitId,
        occupantName: intent.occupantName,
      })
    },

    onError: (error) => {
      toast.error(error.message)
    },

    // The same both-outcomes invalidation the write makes, for the same
    // reason and with the same reach: a removal made inside one draft has to
    // refresh the mirror and every other draft of the weekend, or a board
    // somewhere keeps drawing an occupant who is gone for the 30 minutes the
    // weekend queries stay fresh.
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

  const { mutateAsync: removeAsync } = removal
  const removeWriteIn = useCallback(
    async (intent: WriteInRemovalIntent) => {
      // The same pre-write refusal, spelled once per verb rather than shared:
      // the message names the thing the staff member was doing.
      if (sessionCmId <= 0) {
        throw new Error('Select a weekend before changing availability.')
      }
      await removeAsync(intent)
    },
    [removeAsync, sessionCmId]
  )

  return {
    setAvailability,
    removeWriteIn,
    // ONE answer covering both verbs. The board disables a card's corner
    // controls on this id, and a removal that did not report itself would
    // leave the × live for its whole round trip. Only one can be in flight
    // from a given card, because the first click disables the rest.
    pendingUnitId: mutation.isPending
      ? mutation.variables.unitId
      : removal.isPending
        ? removal.variables.unitId
        : '',
  }
}
