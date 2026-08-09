/**
 * Weekend friend groups: the read, and the three writes (kindred#1913 half 1).
 *
 * ## Caching models the roster's, which models summer's
 *
 * No cache options, so this inherits the app defaults in
 * `utils/queryClient.ts` — exactly what `useWeekendRoster` does and what the
 * summer board's own `hooks/session/useSessionData.ts` does. A weekend is
 * worked by ONE person at a time, so there is no concurrent-edit hazard to buy
 * with a short staleTime.
 *
 * The other half of that bargain is NOT optional and is what the roster's
 * comment warns about: long staleTime plus EXPLICIT invalidation on mutation,
 * never short staleTime plus hope. Each of the three mutations below AWAITS
 * the invalidation of the group key before it resolves — see `invalidate`,
 * where the difference between awaiting it and firing it off decides whether
 * two overlapping membership edits can silently undo one another.
 *
 * ## The key carries no scenario, and that is deliberate
 *
 * `weekendRoster` keys on `(year, sessionCmId, scenario)` because a scenario
 * REPLACES the mirror, so the two are different documents. A friend group has
 * no scenario dimension at all (migration 1500000146): it records what
 * households asked for, which is true of the weekend in every plan for it. A
 * scenario in this key would mint one cache entry per scenario for identical
 * data and make a group authored in one invisible in another.
 *
 * ## Gated on `year > 0`
 *
 * `CurrentYearContext` returns the literal 0 until the backend supplies the
 * configured year. Without the guard this fires `?year=0` against a router
 * declaring `ge=2000` and eats a 422 on every cold load — the same trap every
 * hook in `useWeekendRoster.ts` documents.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'
import toast from 'react-hot-toast'

import {
  createFriendGroup,
  deleteFriendGroup,
  fetchFriendGroups,
  updateFriendGroup,
} from '../services/friendGroupsApi'
import type {
  FriendGroupCreate,
  FriendGroupList,
  FriendGroupRow,
  FriendGroupUpdate,
} from '../types/friendGroups'
import { queryKeys } from '../utils/queryKeys'
import { useApiWithAuth } from './useApiWithAuth'

/** Every friend group on one weekend. Idle until a weekend and a year exist. */
export function useWeekendFriendGroups(year: number, sessionCmId: number | null) {
  const { fetchWithAuth } = useApiWithAuth()
  return useQuery<FriendGroupList>({
    queryKey: queryKeys.weekendFriendGroups(year, sessionCmId ?? 0),
    enabled: year > 0 && sessionCmId !== null && sessionCmId > 0,
    queryFn: () => fetchFriendGroups(fetchWithAuth, year, sessionCmId as number),
  })
}

/** What a caller may hang off a mutation that SUCCEEDED. */
export interface MutationCallbacks {
  onSuccess?: () => void
}

export interface FriendGroupMutations {
  /**
   * `options.onSuccess` is not decoration. `mutate` is fire-and-forget, so a
   * caller that resets its own UI on the next line resets it on failure too —
   * and the action bar's "own UI" is the staff member's entire selection.
   */
  createGroup: (body: FriendGroupCreate, options?: MutationCallbacks) => void
  updateGroup: (groupId: string, body: FriendGroupUpdate) => void
  /**
   * Promise-returning sibling of `updateGroup`, for a caller that must know
   * whether the write LANDED before deciding what to do with its own UI state
   * — kindred#1913's board-level "Add to group", which keeps the staff
   * member's selection when the PATCH fails and clears it when every household
   * they picked made it in.
   *
   * It writes to the TARGET GROUP ONLY. An earlier cut drained the household's
   * previous group in the same gesture, which is why this was introduced; the
   * owner struck that on 2026-08-09 ("same behavior" as summer, which never
   * deletes a membership to make one), so the sequencing this exists for is
   * now success-vs-failure rather than two writes.
   *
   * `updateGroup` stays fire-and-forget for the ordinary callers (rename,
   * recolour, the per-card add/remove) so their call sites don't have to think
   * about a promise they don't need.
   */
  updateGroupAsync: (groupId: string, body: FriendGroupUpdate) => Promise<FriendGroupRow>
  deleteGroup: (groupId: string) => void
  isPending: boolean
}

