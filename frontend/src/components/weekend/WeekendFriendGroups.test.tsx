/**
 * The weekend friend-group tab (kindred#1913 half 1).
 *
 * A friend group here is a STAFF-AUTHORED set of households — nothing is
 * parsed, nothing is resolved from free text, nothing is solved. The surface
 * is summer's, forked rather than shared: the bottom action bar, the nine
 * group colours, the `pending-lock-glow` on selected members and the
 * auto-name from surnames all come across from `LockGroupActionBar`, over a
 * different backend grain (households, not campers).
 *
 * Fictional households throughout (tests/CLAUDE.md).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FriendGroupRow } from '../../types/friendGroups'
import type { RosterPartyRow } from '../../types/lodging'
import { WeekendFriendGroups } from './WeekendFriendGroups'

const createGroup = vi.fn()
const updateGroup = vi.fn()
const updateGroupAsync = vi.fn()
const deleteGroup = vi.fn()

let groupsResult: {
  data: { groups: FriendGroupRow[] } | undefined
  isLoading: boolean
  isPending: boolean
  error: unknown
}

/** True while a friend-group write is in flight — see the stale-write tests. */
let mutationPending: boolean

vi.mock('../../hooks/useWeekendFriendGroups', () => ({
  useWeekendFriendGroups: () => groupsResult,
  useFriendGroupMutations: () => ({
    createGroup,
    updateGroup,
    updateGroupAsync,
    deleteGroup,
    isPending: mutationPending,
  }),
}))

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  updateGroupAsync.mockResolvedValue({})
  mutationPending = false
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  groupsResult = { data: { groups: [] }, isLoading: false, isPending: false, error: null }
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function household(cmId: number, surname: string, child: string): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: cmId,
    person_cm_id: 0,
    display_name: `The ${surname} Family`,
    sort_name: surname,
    adults: [],
    children: [{ person_cm_id: cmId + 1, display_name: child }],
    party_size: 3,
  }
}

const JOHNSON = household(2000001, 'Johnson', 'Emma Johnson')
const GARCIA = household(2000002, 'Garcia', 'Liam Garcia')
const CHEN = household(2000003, 'Chen', 'Olivia Chen')
const SAM = household(2000004, 'Sam', 'Riley Sam')

function renderTab(props: Partial<Parameters<typeof WeekendFriendGroups>[0]> = {}) {
  return render(
    <WeekendFriendGroups
      year={2026}
      sessionCmId={1000001}
      parties={[JOHNSON, GARCIA, CHEN]}
      canManage
      sessionType="family"
      {...props}
    />,
    { wrapper }
  )
}

/**
 * The Families grid's toggle button for a household. Scoped to
 * `friend-group-households` rather than a bare `screen.getByRole` name match:
 * once a group exists, its member row's "Remove {name} from group" button
 * matches the same regex and `getByRole` throws on the ambiguity.
 */
function householdToggle(name: RegExp) {
  return within(screen.getByTestId('friend-group-households')).getByRole('button', { name })
}

