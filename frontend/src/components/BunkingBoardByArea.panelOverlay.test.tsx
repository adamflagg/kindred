/**
 * Tests for BunkingBoardByArea camper-detail panel behavior.
 *
 * The camper detail panel is a plain slide-in overlay (fixed right-0). Opening
 * it must NEVER move the board: no inline right-margin trim, and the grid keeps
 * its full responsive column count. The panel simply floats over the board's
 * right edge while open. (An earlier version reflowed the board — trimmed the
 * right margin and dropped a grid column — which staff found disorienting
 * because the bunk they were working on jumped to a new position.)
 */
import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'

// ---------------------------------------------------------------------------
// Minimal mocks — keep them lean so the board's internal logic can run
// ---------------------------------------------------------------------------

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
    isActionBarVisible: false,
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2025 }))
vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({ hasPermission: () => true }),
}))
vi.mock('./BunkCard', () => ({
  default: ({
    bunk,
    onCamperClick,
  }: {
    bunk: {
      id: string
      cm_id: number
      name: string
      campers: Array<{ id: string; person_cm_id: number; name: string }>
    }
    onCamperClick?: (camper: { id: string; person_cm_id: number; name: string }) => void
  }) => (
    <div data-bunk-card data-testid={`bunk-${bunk.id}`}>
      {bunk.campers.map((c) => (
        <button
          key={c.id}
          onClick={() => onCamperClick?.(c)}
          data-testid={`camper-btn-${c.person_cm_id}`}
        >
          {c.name}
        </button>
      ))}
    </div>
  ),
}))
vi.mock('./FloatingUnassignedBadge', () => ({ default: () => null }))
vi.mock('./CamperDetailsPanel', () => ({
  default: ({ camperId, onClose }: { camperId: string; onClose: () => void }) => (
    <div data-panel="camper-details" data-testid="camper-panel" data-camper-id={camperId}>
      <button data-testid="panel-close-btn" onClick={() => onClose()}>
        close
      </button>
    </div>
  ),
}))
vi.mock('./BunkSocialGraphModal', () => ({ default: () => null }))
vi.mock('./LockGroupActionBar', () => ({ default: () => null }))
vi.mock('./LockGroupPanel', () => ({ default: () => null }))
vi.mock('./LockGroupsHub', () => ({ default: () => null }))

// ---------------------------------------------------------------------------
// Fixtures — fictional names per CLAUDE.md
// ---------------------------------------------------------------------------

import BunkingBoardByArea from './BunkingBoardByArea'
import type { Bunk, Camper } from '../types/app-types'

const makeBaseProps = () => ({
  sessionId: 'sess-1',
  sessionCmId: 1001,
  bunks: [
    {
      id: 'bunk-oak',
      cm_id: 9001,
      name: 'B-1',
      gender: 'M',
      capacity: 12,
      year: 2025,
      campers: [
        {
          id: 'emma:sess-1',
          person_cm_id: 100,
          name: 'Emma Johnson',
          gender: 'F',
          grade: 6,
          assigned_bunk: 'bunk-oak',
          assigned_bunk_cm_id: 9001,
        },
      ],
      occupancy: 1,
      utilization: 8,
    },
  ] as unknown as Bunk[],
  campers: [
    {
      id: 'emma:sess-1',
      person_cm_id: 100,
      name: 'Emma Johnson',
      gender: 'F',
      grade: 6,
      assigned_bunk: 'bunk-oak',
      assigned_bunk_cm_id: 9001,
    },
  ] as unknown as Camper[],
  selectedArea: 'all' as const,
  onAreaChange: vi.fn(),
  onCamperMove: vi.fn(async () => {}),
})

// ---------------------------------------------------------------------------
// Frozen-board tests
// ---------------------------------------------------------------------------

describe('BunkingBoardByArea — camper panel is a frozen overlay', () => {
  it('board wrapper has no right-margin trim when no camper is selected', () => {
    const { container } = render(<BunkingBoardByArea {...makeBaseProps()} />)

    const wrapper = container.querySelector<HTMLElement>('[data-board-wrapper]')
    expect(wrapper).not.toBeNull()
    expect(wrapper?.style.marginRight ?? '').toBe('')
  })

  it('selecting a camper does NOT trim the board (no inline marginRight)', () => {
    const { container, getByTestId } = render(<BunkingBoardByArea {...makeBaseProps()} />)

    fireEvent.click(getByTestId('camper-btn-100'))

    const wrapper = container.querySelector<HTMLElement>('[data-board-wrapper]')
    expect(wrapper?.style.marginRight ?? '').toBe('')
  })

  it('selecting a camper keeps the full column count (no column drop)', () => {
    const { container, getByTestId } = render(<BunkingBoardByArea {...makeBaseProps()} />)

    fireEvent.click(getByTestId('camper-btn-100'))

    const grid = container.querySelector('[data-bunk-grid]')
    expect(grid?.className ?? '').toContain('xl:grid-cols-4')
    expect(grid?.className ?? '').not.toContain('xl:grid-cols-3')
  })

  it('column count is identical before and after opening the panel', () => {
    const { container, getByTestId } = render(<BunkingBoardByArea {...makeBaseProps()} />)

    const gridBefore = container.querySelector('[data-bunk-grid]')?.className ?? ''
    fireEvent.click(getByTestId('camper-btn-100'))
    const gridAfter = container.querySelector('[data-bunk-grid]')?.className ?? ''

    expect(gridAfter).toBe(gridBefore)
  })

  it('CamperDetailsPanel renders alongside (not replacing) the board grid when open', () => {
    const { container, getByTestId } = render(<BunkingBoardByArea {...makeBaseProps()} />)

    fireEvent.click(getByTestId('camper-btn-100'))

    const board = container.querySelector('[data-board-wrapper]')
    const panel = getByTestId('camper-panel')
    expect(board).toBeInTheDocument()
    expect(panel).toBeInTheDocument()
  })

  it('board stays untrimmed after the panel closes', () => {
    const { container, getByTestId, queryByTestId } = render(
      <BunkingBoardByArea {...makeBaseProps()} />
    )

    fireEvent.click(getByTestId('camper-btn-100'))
    fireEvent.click(getByTestId('panel-close-btn'))

    expect(queryByTestId('camper-panel')).toBeNull()
    const wrapper = container.querySelector<HTMLElement>('[data-board-wrapper]')
    expect(wrapper?.style.marginRight ?? '').toBe('')
    const grid = container.querySelector('[data-bunk-grid]')
    expect(grid?.className ?? '').toContain('xl:grid-cols-4')
  })
})
