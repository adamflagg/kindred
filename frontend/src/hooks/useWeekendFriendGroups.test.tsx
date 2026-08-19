/**
 * The friend-group mutations: when a write is DONE (kindred#1913).
 *
 * These are behaviours the component test cannot reach — it mocks this whole
 * module — so they are pinned at the hook, which is where they live.
 *
 * The one that matters is the membership PATCH's absolute body. The API
 * replaces a group's membership with exactly the list it is given, and the
 * caller computes that list from the CACHED group. So a second edit issued
 * before the invalidated query has come back is computed from a membership the
 * first edit already changed, and silently undoes it. Summer cannot hit this:
 * `LockGroupPanel` adds one `locked_group_members` row and removes one row, so
 * two overlapping edits compose.
 *
 * Closing that window needs two halves, and only one of them is a disabled
 * button. `isPending` must stay true until the REFETCH has landed, not merely
 * until the PATCH's own response has — otherwise the controls re-enable over a
 * list that is still the pre-write one. Returning the invalidation promise
 * from `onSuccess` is what buys that.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FriendGroupList } from '../types/friendGroups'
import { useFriendGroupMutations, useWeekendFriendGroups } from './useWeekendFriendGroups'

const fetchFriendGroups = vi.fn()
const updateFriendGroup = vi.fn()
const createFriendGroup = vi.fn()
const deleteFriendGroup = vi.fn()

vi.mock('../services/friendGroupsApi', () => ({
  fetchFriendGroups: (...args: unknown[]) => fetchFriendGroups(...args),
  updateFriendGroup: (...args: unknown[]) => updateFriendGroup(...args),
  createFriendGroup: (...args: unknown[]) => createFriendGroup(...args),
  deleteFriendGroup: (...args: unknown[]) => deleteFriendGroup(...args),
}))

vi.mock('./useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

const toastError = vi.fn()
const toastSuccess = vi.fn()
vi.mock('react-hot-toast', () => ({
  default: {
    error: (...args: unknown[]) => toastError(...args),
    success: (...args: unknown[]) => toastSuccess(...args),
  },
}))

const YEAR = 2026
const SESSION = 1000001
const JOHNSON = 2000001
const GARCIA = 2000002

function emptyList(): FriendGroupList {
  return { year: YEAR, session_cm_id: SESSION, groups: [] }
}

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/**
 * Both hooks together, which is how the tab uses them: the query has to be
 * MOUNTED for `invalidateQueries` to have anything to refetch.
 */
function useBoth() {
  const query = useWeekendFriendGroups(YEAR, SESSION)
  const mutations = useFriendGroupMutations(YEAR, SESSION)
  return { query, mutations }
}

beforeEach(() => {
  vi.clearAllMocks()
  client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  fetchFriendGroups.mockResolvedValue(emptyList())
})

describe('a membership write is not finished until the list it was computed from is', () => {
  it('stays pending across the refetch, not just across the PATCH', async () => {
    let releaseRefetch: () => void = () => {
      /* replaced below */
    }
    fetchFriendGroups.mockReset()
    fetchFriendGroups.mockResolvedValueOnce(emptyList()).mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => {
        releaseRefetch = resolve
      })
      return emptyList()
    })
    updateFriendGroup.mockResolvedValue({ group_id: 'grp_1' })

    const { result } = renderHook(useBoth, { wrapper })
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true)
    })

    let settled = false
    act(() => {
      void result.current.mutations
        .updateGroupAsync('grp_1', { household_cm_ids: [JOHNSON, GARCIA] })
        .then(() => {
          settled = true
        })
    })

    // The PATCH has answered and the refetch is in flight. If the write were
    // reported done HERE, the card's controls would re-enable over the
    // pre-write membership and the next edit would be computed from it.
    await waitFor(() => {
      expect(fetchFriendGroups).toHaveBeenCalledTimes(2)
    })
    expect(settled).toBe(false)
    expect(result.current.mutations.isPending).toBe(true)

    await act(async () => {
      releaseRefetch()
    })
    await waitFor(() => {
      expect(settled).toBe(true)
    })
    await waitFor(() => {
      expect(result.current.mutations.isPending).toBe(false)
    })
  })

  it('does not turn a failed refetch into a failed write', async () => {
    // The write LANDED. If the refetch that follows it rejects, the group is
    // still updated on the server, so reporting the mutation as failed would
    // toast a lie and — for the create path — throw away a selection that was
    // in fact written.
    fetchFriendGroups.mockReset()
    fetchFriendGroups
      .mockResolvedValueOnce(emptyList())
      .mockRejectedValueOnce(new Error('refetch boom'))
    updateFriendGroup.mockResolvedValue({ group_id: 'grp_1' })

    const { result } = renderHook(useBoth, { wrapper })
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true)
    })

    await act(async () => {
      await result.current.mutations.updateGroupAsync('grp_1', { name: 'Lake cabins' })
    })

    // The write landed — evidenced by the call itself, not by a toast, since
    // the weekend board no longer confirms a success in one.
    expect(updateFriendGroup).toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })

  it('stays SILENT on a successful create, update or dissolve', async () => {
    /*
     * Owner ruling, 2026-08-18: "lets lose the toasts on success for weekend".
     *
     * The weekend board's other direct-manipulation writes — placing a family,
     * merging a building, writing an occupant in — all raise errors only and
     * let the redraw be the confirmation. Friend groups were one of the two
     * places on this surface that still announced success, and a group
     * appearing or its chips disappearing already says the same thing.
     *
     * Errors are untouched: a refused write must never look saved.
     */
    createFriendGroup.mockResolvedValue({ group_id: 'grp_2', name: 'Lake cabins' })
    updateFriendGroup.mockResolvedValue({ group_id: 'grp_1' })
    deleteFriendGroup.mockResolvedValue(undefined)

    const { result } = renderHook(useBoth, { wrapper })
    await waitFor(() => {
      expect(result.current.query.isSuccess).toBe(true)
    })

    await act(async () => {
      await result.current.mutations.updateGroupAsync('grp_1', { name: 'Lake cabins' })
    })

    expect(toastSuccess).not.toHaveBeenCalled()
    expect(toastError).not.toHaveBeenCalled()
  })
})
