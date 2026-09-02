/**
 * LockGroupActionBar branches on `selectedGroupId`:
 *   - null → "Create Group" path (today's behavior)
 *   - set  → "Add to group" path (calls addCamperToGroup per pending camper)
 *
 * Also confirms the root carries data-panel="lock-action-bar" so #1372's
 * click-outside whitelist matches.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Default: every add succeeds. Failure-path tests override with mockResolvedValueOnce / mockResolvedValue(false).
const addCamperToGroup = vi.fn().mockResolvedValue(true)
const onClearPending = vi.fn()
const onGroupCreated = vi.fn()
const createMock = vi.fn().mockResolvedValue({ id: 'new-group' })

let mockSelectedGroupId: string | null = null
const groupList = [{ id: 'group-abc', name: 'The Lovins', color: '#ec4899' }]
const pendingList = [
  { id: 'pb-1', person_cm_id: 1000001, name: 'Emma Johnson', attendee_id: 'att-1' },
  { id: 'pb-2', person_cm_id: 1000002, name: 'Liam Garcia', attendee_id: 'att-2' },
]

vi.mock('@tanstack/react-query', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-query')>('@tanstack/react-query')
  return {
    ...actual,
    useMutation: (opts: { mutationFn: () => Promise<unknown> }) => ({
      mutate: () => void opts.mutationFn(),
      mutateAsync: opts.mutationFn,
      isPending: false,
    }),
    useQueryClient: () => ({ invalidateQueries: () => {} }),
  }
})

vi.mock('../lib/pocketbase', () => ({
  pb: {
    collection: () => ({ create: createMock }),
    authStore: { record: { email: 'test@example.com' } },
  },
  getCurrentUserEmail: () => 'test@example.com',
}))

vi.mock('../hooks/useGroupConflictConfirm', () => ({
  useGroupConflictConfirm: () => ({
    dialogState: { isOpen: false },
    checkConflict: () => Promise.resolve('confirmed'),
  }),
}))

vi.mock('react-hot-toast', () => ({
  toast: { success: () => {}, error: () => {} },
  default: { success: () => {}, error: () => {} },
}))

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    groups: groupList,
    selectedGroupId: mockSelectedGroupId,
    addCamperToGroup,
  }),
}))

import LockGroupActionBar from './LockGroupActionBar'
import type { Camper } from '../types/app-types'

beforeEach(() => {
  addCamperToGroup.mockReset()
  addCamperToGroup.mockResolvedValue(true)
  onClearPending.mockClear()
  onGroupCreated.mockClear()
  createMock.mockClear()
  mockSelectedGroupId = null
})

describe('LockGroupActionBar — Create branch (selectedGroupId=null)', () => {
  it('renders "selected" copy and "Create Group" CTA', () => {
    mockSelectedGroupId = null
    render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    expect(screen.getByText(/selected/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /create group/i })).toBeInTheDocument()
  })

  it('root has data-panel="lock-action-bar"', () => {
    mockSelectedGroupId = null
    const { container } = render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    expect(container.querySelector('[data-panel="lock-action-bar"]')).not.toBeNull()
  })
})

describe('LockGroupActionBar — Add branch (selectedGroupId set)', () => {
  it('renders "Add N to {name}" copy and "Add to group" CTA', () => {
    mockSelectedGroupId = 'group-abc'
    render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    expect(screen.getByText(/add 2 to/i)).toBeInTheDocument()
    expect(screen.getByText(/the lovins/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add to group/i })).toBeInTheDocument()
  })

  it('CTA invokes addCamperToGroup once per pending camper with the selected group id', async () => {
    mockSelectedGroupId = 'group-abc'
    render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    const cta = screen.getByRole('button', { name: /add to group/i })
    fireEvent.click(cta)
    await waitFor(() => {
      expect(addCamperToGroup).toHaveBeenCalledTimes(2)
    })
    expect(addCamperToGroup).toHaveBeenNthCalledWith(1, pendingList[0], 'group-abc')
    expect(addCamperToGroup).toHaveBeenNthCalledWith(2, pendingList[1], 'group-abc')
    expect(onClearPending).toHaveBeenCalled()
  })

  it('does not call PB collection.create (the create-group path) in add mode', async () => {
    mockSelectedGroupId = 'group-abc'
    render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    const cta = screen.getByRole('button', { name: /add to group/i })
    fireEvent.click(cta)
    await waitFor(() => {
      expect(addCamperToGroup).toHaveBeenCalled()
    })
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('LockGroupActionBar — add-mode partial-failure + re-entrancy guards', () => {
  it('does NOT clear pending if any addCamperToGroup returns false', async () => {
    mockSelectedGroupId = 'group-abc'
    // First add succeeds, second fails (e.g. PB error already toasted internally).
    addCamperToGroup.mockResolvedValueOnce(true).mockResolvedValueOnce(false)
    render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add to group/i }))
    await waitFor(() => {
      expect(addCamperToGroup).toHaveBeenCalledTimes(2)
    })
    // Both campers were attempted, but pending must remain so the user can retry the failed one.
    expect(onClearPending).not.toHaveBeenCalled()
  })

  it('clears pending only when every addCamperToGroup returns true', async () => {
    mockSelectedGroupId = 'group-abc'
    addCamperToGroup.mockResolvedValue(true)
    render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /add to group/i }))
    await waitFor(() => {
      expect(addCamperToGroup).toHaveBeenCalledTimes(2)
    })
    expect(onClearPending).toHaveBeenCalledTimes(1)
  })

  it('is single-flight: rapid double-click does not duplicate the add loop', async () => {
    mockSelectedGroupId = 'group-abc'
    // Slow promises so the in-flight guard is observably engaged when the
    // second click fires.
    let resolveFirst: (v: boolean) => void = () => {}
    let resolveSecond: (v: boolean) => void = () => {}
    const firstPromise = new Promise<boolean>((r) => {
      resolveFirst = r
    })
    const secondPromise = new Promise<boolean>((r) => {
      resolveSecond = r
    })
    addCamperToGroup
      .mockReturnValueOnce(firstPromise)
      .mockReturnValueOnce(secondPromise)
      .mockResolvedValue(true) // any further calls (there shouldn't be any) resolve true

    render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    const cta = screen.getByRole('button', { name: /add to group/i })
    fireEvent.click(cta)
    // Burst-click before the first batch settles.
    fireEvent.click(cta)
    fireEvent.click(cta)
    // Drain the in-flight calls.
    resolveFirst(true)
    resolveSecond(true)
    await waitFor(() => {
      expect(onClearPending).toHaveBeenCalledTimes(1)
    })
    // Exactly one add per pending camper — extra clicks were dropped.
    expect(addCamperToGroup).toHaveBeenCalledTimes(2)
    // Create-group path must not have fired either.
    expect(createMock).not.toHaveBeenCalled()
  })
})

describe('LockGroupActionBar — "(select at least 2)" helper visibility', () => {
  const onePending = [pendingList[0]] as Camper[]

  it('shows helper in CREATE mode with one pending camper', () => {
    mockSelectedGroupId = null
    render(
      <LockGroupActionBar
        pendingCampers={onePending}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    expect(screen.getByText(/select at least 2/i)).toBeInTheDocument()
  })

  it('HIDES helper in ADD mode with one pending camper (add-1 is valid)', () => {
    mockSelectedGroupId = 'group-abc'
    render(
      <LockGroupActionBar
        pendingCampers={onePending}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    expect(screen.queryByText(/select at least 2/i)).not.toBeInTheDocument()
  })
})

describe('LockGroupActionBar — add-mode background is layered, not replaced', () => {
  it('keeps bg-background class and uses backgroundImage (not backgroundColor) for the tint', () => {
    mockSelectedGroupId = 'group-abc'
    const { container } = render(
      <LockGroupActionBar
        pendingCampers={pendingList as unknown as Camper[]}
        sessionPbId="sess-1"
        scenarioId="scn-1"
        year={2026}
        onClearPending={onClearPending}
        onGroupCreated={onGroupCreated}
      />
    )
    // Assertion is load-bearing for the `root?.style.*` accesses below — eslint's
    // no-unnecessary-type-assertion flags it, but removing it drops querySelector's
    // inferred type to `Element | null`, which has no `.style` (tsc TS2339). Do not autofix.
    const root = container.querySelector('[data-panel="lock-action-bar"]') as HTMLElement | null
    expect(root).not.toBeNull()
    // Solid base bg must still be present
    expect(root?.classList.contains('bg-background')).toBe(true)
    // Inline override must NOT replace it
    expect(root?.style.backgroundColor).toBe('')
    // Tint is layered via backgroundImage
    expect(root?.style.backgroundImage).toContain('linear-gradient')
    // Stripe still set
    expect(root?.style.borderLeftColor).toBeTruthy()
  })
})
