/**
 * LockGroupPanel layout + interaction tests.
 *
 * The panel must reserve bottom space (pb-20) when the action bar is visible,
 * so the fixed-bottom bar isn't covered by the panel.
 */
import { render } from '@testing-library/react'
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
    useMutation: () => ({
      mutate: () => {},
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
  getCamperLockGroup: () => unknown
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
}
vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => mockContext,
}))

import LockGroupPanel from './LockGroupPanel'

beforeEach(() => {
  mockQueryData = []
  mockContext.isActionBarVisible = false
  mockContext.selectedGroupId = null
})

describe('LockGroupPanel layout', () => {
  it('has no bottom-padding class when action bar is hidden', () => {
    mockContext.isActionBarVisible = false
    const { container } = render(
      <LockGroupPanel isOpen={true} onClose={() => {}} sessionPbId="sess-1" scenarioId="scn-1" />
    )
    const root = container.querySelector('[data-panel="lock-group"]')
    expect(root?.className).not.toContain('pb-20')
  })

  it('adds pb-20 to the panel root when action bar is visible', () => {
    mockContext.isActionBarVisible = true
    const { container } = render(
      <LockGroupPanel isOpen={true} onClose={() => {}} sessionPbId="sess-1" scenarioId="scn-1" />
    )
    const root = container.querySelector('[data-panel="lock-group"]')
    expect(root?.className).toContain('pb-20')
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
