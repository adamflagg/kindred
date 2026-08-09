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
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { FriendGroupRow } from '../../types/friendGroups'
import type { RosterPartyRow } from '../../types/lodging'
import { WeekendFriendGroups } from './WeekendFriendGroups'

const createGroup = vi.fn()
const updateGroup = vi.fn()
const deleteGroup = vi.fn()

let groupsResult: {
  data: { groups: FriendGroupRow[] } | undefined
  isLoading: boolean
  isPending: boolean
  error: unknown
}

vi.mock('../../hooks/useWeekendFriendGroups', () => ({
  useWeekendFriendGroups: () => groupsResult,
  useFriendGroupMutations: () => ({
    createGroup,
    updateGroup,
    deleteGroup,
    isPending: false,
  }),
}))

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
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

  it('creates the group with the auto-name, the chosen colour and the intent', async () => {
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
        intent: 'with',
        household_cm_ids: [2000001, 2000002],
      },
      // The second argument is what makes the clear conditional — see
      // "keeps the selection when the create fails" below.
      expect.objectContaining({ onSuccess: expect.any(Function) })
    )
  })

  it('sends NEAR when staff pick proximity rather than co-housing', async () => {
    const user = userEvent.setup()
    renderTab()
    await user.click(screen.getByRole('button', { name: /Johnson/ }))
    await user.click(screen.getByRole('button', { name: /Garcia/ }))
    await user.click(screen.getByRole('radio', { name: /nearby/i }))
    await user.click(screen.getByRole('button', { name: /create group/i }))

    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'near' }),
      expect.anything()
    )
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
    intent: 'with',
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

  it('tells apart two member chips that would otherwise both say "Johnson"', () => {
    // The picker cards below carry a children sub-line and so escape this;
    // the member chips carry only the label, so two households sharing a
    // surname would render two identical, unreadable chips.
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

  it('says WITH and NEAR differently — they are different requests', () => {
    groupsResult = {
      data: { groups: [group, { ...group, group_id: 'grp_2', intent: 'near' }] },
      isLoading: false,
      isPending: false,
      error: null,
    }
    renderTab()
    expect(
      within(screen.getByTestId('friend-group-grp_1')).getByText('Same cabin')
    ).toBeInTheDocument()
    expect(within(screen.getByTestId('friend-group-grp_2')).getByText('Nearby')).toBeInTheDocument()
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
            intent: 'with',
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