describe('authoring a group', () => {
  it('says nothing is selected until a household is picked', () => {
    renderTab()
    expect(screen.queryByTestId('friend-group-action-bar')).not.toBeInTheDocument()
  })

  it('refuses a group of one and says so', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))

    const bar = screen.getByTestId('friend-group-action-bar')
    expect(within(bar).getByText(/select at least 2/i)).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /create group/i })).toBeDisabled()
  })

  it('glows the selected households, as summer glows pending lock members', async () => {
    const user = userEvent.setup()
    renderTab()
    const johnson = screen.getByRole('button', { name: /Johnson/ })
    await user.click(johnson)
    expect(johnson.className).toContain('pending-lock-glow')
  })

  it('offers the auto-name as a placeholder so a blank field means "use it"', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /Garcia/ }))

    expect(screen.getByLabelText(/group name/i)).toHaveAttribute('placeholder', 'Garcia, Johnson')
  })

  it('creates the group with the auto-name and the chosen colour, and no intent field', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /Garcia/ }))
    await user.click(screen.getByRole('button', { name: /create group/i }))

    expect(createGroup).toHaveBeenCalledWith(
      {
        year: 2026,
        session_cm_id: 1000001,
        name: 'Garcia, Johnson',
        color: '#ef4444',
        household_cm_ids: [2000001, 2000002],
      },
      // The second argument is what makes the clear conditional — see
      // "keeps the selection when the create fails" below.
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })

  it('offers no intent control at all — owner ruling, kindred#1913', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /Garcia/ }))

    const bar = screen.getByTestId('friend-group-action-bar')
    expect(within(bar).queryByRole('radio', { name: /nearby|same cabin/i })).not.toBeInTheDocument()
  })

  it('keeps a typed name over the auto-name', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /Garcia/ }))
    await user.type(screen.getByLabelText(/group name/i), 'Lake cabins')
    await user.click(screen.getByRole('button', { name: /create group/i }))

    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Lake cabins' }),
      expect.anything()
    )
  })

  it('clears the selection', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /^clear$/i }))
    expect(screen.queryByTestId('friend-group-action-bar')).not.toBeInTheDocument()
  })

  it('keeps the selection when the create FAILS', async () => {
    // `mutate` is fire-and-forget. Clearing straight after the call throws the
    // staff member's whole selection and typed name away on a 403, a 400 or a
    // dropped connection — and there is nothing to undo it with. Summer clears
    // in `onSuccess` for exactly this reason.
    const user = userEvent.setup()
    createGroup.mockImplementation(() => {
      /* the mutation rejected: onSuccess is never called */
    })
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /Garcia/ }))
    await user.click(screen.getByRole('button', { name: /create group/i }))

    const bar = screen.getByTestId('friend-group-action-bar')
    expect(within(bar).getByText('2 households selected')).toBeInTheDocument()
  })

  it('clears the selection once the create SUCCEEDS', async () => {
    const user = userEvent.setup()
    createGroup.mockImplementation((_body, options?: { onSuccess?: () => void }) => {
      options?.onSuccess?.()
    })
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /Garcia/ }))
    await user.click(screen.getByRole('button', { name: /create group/i }))

    expect(screen.queryByTestId('friend-group-action-bar')).not.toBeInTheDocument()
  })

  /**
   * Summer runs this check and the weekend did not. `LockGroupActionBar`'s
   * create mutation loops the pending campers BEFORE writing anything,
   * confirming each one that is already grouped against the sentinel target
   * `'__new__'`, and throws on the first cancel so no group is created at
   * all. Without it, staff could author a second group over households
   * already in one and only find out afterwards.
   */
  describe('the create-time conflict check', () => {
    const grouped: FriendGroupRow = {
      group_id: 'grp_1',
      year: 2026,
      session_cm_id: 1000001,
      name: 'Garcia, Johnson',
      color: '#22c55e',
      source: 'staff_manual',
      created_by: 'staff@example.com',
      members: [{ household_cm_id: 2000001 }],
    }

    beforeEach(() => {
      groupsResult = {
        data: { groups: [grouped] },
        isLoading: false,
        isPending: false,
        error: null,
      }
    })

    it('warns before creating a group from a household already in another one', async () => {
      const user = userEvent.setup()
      renderTab()
      await user.click(householdToggle(/Johnson/))
      await user.click(householdToggle(/Chen/))
      await user.click(screen.getByRole('button', { name: /create group/i }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toMatch(/Garcia, Johnson/)
      expect(dialog.textContent).toMatch(/leaves them in both/i)
      expect(createGroup).not.toHaveBeenCalled()

      await user.click(within(dialog).getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        expect(createGroup).toHaveBeenCalledWith(
          expect.objectContaining({ household_cm_ids: [2000001, 2000003] }),
          expect.anything()
        )
      })
    })

    it('cancelling aborts the WHOLE create, as summer does', async () => {
      const user = userEvent.setup()
      renderTab()
      await user.click(householdToggle(/Johnson/))
      await user.click(householdToggle(/Chen/))
      await user.click(screen.getByRole('button', { name: /create group/i }))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

      expect(createGroup).not.toHaveBeenCalled()
      // The selection survives, so staff can drop the conflicting household
      // and try again without rebuilding it.
      expect(screen.getByTestId('friend-group-action-bar')).toBeInTheDocument()
    })

    it('does not warn when nothing selected is already grouped', async () => {
      const user = userEvent.setup()
      renderTab()
      await user.click(householdToggle(/Garcia/))
      await user.click(householdToggle(/Chen/))
      await user.click(screen.getByRole('button', { name: /create group/i }))

      await waitFor(() => {
        expect(createGroup).toHaveBeenCalled()
      })
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    })
  })

  it('drops a selection carried over from another weekend', async () => {
    // The weekend switcher re-renders this route element rather than
    // remounting it, so without an explicit reset the households picked on
    // one weekend stay selected and get authored against the next.
    const user = userEvent.setup()
    const { rerender } = renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('friend-group-action-bar')).toBeInTheDocument()

    rerender(
      <WeekendFriendGroups
        year={2026}
        sessionCmId={1000002}
        parties={[JOHNSON, GARCIA, CHEN]}
        canManage
        sessionType="family"
      />
    )
    expect(screen.queryByTestId('friend-group-action-bar')).not.toBeInTheDocument()
  })
})

