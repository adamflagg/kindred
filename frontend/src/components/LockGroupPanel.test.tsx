/**
 * LockGroupPanel layout + interaction tests.
 *
 * The panel must reserve bottom space (pb-20) when the action bar is visible,
 * so the fixed-bottom bar isn't covered by the panel.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Controls what each useQuery returns — swap per test. Splitting by queryKey
// prevents the false-positive where groups and members queries share a fixture.
//
// `mockQueryData` is kept as a back-compat alias: tests that set it populate
// BOTH groups and members (matches the legacy single-fixture behavior so old
// tests keep working). New tests should prefer mockGroups / mockMembers
// directly, plus mockGroupsState / mockMembersState for loading/error coverage.
let mockGroups: unknown[] = []
let mockMembers: unknown[] = []
let mockQueryData: unknown[] = []
let mockGroupsState: { isLoading?: boolean; isError?: boolean } = {}
let mockMembersState: { isLoading?: boolean; isError?: boolean } = {}

// Mock the lazy-loaded panel's React Query consumer.
vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: ({ queryKey }: { queryKey: unknown[] }) => {
      const key = String(queryKey[0] ?? '')
      if (key === 'locked-groups-panel') {
        return {
          data: mockGroups.length > 0 ? mockGroups : mockQueryData,
          isLoading: mockGroupsState.isLoading ?? false,
          isError: mockGroupsState.isError ?? false,
          error: mockGroupsState.isError ? new Error('groups query failed') : null,
        }
      }
      if (key === 'locked-group-members-panel') {
        return {
          data: mockMembers.length > 0 ? mockMembers : mockQueryData,
          isLoading: mockMembersState.isLoading ?? false,
          isError: mockMembersState.isError ?? false,
          error: mockMembersState.isError ? new Error('members query failed') : null,
        }
      }
      return { data: [], isLoading: false, isError: false, error: null }
    },
    useMutation: (options: { onSuccess?: (data: unknown, variables: unknown) => void }) => ({
      mutate: (variables: unknown) => {
        options?.onSuccess?.(undefined, variables)
      },
      mutateAsync: () => Promise.resolve(),
      isPending: false,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  }
})
vi.mock('../lib/pocketbase', () => ({
  pb: { collection: () => ({ getList: () => Promise.resolve({ items: [] }) }) },
}))
vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

const mockContext: {
  isActionBarVisible: boolean
  isLockPanelOpen: boolean
  groups: unknown[]
  membersByGroup: Record<string, unknown[]>
  selectedGroupId: string | null
  setSelectedGroupId: ReturnType<typeof vi.fn>
  setIsLockPanelOpen: ReturnType<typeof vi.fn>
  scenarioId: string
  sessionPbId: string
  isDraftMode: boolean
  getCamperLockGroup: (cmId: number) => unknown
  addCamperToGroup: ReturnType<typeof vi.fn>
} = {
  isActionBarVisible: false,
  isLockPanelOpen: true,
  groups: [],
  membersByGroup: {},
  selectedGroupId: null,
  setSelectedGroupId: vi.fn(),
  setIsLockPanelOpen: vi.fn(),
  scenarioId: 'scn-1',
  sessionPbId: 'sess-1',
  isDraftMode: true,
  getCamperLockGroup: () => null,
  addCamperToGroup: vi.fn(),
}
vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => mockContext,
}))

import LockGroupPanel from './LockGroupPanel'

beforeEach(() => {
  mockQueryData = []
  mockGroups = []
  mockMembers = []
  mockGroupsState = {}
  mockMembersState = {}
  mockContext.isActionBarVisible = false
  mockContext.isLockPanelOpen = true
  mockContext.groups = []
  mockContext.membersByGroup = {}
  mockContext.selectedGroupId = null
  mockContext.getCamperLockGroup = () => null
  mockContext.addCamperToGroup = vi.fn()
})

describe('LockGroupPanel layout', () => {
  it('has top-0 and bottom-0 classes when action bar is hidden', () => {
    mockContext.isActionBarVisible = false
    const { container } = render(
      <LockGroupPanel isOpen={true} onClose={() => {}} sessionPbId="sess-1" scenarioId="scn-1" />
    )
    const root = container.querySelector('[data-panel="lock-group"]')
    expect(root?.className).toContain('top-0')
    expect(root?.className).toContain('bottom-0')
    expect(root?.className).not.toContain('pb-20')
    expect(root?.className).not.toContain('bottom-20')
  })

  it('adds bottom-20 (shrinks panel) when action bar is visible instead of padding', () => {
    mockContext.isActionBarVisible = true
    const { container } = render(
      <LockGroupPanel isOpen={true} onClose={() => {}} sessionPbId="sess-1" scenarioId="scn-1" />
    )
    const root = container.querySelector('[data-panel="lock-group"]')
    expect(root?.className).toContain('top-0')
    expect(root?.className).toContain('bottom-20')
    expect(root?.className).not.toContain('pb-20')
    expect(root?.className).not.toContain('bottom-0')
  })
})

describe('LockGroupPanel — α visual treatment on selected group', () => {
  const testGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }

  it('applies the group color as a tinted background on the selected group header', () => {
    mockQueryData = [testGroup]
    const { container } = render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
      />
    )
    const header = container.querySelector<HTMLElement>('[data-group-id="group-abc"]')
    expect(header).not.toBeNull()
    // Stripe is always present (group identity); selection adds the tint
    expect(header?.className).toContain('border-l-4')
    expect(header?.style.borderLeftColor).toBeTruthy()
    expect(header?.style.backgroundColor).toBeTruthy()
  })

  it('keeps the stripe but omits the tint when the group is not selected', () => {
    mockQueryData = [testGroup]
    const { container } = render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId={null}
      />
    )
    const header = container.querySelector<HTMLElement>('[data-group-id="group-abc"]')
    expect(header).not.toBeNull()
    // Stripe still present, but no tint
    expect(header?.className).toContain('border-l-4')
    expect(header?.style.borderLeftColor).toBeTruthy()
    expect(header?.style.backgroundColor).toBeFalsy()
  })
})

describe('LockGroupPanel — ＋ Add member picker', () => {
  const testGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }

  it('renders the Add Member button inside the expanded group body', () => {
    mockQueryData = [testGroup]
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[
          { id: 'pb-1', person_cm_id: 1000001, name: 'Emma Johnson' } as never,
          { id: 'pb-2', person_cm_id: 1000002, name: 'Liam Garcia' } as never,
        ]}
      />
    )
    expect(screen.getByRole('button', { name: /add member/i })).toBeInTheDocument()
  })

  it('filters out campers already in any group from the picker results', () => {
    mockQueryData = [testGroup]
    mockContext.getCamperLockGroup = (cmId: number) =>
      cmId === 1000001 ? ({ id: 'group-abc' } as never) : null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[
          { id: 'pb-1', person_cm_id: 1000001, name: 'Emma Johnson' } as never,
          { id: 'pb-2', person_cm_id: 1000002, name: 'Liam Garcia' } as never,
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    // Liam should be selectable; Emma should not appear in the dropdown
    expect(screen.queryByRole('option', { name: /emma johnson/i })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: /liam garcia/i })).toBeInTheDocument()
  })

  it('invokes addCamperToGroup with the selected camper + group id', async () => {
    const addCamperToGroup = vi.fn().mockResolvedValue(undefined)
    mockQueryData = [testGroup]
    mockContext.getCamperLockGroup = () => null
    mockContext.addCamperToGroup = addCamperToGroup
    const liam = { id: 'pb-2', person_cm_id: 1000002, name: 'Liam Garcia' } as never
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[liam]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    fireEvent.click(screen.getByRole('option', { name: /liam garcia/i }))
    await Promise.resolve()
    expect(addCamperToGroup).toHaveBeenCalledWith(liam, 'group-abc')
  })

  it('closes the picker when clicking outside', () => {
    mockQueryData = [testGroup]
    mockContext.groups = [testGroup] as never
    mockContext.membersByGroup = { 'group-abc': [] }
    mockContext.selectedGroupId = 'group-abc'
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[{ id: 'pb-2', person_cm_id: 1000002, name: 'Liam Garcia' } as never]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect(screen.getByPlaceholderText(/filter campers/i)).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByPlaceholderText(/filter campers/i)).not.toBeInTheDocument()
  })

  it('portaled dropdown uses fixed width w-[260px] to prevent full-viewport stretch', () => {
    mockQueryData = [testGroup]
    mockContext.groups = [testGroup] as never
    mockContext.membersByGroup = { 'group-abc': [] }
    mockContext.selectedGroupId = 'group-abc'
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[{ id: 'pb-2', person_cm_id: 1000002, name: 'Liam Garcia' } as never]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    const dropdown = screen.getByPlaceholderText(/filter campers/i).closest('div[class]')
    expect(dropdown?.className).toContain('w-[260px]')
  })
})

describe('LockGroupPanel — gender-scoped AddMemberPicker', () => {
  // Gender lives on the attendee (matches getMemberGender() and the rest of
  // the codebase). The picker's lockedGender derivation reads attendee.gender
  // directly — not person.gender — so these fixtures match real PB data.
  const maleOnlyMembers = [
    {
      id: 'mem-1',
      group: 'group-abc',
      attendee: 'att-1',
      expand: {
        attendee: { gender: 'M', expand: { person: { id: 'p1', cm_id: 9001 } } },
      },
    },
    {
      id: 'mem-2',
      group: 'group-abc',
      attendee: 'att-2',
      expand: {
        attendee: { gender: 'M', expand: { person: { id: 'p2', cm_id: 9002 } } },
      },
    },
  ]
  const mixedMembers = [
    {
      id: 'mem-3',
      group: 'group-abc',
      attendee: 'att-3',
      expand: {
        attendee: { gender: 'M', expand: { person: { id: 'p3', cm_id: 9003 } } },
      },
    },
    {
      id: 'mem-4',
      group: 'group-abc',
      attendee: 'att-4',
      expand: {
        attendee: { gender: 'F', expand: { person: { id: 'p4', cm_id: 9004 } } },
      },
    },
  ]
  const testGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }

  it('locks picker to "M" when all current members are male (gender on attendee)', () => {
    mockGroups = [testGroup]
    mockMembers = maleOnlyMembers
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[
          { id: 'pb-1', person_cm_id: 1000001, name: 'Riley Sam', gender: 'M' } as never,
          { id: 'pb-2', person_cm_id: 1000002, name: 'Sophia Lee', gender: 'F' } as never,
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect(screen.getByRole('option', { name: /riley sam/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /sophia lee/i })).not.toBeInTheDocument()
  })

  it('does NOT lock picker gender when group has mixed-gender members (AG cabin)', () => {
    mockGroups = [testGroup]
    mockMembers = mixedMembers
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[
          { id: 'pb-1', person_cm_id: 1000001, name: 'Riley Sam', gender: 'M' } as never,
          { id: 'pb-2', person_cm_id: 1000002, name: 'Sophia Lee', gender: 'F' } as never,
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect(screen.getByRole('option', { name: /riley sam/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /sophia lee/i })).toBeInTheDocument()
  })

  it('does NOT lock picker gender when group is empty', () => {
    mockGroups = [testGroup]
    mockMembers = [] // membersByGroup['group-abc'] = []
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[
          { id: 'pb-1', person_cm_id: 1000001, name: 'Riley Sam', gender: 'M' } as never,
          { id: 'pb-2', person_cm_id: 1000002, name: 'Sophia Lee', gender: 'F' } as never,
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect(screen.getByRole('option', { name: /riley sam/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /sophia lee/i })).toBeInTheDocument()
  })
})

describe('LockGroupPanel — AddMemberPicker: gender source regression (#1499 issue #2)', () => {
  // Regression for the bug where lockedGender derived from person.gender
  // instead of attendee.gender. Real PB data has gender at the attendee level;
  // person-level gender is not populated, so the picker silently failed to
  // gender-scope its candidates.
  const testGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }

  it('ignores person.gender — picker is NOT gender-scoped when only person.gender is present', () => {
    mockGroups = [testGroup]
    // Note: gender ONLY on person; attendee has no gender field. Picker must
    // treat this as "no locked gender" since the canonical source is empty.
    mockMembers = [
      {
        id: 'mem-1',
        group: 'group-abc',
        attendee: 'att-1',
        expand: { attendee: { expand: { person: { id: 'p1', cm_id: 9001, gender: 'M' } } } },
      },
    ]
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[
          { id: 'pb-1', person_cm_id: 1000001, name: 'Riley Sam', gender: 'M' } as never,
          { id: 'pb-2', person_cm_id: 1000002, name: 'Sophia Lee', gender: 'F' } as never,
        ]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    // Both genders visible — person.gender is NOT the canonical source.
    expect(screen.getByRole('option', { name: /riley sam/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /sophia lee/i })).toBeInTheDocument()
  })
})

describe('LockGroupPanel — query error states (#1499 issue #3)', () => {
  it('shows an error branch when the groups query fails', () => {
    mockGroupsState = { isError: true }
    render(
      <LockGroupPanel isOpen={true} onClose={() => {}} sessionPbId="sess-1" scenarioId="scn-1" />
    )
    const errorPanel = document.querySelector('[data-panel-error]')
    expect(errorPanel).not.toBeNull()
    expect(errorPanel?.textContent).toMatch(/failed to load friend groups/i)
  })

  it('shows an error branch when the members query fails', () => {
    mockMembersState = { isError: true }
    render(
      <LockGroupPanel isOpen={true} onClose={() => {}} sessionPbId="sess-1" scenarioId="scn-1" />
    )
    const errorPanel = document.querySelector('[data-panel-error]')
    expect(errorPanel).not.toBeNull()
    expect(errorPanel?.textContent).toMatch(/failed to load friend groups/i)
  })

  it('does NOT show empty-state when error is set', () => {
    mockGroupsState = { isError: true }
    // groups stays empty — would have rendered "No friend groups yet"
    render(
      <LockGroupPanel isOpen={true} onClose={() => {}} sessionPbId="sess-1" scenarioId="scn-1" />
    )
    expect(screen.queryByText(/no friend groups yet/i)).not.toBeInTheDocument()
  })
})

describe('LockGroupPanel — AddMemberPicker a11y + portal tagging (#1499 issues #6, #8)', () => {
  const testGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }

  it('trigger button exposes aria-haspopup="listbox" and aria-expanded toggles with open state', () => {
    mockGroups = [testGroup]
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[{ id: 'pb-1', person_cm_id: 1000001, name: 'Emma Johnson' } as never]}
      />
    )
    const trigger = screen.getByRole('button', { name: /add member/i })
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('Escape key closes the open picker', () => {
    mockGroups = [testGroup]
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[{ id: 'pb-1', person_cm_id: 1000001, name: 'Emma Johnson' } as never]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    expect(screen.getByPlaceholderText(/filter campers/i)).toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByPlaceholderText(/filter campers/i)).not.toBeInTheDocument()
  })

  it('portaled dropdown carries data-panel="lock-group-picker" so the board click-outside whitelists it', () => {
    mockGroups = [testGroup]
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[{ id: 'pb-1', person_cm_id: 1000001, name: 'Emma Johnson' } as never]}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add member/i }))
    const dropdown = document.querySelector('[data-panel="lock-group-picker"]')
    expect(dropdown).not.toBeNull()
  })
})

describe('LockGroupPanel — AddMemberPicker reposition on scroll (#1499 issue #5)', () => {
  const testGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }

  it('recomputes dropdown position when window scrolls', () => {
    mockGroups = [testGroup]
    mockContext.getCamperLockGroup = () => null
    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        sessionCampers={[{ id: 'pb-1', person_cm_id: 1000001, name: 'Emma Johnson' } as never]}
      />
    )
    const trigger = screen.getByRole('button', { name: /add member/i })
    // Force a non-zero rect from getBoundingClientRect so we can observe a change.
    const originalGetRect = trigger.getBoundingClientRect.bind(trigger)
    trigger.getBoundingClientRect = () =>
      ({
        top: 100,
        bottom: 120,
        left: 200,
        right: 260,
        width: 60,
        height: 20,
        x: 200,
        y: 100,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.click(trigger)
    const dropdownBefore = document.querySelector('[data-panel="lock-group-picker"]') as HTMLElement
    expect(dropdownBefore).not.toBeNull()
    const topBefore = dropdownBefore.style.top
    expect(topBefore).toBe('124px') // bottom (120) + 4

    // Simulate scroll: trigger has moved up to y=50
    trigger.getBoundingClientRect = () =>
      ({
        top: 50,
        bottom: 70,
        left: 200,
        right: 260,
        width: 60,
        height: 20,
        x: 200,
        y: 50,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.scroll(window)
    const dropdownAfter = document.querySelector('[data-panel="lock-group-picker"]') as HTMLElement
    expect(dropdownAfter.style.top).toBe('74px') // bottom (70) + 4

    trigger.getBoundingClientRect = originalGetRect
  })
})

describe('LockGroupPanel — deleting the selected group clears selectedGroupId', () => {
  const testGroup = {
    id: 'group-abc',
    name: 'Emma Squad',
    color: '#ff0000',
    scenario_id: 'scn-1',
    session_pb_id: 'sess-1',
    year: 2026,
    collectionId: 'col1',
    collectionName: 'locked_groups',
    created: '',
    updated: '',
  }

  it('calls onGroupSelect(null) when the selected group is deleted', () => {
    const onGroupSelect = vi.fn()
    mockQueryData = [testGroup]
    mockContext.membersByGroup = { 'group-abc': [] }

    // Mock window.confirm to return true (user confirms deletion)
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    render(
      <LockGroupPanel
        isOpen={true}
        onClose={() => {}}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        selectedGroupId="group-abc"
        onGroupSelect={onGroupSelect}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete group' }))

    expect(onGroupSelect).toHaveBeenCalledWith(null)

    vi.restoreAllMocks()
  })
})