/**
 * Author, edit and dissolve.
 *
 * There is no optimistic layer, for the reason `useUnitAvailability` gives for
 * not having one: nothing here moves under the pointer. The action bar
 * disables itself, a toast confirms, and the list redraws when the invalidated
 * query returns. An optimistic patch would have to synthesise a `group_id`
 * the server has not issued yet.
 */
export function useFriendGroupMutations(year: number, sessionCmId: number): FriendGroupMutations {
  const { fetchWithAuth } = useApiWithAuth()
  const queryClient = useQueryClient()

  /**
   * RETURNS THE PROMISE, and every `onSuccess` below AWAITS IT — which is what
   * keeps `isPending` true until the refetched list has actually landed, not
   * merely until the write's own response has.
   *
   * That gap is not cosmetic here, because the membership PATCH sends an
   * ABSOLUTE `household_cm_ids` list computed from the CACHED group. Re-enable
   * the card's controls the moment the PATCH answers and the next add is
   * computed from the pre-write membership, so the server's `_replace_members`
   * deletes whatever the first write added — with a success toast and no error
   * anywhere. Summer cannot hit this: `LockGroupPanel` adds one
   * `locked_group_members` row and removes one row, so two overlapping edits
   * compose instead of overwriting.
   *
   * `invalidateQueries` RESOLVES rather than rejects when the refetch itself
   * fails (`throwOnError` is off by default), so a dead network after a
   * successful write still reports the write as the success it was — pinned in
   * `useWeekendFriendGroups.test.tsx`, which goes red if `throwOnError: true`
   * is ever added here.
   */
  const invalidate = useCallback(
    () =>
      queryClient.invalidateQueries({
        queryKey: queryKeys.weekendFriendGroups(year, sessionCmId),
      }),
    [queryClient, year, sessionCmId]
  )

  const create = useMutation({
    mutationFn: (body: FriendGroupCreate) => createFriendGroup(fetchWithAuth, body),
    onSuccess: async (group) => {
      // `||`, not `??`: '' is the real stored value for an unnamed group, so
      // `??` would toast "Created " with a trailing space. Same trap
      // `partyKey.ts` documents at length.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed"
      toast.success(`Created ${group.name || 'the group'}`)
      await invalidate()
    },
    onError: (error: Error) => {
      // INVALIDATE ON FAILURE TOO, and only here. `create_group` writes the
      // group row and then one member row per household, and PocketBase's
      // REST API gives that no transaction — so a failure part-way through
      // leaves a REAL group holding fewer households than asked for. Without
      // this the list would not refetch and that group would be invisible
      // until something else happened to invalidate, which is the worst of
      // both: it exists, staff cannot see it, and re-creating makes a second.
      void invalidate()
      toast.error(error.message)
    },
  })

  const update = useMutation({
    mutationFn: ({ groupId, body }: { groupId: string; body: FriendGroupUpdate }) =>
      updateFriendGroup(fetchWithAuth, groupId, body),
    onSuccess: async () => {
      toast.success('Group updated')
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (groupId: string) => deleteFriendGroup(fetchWithAuth, groupId),
    onSuccess: async () => {
      toast.success('Group dissolved')
      await invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  return {
    createGroup: (body: FriendGroupCreate, options?: MutationCallbacks) => {
      create.mutate(body, options)
    },
    updateGroup: (groupId: string, body: FriendGroupUpdate) => {
      update.mutate({ groupId, body })
    },
    updateGroupAsync: (groupId: string, body: FriendGroupUpdate) =>
      update.mutateAsync({ groupId, body }),
    deleteGroup: remove.mutate,
    isPending: create.isPending || update.isPending || remove.isPending,
  }
}
