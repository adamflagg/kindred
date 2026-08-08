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
 * never short staleTime plus hope. Each of the three mutations below
 * invalidates the group key before it resolves.
 *
 * ## The key carries no scenario, and that is deliberate
 *
 * `weekendRoster` keys on `(year, sessionCmId, scenario)` because a scenario
 * REPLACES the mirror, so the two are different documents. A friend group has
 * no scenario dimension at all (migration 1500000144): it records what
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
import type { FriendGroupCreate, FriendGroupList, FriendGroupUpdate } from '../types/friendGroups'
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

  const invalidate = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: queryKeys.weekendFriendGroups(year, sessionCmId),
    })
  }, [queryClient, year, sessionCmId])

  const create = useMutation({
    mutationFn: (body: FriendGroupCreate) => createFriendGroup(fetchWithAuth, body),
    onSuccess: (group) => {
      invalidate()
      // `||`, not `??`: '' is the real stored value for an unnamed group, so
      // `??` would toast "Created " with a trailing space. Same trap
      // `partyKey.ts` documents at length.
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- '' is a real stored value meaning "unnamed"
      toast.success(`Created ${group.name || 'the group'}`)
    },
    onError: (error: Error) => {
      // INVALIDATE ON FAILURE TOO, and only here. `create_group` writes the
      // group row and then one member row per household, and PocketBase's
      // REST API gives that no transaction — so a failure part-way through
      // leaves a REAL group holding fewer households than asked for. Without
      // this the list would not refetch and that group would be invisible
      // until something else happened to invalidate, which is the worst of
      // both: it exists, staff cannot see it, and re-creating makes a second.
      invalidate()
      toast.error(error.message)
    },
  })

  const update = useMutation({
    mutationFn: ({ groupId, body }: { groupId: string; body: FriendGroupUpdate }) =>
      updateFriendGroup(fetchWithAuth, groupId, body),
    onSuccess: () => {
      invalidate()
      toast.success('Group updated')
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const remove = useMutation({
    mutationFn: (groupId: string) => deleteFriendGroup(fetchWithAuth, groupId),
    onSuccess: () => {
      invalidate()
      toast.success('Group dissolved')
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
    deleteGroup: remove.mutate,
    isPending: create.isPending || update.isPending || remove.isPending,
  }
}
