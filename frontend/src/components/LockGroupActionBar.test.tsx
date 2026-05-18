/**
 * LockGroupActionBar branches on `selectedGroupId`:
 *   - null → "Create Group" path (today's behavior)
 *   - set  → "Add to group" path (calls addCamperToGroup per pending camper)
 *
 * Also confirms the root carries data-panel="lock-action-bar" so #1372's
 * click-outside whitelist matches.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const addCamperToGroup = vi.fn().mockResolvedValue(undefined)
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
  addCamperToGroup.mockClear()
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
    await fireEvent.click(cta)
    // Let the queued microtasks flush
    await Promise.resolve()
    expect(addCamperToGroup).toHaveBeenCalledTimes(2)
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
    await fireEvent.click(cta)
    await Promise.resolve()
    expect(createMock).not.toHaveBeenCalled()
  })
})
