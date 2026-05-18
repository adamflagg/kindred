/**
 * LockGroupPanel layout + interaction tests.
 *
 * The panel must reserve bottom space (pb-20) when the action bar is visible,
 * so the fixed-bottom bar isn't covered by the panel.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Controls what useQuery returns — swap per test to inject group data.
let mockQueryData: unknown[] = []

// Mock the lazy-loaded panel's React Query consumer.
vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useQuery: () => ({ data: mockQueryData, isLoading: false }),
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
  mockContext.isActionBarVisible = false
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
    expect(screen.queryByRole('button', { name: /emma johnson/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /liam garcia/i })).toBeInTheDocument()
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
    fireEvent.click(screen.getByRole('button', { name: /liam garcia/i }))
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
  // Member records injected into mockQueryData so membersByGroup['group-abc'] is populated.
  // The mock returns the same data for both the groups and members queries, so both the
  // group object and member objects appear in `groups` — member records have no `name`/`color`
  // and render as additional unnamed group cards, but that doesn't affect picker assertions.
  const maleOnlyMembers = [
    {
      id: 'mem-1',
      group: 'group-abc',
      attendee: 'att-1',
      expand: { attendee: { expand: { person: { id: 'p1', cm_id: 9001, gender: 'M' } } } },
    },
    {
      id: 'mem-2',
      group: 'group-abc',
      attendee: 'att-2',
      expand: { attendee: { expand: { person: { id: 'p2', cm_id: 9002, gender: 'M' } } } },
    },
  ]
  const mixedMembers = [
    {
      id: 'mem-3',
      group: 'group-abc',
      attendee: 'att-3',
      expand: { attendee: { expand: { person: { id: 'p3', cm_id: 9003, gender: 'M' } } } },
    },
    {
      id: 'mem-4',
      group: 'group-abc',
      attendee: 'att-4',
      expand: { attendee: { expand: { person: { id: 'p4', cm_id: 9004, gender: 'F' } } } },
    },
  ]
  const testGroup = { id: 'group-abc', name: 'The Lovins', color: '#ec4899' }

  it('locks picker to "M" when all current members are male', () => {
    mockQueryData = [testGroup, ...maleOnlyMembers]
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
    expect(screen.getByRole('button', { name: /riley sam/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sophia lee/i })).not.toBeInTheDocument()
  })

  it('does NOT lock picker gender when group has mixed-gender members (AG cabin)', () => {
    mockQueryData = [testGroup, ...mixedMembers]
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
    expect(screen.getByRole('button', { name: /riley sam/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sophia lee/i })).toBeInTheDocument()
  })

  it('does NOT lock picker gender when group is empty', () => {
    mockQueryData = [testGroup] // no members injected → membersByGroup['group-abc'] = []
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
    expect(screen.getByRole('button', { name: /riley sam/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /sophia lee/i })).toBeInTheDocument()
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
