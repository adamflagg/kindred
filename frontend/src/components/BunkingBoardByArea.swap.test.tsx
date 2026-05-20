/**
 * Integration tests for the bunk-swap action (#1546).
 *
 * Asserts that BunkingBoardByArea:
 *   1. Passes onSwapClick down to each BunkCard.
 *   2. Opens BunkSwapModal with the source bunk when a card's Swap button
 *      is clicked.
 *   3. Calls onCamperMove once per camper in both rosters when the user
 *      confirms a swap, then closes the modal.
 *   4. Does not move any campers when the modal is dismissed via Cancel.
 *
 * BunkCard itself is stubbed so the test exercises the wiring layer
 * without booting dnd-kit / lock contexts. BunkSwapModal renders for real.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { toast } from 'react-hot-toast'

import type { BunkWithCampers, Camper, Bunk } from '../types/app-types'

const { mockHasPermission } = vi.hoisted(() => ({
  mockHasPermission: vi.fn(() => true),
}))

vi.mock('./FloatingUnassignedBadge', () => ({ default: () => null }))
vi.mock('./CamperDetailsPanel', () => ({ default: () => null }))
vi.mock('./BunkSocialGraphModal', () => ({ default: () => null }))
vi.mock('./LockGroupActionBar', () => ({ default: () => null }))
vi.mock('./LockGroupPanel', () => ({ default: () => null }))

// Stub BunkCard to expose only what the swap-wiring test needs: the bunk
// name and a Swap button that fires onSwapClick. Keeps the test free of
// dnd-kit / lock / context dependencies BunkCard pulls in for real.
vi.mock('./BunkCard', () => ({
  default: ({ bunk, onSwapClick }: { bunk: BunkWithCampers; onSwapClick?: () => void }) => (
    <div data-testid={`bunk-card-${bunk.id}`}>
      <span>{bunk.name}</span>
      {onSwapClick && (
        <button onClick={onSwapClick} aria-label={`Swap bunk ${bunk.name}`}>
          Swap
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

function makeCamper(overrides: Partial<Camper> & { id: string }): Camper {
  const personCmId = parseInt(overrides.id.replace(/\D/g, ''), 10) || 9999
  return {
    name: 'Test Camper',
    age: 12,
    grade: 7,
    gender: 'F',
    session_cm_id: 1000001,
    person_cm_id: personCmId,
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const bunkG9 = makeBunk({ id: 'g9', name: 'G-9', gender: 'F' })
const bunkG10b = makeBunk({ id: 'g10b', name: 'G-10b', gender: 'F' })
const bunks = [bunkG9, bunkG10b]
const c1 = makeCamper({ id: 'c1', assigned_bunk: 'g9' })
const c2 = makeCamper({ id: 'c2', assigned_bunk: 'g9' })
const c3 = makeCamper({ id: 'c3', assigned_bunk: 'g10b' })
const campers = [c1, c2, c3]

describe('BunkingBoardByArea — bunk swap', () => {
  const baseProps = {
    sessionId: 's1',
    sessionCmId: 1000001,
    bunks,
    campers,
    selectedArea: 'all' as const,
    onAreaChange: () => {},
  }

  beforeEach(() => {
    mockHasPermission.mockReturnValue(true)
    vi.restoreAllMocks()
  })

  it('opens the swap modal when a bunk Swap button is clicked', () => {
    render(<BunkingBoardByArea {...baseProps} onCamperMove={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Swap bunk G-9' }))
    expect(screen.getByText(/Swap G-9 with/i)).toBeInTheDocument()
  })

  it('calls onCamperMove for each camper in both bunks when Confirm is clicked', async () => {
    const onCamperMove = vi.fn().mockResolvedValue(undefined)
    render(<BunkingBoardByArea {...baseProps} onCamperMove={onCamperMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Swap bunk G-9' }))
    fireEvent.click(screen.getByRole('radio', { name: /G-10b/ }))
    fireEvent.click(screen.getByRole('button', { name: /confirm swap/i }))

    await waitFor(() => {
      expect(onCamperMove).toHaveBeenCalledWith('c1', 'g10b')
    })
    expect(onCamperMove).toHaveBeenCalledWith('c2', 'g10b')
    expect(onCamperMove).toHaveBeenCalledWith('c3', 'g9')
    expect(onCamperMove).toHaveBeenCalledTimes(3)
  })

  it('closes the modal after a successful swap', async () => {
    const onCamperMove = vi.fn().mockResolvedValue(undefined)
    render(<BunkingBoardByArea {...baseProps} onCamperMove={onCamperMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Swap bunk G-9' }))
    fireEvent.click(screen.getByRole('radio', { name: /G-10b/ }))
    fireEvent.click(screen.getByRole('button', { name: /confirm swap/i }))
    await waitFor(() => {
      expect(screen.queryByText(/Swap G-9 with/i)).not.toBeInTheDocument()
    })
  })

  it('does not call onCamperMove when the modal is cancelled', () => {
    const onCamperMove = vi.fn()
    render(<BunkingBoardByArea {...baseProps} onCamperMove={onCamperMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Swap bunk G-9' }))
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
    expect(onCamperMove).not.toHaveBeenCalled()
    expect(screen.queryByText(/Swap G-9 with/i)).not.toBeInTheDocument()
  })

  it('hides the Swap button on every bunk when isProductionMode is true', () => {
    render(<BunkingBoardByArea {...baseProps} onCamperMove={vi.fn()} isProductionMode={true} />)
    expect(screen.queryByRole('button', { name: /Swap bunk/ })).not.toBeInTheDocument()
  })

  it('hides the Swap button when the user lacks BUNKING_MANAGE permission', () => {
    mockHasPermission.mockReturnValue(false)
    render(<BunkingBoardByArea {...baseProps} onCamperMove={vi.fn()} />)
    expect(screen.queryByRole('button', { name: /Swap bunk/ })).not.toBeInTheDocument()
  })

  it('shows an error toast when a camper move rejects during swap', async () => {
    const toastErrorSpy = vi.spyOn(toast, 'error').mockReturnValue('mock-id')
    const onCamperMove = vi.fn().mockRejectedValue(new Error('move failed'))
    render(<BunkingBoardByArea {...baseProps} onCamperMove={onCamperMove} />)
    fireEvent.click(screen.getByRole('button', { name: 'Swap bunk G-9' }))
    fireEvent.click(screen.getByRole('radio', { name: /G-10b/ }))
    fireEvent.click(screen.getByRole('button', { name: /confirm swap/i }))

    await waitFor(() => {
      expect(toastErrorSpy).toHaveBeenCalled()
    })
  })
})
