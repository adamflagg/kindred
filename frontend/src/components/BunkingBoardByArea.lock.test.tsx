/**
 * Tests for BunkingBoardByArea cabin-level lock wiring (#1609).
 *
 * Asserts that BunkingBoardByArea:
 *  1. Renders "Lock all" and "Unlock all" buttons when user can manage.
 *  2. Clicking "Lock all" calls onLockAll with the visible bunk cm_ids.
 *  3. Clicking "Unlock all" calls onUnlockAll.
 *  4. A bunk in lockedBunkCmIds shows the locked visual on its card.
 *  5. Clicking a card's lock toggle calls onToggleBunkLock with that bunk's cm_id.
 *
 * BunkCard is stubbed to expose the lock toggle without booting dnd-kit /
 * lock-group contexts. Mirrors the render harness from BunkingBoardByArea.swap.test.tsx.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { BunkWithCampers, Bunk } from '../types/app-types'

const { mockHasPermission } = vi.hoisted(() => ({
  mockHasPermission: vi.fn(() => true),
}))

vi.mock('./FloatingUnassignedBadge', () => ({ default: () => null }))
vi.mock('./CamperDetailsPanel', () => ({ default: () => null }))
vi.mock('./BunkSocialGraphModal', () => ({ default: () => null }))
vi.mock('./LockGroupActionBar', () => ({ default: () => null }))
vi.mock('./LockGroupPanel', () => ({ default: () => null }))

// Stub BunkCard to expose the lock-toggle wiring under test: renders bunk name,
// a lock button when onToggleLock is provided, and shows a "locked" badge when
// isLocked=true. Keeps the test free of dnd-kit / lock-group context deps.
vi.mock('./BunkCard', () => ({
  default: ({
    bunk,
    isLocked,
    onToggleLock,
  }: {
    bunk: BunkWithCampers
    isLocked?: boolean
    onToggleLock?: () => void
  }) => (
    <div data-testid={`bunk-card-${bunk.id}`}>
      <span>{bunk.name}</span>
      {isLocked && <span>locked</span>}
      {onToggleLock && (
        <button
          onClick={onToggleLock}
          aria-label={isLocked ? `Unlock cabin ${bunk.name}` : `Lock cabin ${bunk.name}`}
          aria-pressed={isLocked ?? false}
        >
          {isLocked ? 'Unlock cabin' : 'Lock cabin'}
        </button>
      )}
    </div>
  ),
}))

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    pendingCampers: [],
    clearPendingCampers: () => {},
    addPendingCamper: () => {},
    removePendingCamper: () => {},
    getCamperLockState: () => 'none',
    getCamperLockGroup: () => null,
    getGroupMembers: () => [],
    scenarioId: null,
    sessionPbId: null,
    isDraftMode: false,
    isLockPanelOpen: false,
    setIsLockPanelOpen: () => {},
    selectedGroupId: null,
    setSelectedGroupId: () => {},
    groups: [],
    membersByGroup: new Map(),
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: mockHasPermission }),
}))

import BunkingBoardByArea from './BunkingBoardByArea'

function makeBunk(overrides: Partial<Bunk> = {}): Bunk {
  return {
    id: 'bunk-1',
    cm_id: 1001,
    name: 'G-9',
    gender: 'F',
    is_active: true,
    sort_order: 0,
    year: 2026,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    collectionId: 'bunks',
    collectionName: 'bunks',
    ...overrides,
  } as Bunk
}

// Two visible bunks — fictional names for test fixture
const bunkA = makeBunk({ id: 'g9', cm_id: 1001, name: 'G-9', gender: 'F' })
const bunkB = makeBunk({ id: 'g10', cm_id: 1002, name: 'G-10', gender: 'F' })
const bunks = [bunkA, bunkB]

describe('BunkingBoardByArea — cabin lock wiring', () => {
  const baseProps = {
    sessionId: 's1',
    sessionCmId: 1000001,
    bunks,
    campers: [],
    selectedArea: 'all' as const,
    onAreaChange: () => {},
    onCamperMove: vi.fn(),
  }

  beforeEach(() => {
    mockHasPermission.mockReturnValue(true)
    vi.restoreAllMocks()
  })

  it('renders "Lock all" and "Unlock all" buttons when user can manage', () => {
    render(
      <BunkingBoardByArea
        {...baseProps}
        onLockAll={vi.fn()}
        onUnlockAll={vi.fn()}
        onToggleBunkLock={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: 'Lock all' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Unlock all' })).toBeInTheDocument()
  })

  it('does not render Lock all / Unlock all when user lacks manage permission', () => {
    mockHasPermission.mockReturnValue(false)
    render(
      <BunkingBoardByArea
        {...baseProps}
        onLockAll={vi.fn()}
        onUnlockAll={vi.fn()}
        onToggleBunkLock={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Lock all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock all' })).not.toBeInTheDocument()
  })

  it('does not render Lock all / Unlock all in production mode', () => {
    render(
      <BunkingBoardByArea
        {...baseProps}
        isProductionMode={true}
        onLockAll={vi.fn()}
        onUnlockAll={vi.fn()}
        onToggleBunkLock={vi.fn()}
      />
    )
    expect(screen.queryByRole('button', { name: 'Lock all' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock all' })).not.toBeInTheDocument()
  })

  it('does not render lock controls when the lock props are not provided', () => {
    // Props-absent path: no onLockAll/onUnlockAll/onToggleBunkLock → graceful
    // degradation (no toolbar, no per-card lock toggle).
    render(<BunkingBoardByArea {...baseProps} />)
    expect(screen.queryByRole('button', { name: /lock all/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /unlock all/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /lock cabin/i })).toBeNull()
  })

  it('clicking "Lock all" calls onLockAll with the visible bunk cm_ids', () => {
    const onLockAll = vi.fn()
    render(
      <BunkingBoardByArea
        {...baseProps}
        onLockAll={onLockAll}
        onUnlockAll={vi.fn()}
        onToggleBunkLock={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Lock all' }))
    expect(onLockAll).toHaveBeenCalledTimes(1)
    const firstCallArgs = onLockAll.mock.calls[0] as [number[]]
    expect(onLockAll).toHaveBeenCalledWith(expect.arrayContaining([1001, 1002]))
    expect(firstCallArgs[0]).toHaveLength(2)
  })

  it('clicking "Unlock all" calls onUnlockAll', () => {
    const onUnlockAll = vi.fn()
    render(
      <BunkingBoardByArea
        {...baseProps}
        onLockAll={vi.fn()}
        onUnlockAll={onUnlockAll}
        onToggleBunkLock={vi.fn()}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Unlock all' }))
    expect(onUnlockAll).toHaveBeenCalledTimes(1)
  })

  it('shows the locked visual on a bunk whose cm_id is in lockedBunkCmIds', () => {
    const locked = new Set([1001]) as ReadonlySet<number>
    render(
      <BunkingBoardByArea
        {...baseProps}
        lockedBunkCmIds={locked}
        onLockAll={vi.fn()}
        onUnlockAll={vi.fn()}
        onToggleBunkLock={vi.fn()}
      />
    )
    // Bunk G-9 (cm_id 1001) should show the locked indicator
    const cardG9 = screen.getByTestId('bunk-card-g9')
    expect(cardG9).toHaveTextContent('locked')
    // Bunk G-10 (cm_id 1002) should NOT show the locked indicator
    const cardG10 = screen.getByTestId('bunk-card-g10')
    expect(cardG10).not.toHaveTextContent('locked')
  })

  it('clicking a card lock toggle calls onToggleBunkLock with that bunk cm_id', () => {
    const onToggleBunkLock = vi.fn()
    render(
      <BunkingBoardByArea
        {...baseProps}
        onLockAll={vi.fn()}
        onUnlockAll={vi.fn()}
        onToggleBunkLock={onToggleBunkLock}
      />
    )
    // Click the lock toggle on bunk G-9 (cm_id 1001)
    fireEvent.click(screen.getByRole('button', { name: /lock cabin G-9/i }))
    expect(onToggleBunkLock).toHaveBeenCalledWith(1001)
    expect(onToggleBunkLock).toHaveBeenCalledTimes(1)
  })
})