describe('existing groups', () => {
  const group: FriendGroupRow = {
    group_id: 'grp_1',
    year: 2026,
    session_cm_id: 1000001,
    name: 'Garcia, Johnson',
    color: '#22c55e',
    source: 'staff_manual',
    created_by: 'staff@example.com',
    members: [{ household_cm_id: 2000001 }, { household_cm_id: 2000002 }],
  }

  it('lists the group with its members named by surname', () => {
    groupsResult = { data: { groups: [group] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    expect(within(card).getByText('Garcia, Johnson')).toBeInTheDocument()
    expect(within(card).getByText('Johnson')).toBeInTheDocument()
    expect(within(card).getByText('Garcia')).toBeInTheDocument()
  })

  it('tells apart two member rows that would otherwise both say "Johnson"', () => {
    // The picker cards below carry a children sub-line and so escape this;
    // a member row's primary line carries only the label, so two households
    // sharing a surname would render two identical, unreadable rows.
    const JOHNSON_TWO = household(2000004, 'Johnson', 'Noah Johnson')
    groupsResult = {
      data: {
        groups: [
          {
            ...group,
            members: [{ household_cm_id: 2000001 }, { household_cm_id: 2000004 }],
          },
        ],
      },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab({ parties: [JOHNSON, GARCIA, CHEN, JOHNSON_TWO] })
    const card = screen.getByTestId('friend-group-grp_1')
    expect(within(card).getByText(/Johnson · Emma Johnson/)).toBeInTheDocument()
    expect(within(card).getByText(/Johnson · Noah Johnson/)).toBeInTheDocument()
    expect(within(card).queryByText('Johnson')).not.toBeInTheDocument()
  })

  it('renders no intent chip on a group card — owner ruling, kindred#1913', () => {
    groupsResult = { data: { groups: [group] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    expect(within(card).queryByText(/same cabin|nearby/i)).not.toBeInTheDocument()
  })

  it('names a member who has left the roster rather than dropping them silently', () => {
    groupsResult = {
      data: {
        groups: [
          { ...group, members: [{ household_cm_id: 2000001 }, { household_cm_id: 9999999 }] },
        ],
      },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    expect(within(card).getByText(/no longer enrolled/i)).toBeInTheDocument()
  })

  it('dissolves a group', async () => {
    const user = userEvent.setup()
    groupsResult = { data: { groups: [group] }, isLoading: false, isPending: false, error: null }
    renderTab()
    await user.click(
      within(screen.getByTestId('friend-group-grp_1')).getByRole('button', { name: /dissolve/i })
    )
    expect(deleteGroup).toHaveBeenCalledWith('grp_1')
  })

  it('renames a group', async () => {
    const user = userEvent.setup()
    groupsResult = { data: { groups: [group] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    await user.click(within(card).getByRole('button', { name: /rename/i }))
    const input = within(card).getByLabelText(/group name/i)
    await user.clear(input)
    await user.type(input, 'Lake cabins')
    await user.click(within(card).getByRole('button', { name: /save/i }))

    expect(updateGroup).toHaveBeenCalledWith('grp_1', { name: 'Lake cabins' })
  })

  it('recolours a group', async () => {
    const user = userEvent.setup()
    groupsResult = { data: { groups: [group] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    await user.click(within(card).getByRole('button', { name: /rename/i }))
    await user.click(within(card).getByRole('radio', { name: 'Indigo' }))
    await user.click(within(card).getByRole('button', { name: /save/i }))

    expect(updateGroup).toHaveBeenCalledWith('grp_1', { color: '#6366f1' })
  })
})

describe('membership add/remove (kindred#1913 half 2, Option A)', () => {
  const grp1: FriendGroupRow = {
    group_id: 'grp_1',
    year: 2026,
    session_cm_id: 1000001,
    name: 'Garcia, Johnson',
    color: '#22c55e',
    source: 'staff_manual',
    created_by: 'staff@example.com',
    members: [{ household_cm_id: 2000001 }, { household_cm_id: 2000002 }],
  }
  const grp2: FriendGroupRow = {
    group_id: 'grp_2',
    year: 2026,
    session_cm_id: 1000001,
    name: 'Pine cabins',
    color: '#3b82f6',
    source: 'staff_manual',
    created_by: 'staff@example.com',
    members: [{ household_cm_id: 2000003 }],
  }

  it('shows a member row with its composition line', () => {
    groupsResult = { data: { groups: [grp1] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    // JOHNSON's fixture: adults: [], children: [one], party_size: 3 — the row
    // for the household labelled "Johnson" carries that composition line.
    const johnsonRow = within(card).getByText('Johnson').closest('div')!
    expect(within(johnsonRow).getByText('3 people · 0 adults, 1 child')).toBeInTheDocument()
  })

  it('removing a member calls the mutation', async () => {
    const user = userEvent.setup()
    groupsResult = { data: { groups: [grp1] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    await user.click(within(card).getAllByRole('button', { name: /remove.*from group/i })[0]!)

    expect(updateGroup).toHaveBeenCalledWith('grp_1', { household_cm_ids: [2000002] })
  })

  it('the picker excludes only the households already in THIS group', async () => {
    const user = userEvent.setup()
    groupsResult = { data: { groups: [grp1] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    await user.click(within(card).getByRole('button', { name: /add household/i }))

    const listbox = screen.getByRole('listbox')
    expect(within(listbox).queryByRole('option', { name: /Johnson/ })).not.toBeInTheDocument()
    expect(within(listbox).queryByRole('option', { name: /Garcia/ })).not.toBeInTheDocument()
    expect(within(listbox).getByRole('option', { name: /Chen/ })).toBeInTheDocument()
  })

  it('the picker OFFERS a household already in another group rather than hiding it', async () => {
    // Owner ruling 2026-08-09, "same behavior" as summer: a household may sit
    // in more than one group, so a picker that silently drops the grouped
    // ones offers staff no way to express that at all — and gives no reason
    // for the absence. It is offered, labelled with the group it is already
    // in, and warned about on select.
    const user = userEvent.setup()
    groupsResult = {
      data: { groups: [grp1, grp2] },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_2')
    await user.click(within(card).getByRole('button', { name: /add household/i }))

    // `^Johnson` because the OTHER options now carry an "Already in
    // “Garcia, Johnson”" sub-line, so a bare /Johnson/ matches all of them.
    const listbox = screen.getByRole('listbox')
    const johnson = within(listbox).getByRole('option', { name: /^Johnson/ })
    expect(johnson).toBeInTheDocument()
    expect(johnson.textContent).toMatch(/already in .*Garcia, Johnson/i)
  })

  it('the card picker warns before adding an already-grouped household, and keeps it in both', async () => {
    const user = userEvent.setup()
    groupsResult = {
      data: { groups: [grp1, grp2] },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_2')
    await user.click(within(card).getByRole('button', { name: /add household/i }))
    await user.click(screen.getByRole('option', { name: /^Johnson/ }))

    const dialog = await screen.findByRole('dialog')
    expect(dialog.textContent).toMatch(/leaves them in both/i)
    await user.click(within(dialog).getByRole('button', { name: /continue/i }))

    await waitFor(() => {
      expect(updateGroup).toHaveBeenCalledWith('grp_2', {
        household_cm_ids: [2000003, 2000001],
      })
    })
    // The old group is never touched — the only two deletes in the whole
    // surface are the member row's X and Dissolve, exactly as in summer.
    expect(updateGroup).not.toHaveBeenCalledWith('grp_1', expect.anything())
  })

  it('cancelling the card picker warning writes nothing at all', async () => {
    const user = userEvent.setup()
    groupsResult = {
      data: { groups: [grp1, grp2] },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_2')
    await user.click(within(card).getByRole('button', { name: /add household/i }))
    await user.click(screen.getByRole('option', { name: /^Johnson/ }))

    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

    expect(updateGroup).not.toHaveBeenCalled()
  })

  it('adds an ungrouped household via the card picker', async () => {
    const user = userEvent.setup()
    groupsResult = { data: { groups: [grp1] }, isLoading: false, isPending: false, error: null }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    await user.click(within(card).getByRole('button', { name: /add household/i }))
    await user.click(screen.getByRole('option', { name: /Chen/ }))

    expect(updateGroup).toHaveBeenCalledWith('grp_1', {
      household_cm_ids: [2000001, 2000002, 2000003],
    })
  })

  it('says so when every household on the weekend is already in THIS group', async () => {
    const user = userEvent.setup()
    const fullGroup: FriendGroupRow = {
      ...grp1,
      members: [
        { household_cm_id: 2000001 },
        { household_cm_id: 2000002 },
        { household_cm_id: 2000003 },
      ],
    }
    groupsResult = {
      data: { groups: [fullGroup] },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab()
    const card = screen.getByTestId('friend-group-grp_1')
    await user.click(within(card).getByRole('button', { name: /add household/i }))

    expect(screen.getByText(/every household.*already in this group/i)).toBeInTheDocument()
  })

  /**
   * THE MEMBERSHIP PATCH SENDS AN ABSOLUTE LIST, SO TWO OVERLAPPING EDITS LOSE
   * ONE OF THEM.
   *
   * Summer cannot hit this: `LockGroupPanel` adds with a single
   * `locked_group_members` create and removes with a single delete, so two
   * edits in flight at once compose. The weekend PATCHes
   * `household_cm_ids` — the WHOLE membership, computed from the cached group
   * — and the server's `_replace_members` deletes anything absent from it. Add
   * Chen, then add Sam before the invalidated query has come back, and the
   * second body is still `[Johnson, Garcia, Sam]`: Chen is deleted again, with
   * a success toast and no error anywhere.
   *
   * The fix is to refuse the second gesture until the first has landed AND the
   * list it is computed from has been refetched — `isPending` spans both, see
   * `useWeekendFriendGroups.test.tsx`. It is the same treatment Dissolve on
   * this card already gets.
   */
  describe('while a write is in flight', () => {
    beforeEach(() => {
      mutationPending = true
      groupsResult = { data: { groups: [grp1] }, isLoading: false, isPending: false, error: null }
    })

    it('refuses another add, so the second PATCH cannot resurrect a stale membership', () => {
      renderTab()
      const card = screen.getByTestId('friend-group-grp_1')
      expect(within(card).getByRole('button', { name: /add household/i })).toBeDisabled()
    })

    it('refuses another remove for the same reason', () => {
      renderTab()
      const card = screen.getByTestId('friend-group-grp_1')
      for (const button of within(card).getAllByRole('button', { name: /remove.*from group/i })) {
        expect(button).toBeDisabled()
      }
    })

    it('refuses the board’s "Add to group" too', async () => {
      const user = userEvent.setup()
      renderTab({ parties: [JOHNSON, GARCIA, CHEN, SAM] })
      await user.click(householdToggle(/Sam/))
      expect(screen.getByRole('button', { name: /^add to group$/i })).toBeDisabled()
    })
  })

  it('hides add/remove controls without bunking.manage', () => {
    groupsResult = { data: { groups: [grp1] }, isLoading: false, isPending: false, error: null }
    renderTab({ canManage: false })
    const card = screen.getByTestId('friend-group-grp_1')
    expect(
      within(card).queryByRole('button', { name: /remove.*from group/i })
    ).not.toBeInTheDocument()
    expect(within(card).queryByRole('button', { name: /add household/i })).not.toBeInTheDocument()
  })

  describe('the board: "Add to group"', () => {
    it('adds an unconflicted selection straight to the target group', async () => {
      const user = userEvent.setup()
      groupsResult = {
        data: { groups: [grp1, grp2] },
        isLoading: false,
        isPending: false,
        error: null,
      }
      renderTab({ parties: [JOHNSON, GARCIA, CHEN, SAM] })
      // SAM is on the roster but in neither group — no conflict.
      await user.click(householdToggle(/Sam/))
      await user.click(screen.getByRole('button', { name: /^add to group$/i }))
      await user.click(screen.getByRole('option', { name: /Garcia, Johnson/ }))

      await waitFor(() => {
        expect(updateGroupAsync).toHaveBeenCalledWith('grp_1', {
          household_cm_ids: [2000001, 2000002, 2000004],
        })
      })
    })

    it('clears the selection once every write resolves', async () => {
      const user = userEvent.setup()
      groupsResult = {
        data: { groups: [grp1, grp2] },
        isLoading: false,
        isPending: false,
        error: null,
      }
      renderTab({ parties: [JOHNSON, GARCIA, CHEN, SAM] })
      await user.click(householdToggle(/Sam/))
      await user.click(screen.getByRole('button', { name: /^add to group$/i }))
      await user.click(screen.getByRole('option', { name: /Garcia, Johnson/ }))

      await waitFor(() => {
        expect(screen.queryByTestId('friend-group-action-bar')).not.toBeInTheDocument()
      })
    })

    it('adding a household already in another group warns, then leaves it in BOTH', async () => {
      const user = userEvent.setup()
      updateGroupAsync.mockResolvedValue({})
      groupsResult = {
        data: { groups: [grp1, grp2] },
        isLoading: false,
        isPending: false,
        error: null,
      }
      renderTab()
      // JOHNSON is already in grp1 — targeting grp2 is a conflict.
      await user.click(householdToggle(/Johnson/))
      await user.click(screen.getByRole('button', { name: /^add to group$/i }))
      await user.click(screen.getByRole('option', { name: /Pine cabins/ }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).toMatch(/Garcia, Johnson/)
      expect(dialog.textContent).toMatch(/Pine cabins/)
      expect(dialog.textContent).toMatch(/leaves them in both/i)

      await user.click(within(dialog).getByRole('button', { name: /continue/i }))

      await waitFor(() => {
        expect(updateGroupAsync).toHaveBeenCalledWith('grp_2', {
          household_cm_ids: [2000003, 2000001],
        })
      })
      // NO source-group drain. Neither summer path deletes the old row, and
      // draining here was the second way to cross the two-household floor —
      // it half-applied, adding to the target and then 422ing on the source.
      expect(updateGroupAsync).not.toHaveBeenCalledWith('grp_1', expect.anything())
      expect(updateGroupAsync).toHaveBeenCalledTimes(1)
    })

    it('the warning never claims a household can only be in one group', async () => {
      // The sentence contradicted the very migration it cited: 1500000146's
      // header says in as many words that nothing enforces one-group-per-
      // household, and calls two memberships "two groups, not a conflict".
      const user = userEvent.setup()
      groupsResult = {
        data: { groups: [grp1, grp2] },
        isLoading: false,
        isPending: false,
        error: null,
      }
      renderTab()
      await user.click(householdToggle(/Johnson/))
      await user.click(screen.getByRole('button', { name: /^add to group$/i }))
      await user.click(screen.getByRole('option', { name: /Pine cabins/ }))

      const dialog = await screen.findByRole('dialog')
      expect(dialog.textContent).not.toMatch(/only be in one/i)
      expect(dialog.textContent).not.toMatch(/take it out of/i)
      expect(within(dialog).queryByRole('button', { name: /move household/i })).toBeNull()
    })

    it('cancelling the warning leaves the household in its original group and the selection intact', async () => {
      const user = userEvent.setup()
      groupsResult = {
        data: { groups: [grp1, grp2] },
        isLoading: false,
        isPending: false,
        error: null,
      }
      renderTab()
      await user.click(householdToggle(/Johnson/))
      await user.click(screen.getByRole('button', { name: /^add to group$/i }))
      await user.click(screen.getByRole('option', { name: /Pine cabins/ }))

      const dialog = await screen.findByRole('dialog')
      await user.click(within(dialog).getByRole('button', { name: /cancel/i }))

      expect(updateGroupAsync).not.toHaveBeenCalled()
      expect(screen.getByTestId('friend-group-action-bar')).toBeInTheDocument()
    })

    it('offers no "Add to group" control until a friend group exists', () => {
      groupsResult = { data: { groups: [] }, isLoading: false, isPending: false, error: null }
      renderTab()
      expect(screen.queryByRole('button', { name: /^add to group$/i })).not.toBeInTheDocument()
    })
  })
})

describe('permissions and grain', () => {
  it('is read-only without bunking.manage', () => {
    groupsResult = {
      data: {
        groups: [
          {
            group_id: 'grp_1',
            year: 2026,
            session_cm_id: 1000001,
            name: 'Garcia, Johnson',
            color: '#22c55e',
            source: 'staff_manual',
            created_by: '',
            members: [{ household_cm_id: 2000001 }],
          },
        ],
      },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab({ canManage: false })

    expect(screen.getByTestId('friend-group-grp_1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /dissolve/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Johnson/ })).not.toBeInTheDocument()
  })

  it('explains itself on an adult weekend, where there are no households', () => {
    renderTab({
      parties: [{ grain: 'person', person_cm_id: 4000001, household_cm_id: 0 }],
      sessionType: 'adult',
    })
    expect(screen.getByText(/household/i)).toBeInTheDocument()
    expect(screen.getByText(/individual guests rather than households/i)).toBeInTheDocument()
    expect(screen.queryByTestId('friend-group-action-bar')).not.toBeInTheDocument()
  })

  it('does not claim a family weekend has no households, when it just has no registrations yet', () => {
    // households.length === 0 is ALSO the state of a family weekend nobody has
    // registered for yet -- the "this weekend enrols individual guests rather
    // than households" copy would be false there, not merely empty.
    renderTab({ parties: [], sessionType: 'family' })
    expect(screen.queryByText(/individual guests rather than households/i)).not.toBeInTheDocument()
    expect(
      screen.getByText(/no (?:households|families).*(?:registered|enrolled)/i)
    ).toBeInTheDocument()
    expect(screen.queryByTestId('friend-group-action-bar')).not.toBeInTheDocument()
  })
})

describe('query states', () => {
  it('reports a load', () => {
    groupsResult = { data: undefined, isLoading: true, isPending: true, error: null }
    renderTab()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('does not claim an empty list while the query is still idle', () => {
    // A disabled query (year 0 on a cold load, or an unresolved slug) reports
    // `isLoading: false` with no data. Reading only `isLoading` would render
    // "No data available" for a weekend that has not been asked about yet.
    groupsResult = { data: undefined, isLoading: false, isPending: true, error: null }
    renderTab()
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('names the empty state rather than saying "No data available"', () => {
    groupsResult = { data: undefined, isLoading: false, isPending: false, error: null }
    renderTab()
    expect(screen.getByText(/no friend groups/i)).toBeInTheDocument()
  })

  it('reports a failure rather than an empty list', () => {
    groupsResult = { data: undefined, isLoading: false, isPending: false, error: new Error('boom') }
    renderTab()
    expect(screen.getByText(/boom|error|failed/i)).toBeInTheDocument()
  })
})
