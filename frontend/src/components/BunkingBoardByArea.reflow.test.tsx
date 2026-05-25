/**
 * Tests for BunkingBoardByArea panel-reflow and auto-pan behavior.
 *
 * Reflow: when the camper detail panel is open, the board outer wrapper gets
 * the compressed-width class from getBoardWrapperClass(true). When closed
 * (no selected camper), it gets getBoardWrapperClass(false).
 *
 * Auto-pan: autoPanToBunk is called when selectedCamperId changes (a camper
 * is selected on the board).
 *
 * Both behaviors are tested at the logic-seam level (rendered state / spy
 * calls), not pixels.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { getBoardWrapperClass } from '../utils/bunkBoardLayout'
import * as autoPanModule from '../utils/bunkAutoPan'

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
    <div data-bunk-card data-bunk-cm-id={bunk.cm_id} data-testid={`bunk-${bunk.id}`}>
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
// Reflow tests
// ---------------------------------------------------------------------------

describe('BunkingBoardByArea — panel reflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('board wrapper does NOT have the compressed class when no camper is selected', () => {
    const { container } = render(<BunkingBoardByArea {...makeBaseProps()} />)

    // The compressed class should NOT be present when panel is closed
    // Find the board wrapper by data-testid
    const wrapper = container.querySelector('[data-board-wrapper]')
    expect(wrapper).not.toBeNull()
    // None of the compressed-panel classes should be applied when closed
    const closedClass = getBoardWrapperClass(false)
    if (closedClass === '') {
      // Board wrapper should not have the open class
      expect(wrapper?.className ?? '').not.toContain('mr-[28rem]')
    } else {
      expect(wrapper?.className ?? '').toContain(closedClass)
    }
  })

  it('board wrapper gets the compressed class when a camper is selected', () => {
    const props = makeBaseProps()
    const { container, getByTestId } = render(<BunkingBoardByArea {...props} />)

    // Click Emma Johnson to open the panel
    fireEvent.click(getByTestId('camper-btn-100'))

    const wrapper = container.querySelector('[data-board-wrapper]')
    expect(wrapper).not.toBeNull()

    const openClass = getBoardWrapperClass(true)
    // The open class must include the right-margin compression
    expect(openClass).toContain('mr-[28rem]')
    expect(wrapper?.className ?? '').toContain('mr-[28rem]')
  })

  it('board wrapper loses the compressed class when the panel closes', () => {
    const props = makeBaseProps()
    const { container, getByTestId, queryByTestId } = render(<BunkingBoardByArea {...props} />)

    // Open the panel
    fireEvent.click(getByTestId('camper-btn-100'))

    const wrapper = container.querySelector('[data-board-wrapper]')
    expect(wrapper?.className ?? '').toContain('mr-[28rem]')

    // Close the panel via its onClose callback (handleCloseDetails clears
    // selectedCamperId synchronously). The panel mock exposes a close button.
    fireEvent.click(getByTestId('panel-close-btn'))

    // Panel unmounts and the compressed class is removed (board re-expands).
    expect(queryByTestId('camper-panel')).toBeNull()
    expect(wrapper?.className ?? '').not.toContain('mr-[28rem]')
  })

  it('reduces the bunk grid column count when the panel opens', () => {
    const props = makeBaseProps()
    const { container, getByTestId } = render(<BunkingBoardByArea {...props} />)

    const grid = container.querySelector('[data-bunk-grid]')
    // Closed: full column count so bunks fill the board width.
    expect(grid?.className ?? '').toContain('xl:grid-cols-4')

    // Open the panel — grid drops a column per breakpoint so bunks keep width.
    fireEvent.click(getByTestId('camper-btn-100'))
    expect(grid?.className ?? '').toContain('xl:grid-cols-3')
    expect(grid?.className ?? '').not.toContain('xl:grid-cols-4')
  })

  it('CamperDetailsPanel renders alongside (not replacing) the board grid when open', () => {
    const props = makeBaseProps()
    const { container, getByTestId } = render(<BunkingBoardByArea {...props} />)

    fireEvent.click(getByTestId('camper-btn-100'))

    // Board grid must still be present (not replaced by the panel)
    const grid = container.querySelector('[data-board-wrapper]')
    const panel = getByTestId('camper-panel')
    expect(grid).toBeInTheDocument()
    expect(panel).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Auto-pan tests
// ---------------------------------------------------------------------------

describe('BunkingBoardByArea — auto-pan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls autoPanToBunk when a camper is selected', () => {
    const autoPanSpy = vi.spyOn(autoPanModule, 'autoPanToBunk')

    const props = makeBaseProps()
    const { getByTestId } = render(<BunkingBoardByArea {...props} />)

    // Select Emma Johnson (person_cm_id=100, assigned_bunk_cm_id=9001)
    fireEvent.click(getByTestId('camper-btn-100'))

    // autoPanToBunk should have been called with the camper's bunk CM ID
    expect(autoPanSpy).toHaveBeenCalledWith(
      9001, // assigned_bunk_cm_id for Emma Johnson
      expect.anything() // scroll container (HTMLElement or null)
    )
  })

  it('does not call autoPanToBunk when no camper is selected (initial render)', () => {
    const autoPanSpy = vi.spyOn(autoPanModule, 'autoPanToBunk')

    render(<BunkingBoardByArea {...makeBaseProps()} />)

    // autoPanToBunk must not fire on initial render when no selection exists
    // (it would scroll the board unexpectedly on mount)
    expect(autoPanSpy).not.toHaveBeenCalled()
  })

  it('calls autoPanToBunk with null bunkCmId for unassigned camper (graceful no-op)', () => {
    const autoPanSpy = vi.spyOn(autoPanModule, 'autoPanToBunk')

    // An unassigned camper: no assigned_bunk_cm_id. Place them in a bunk card
    // (so the click button renders) but omit assigned_bunk_cm_id from the
    // campers list — the effect should pass null to autoPanToBunk.
    const liamUnassigned = {
      id: 'liam:sess-1',
      person_cm_id: 201,
      name: 'Liam Garcia',
      gender: 'M',
      grade: 6,
      assigned_bunk: 'bunk-pine',
      // no assigned_bunk_cm_id → undefined → ?? null gives null
    } as unknown as Camper

    const props = makeBaseProps()
    props.campers = [liamUnassigned]
    props.bunks = [
      {
        id: 'bunk-pine',
        cm_id: 9002,
        name: 'B-2',
        gender: 'M',
        capacity: 12,
        year: 2025,
        campers: [liamUnassigned],
        occupancy: 1,
        utilization: 8,
      } as unknown as Bunk,
    ]

    const { getByTestId } = render(<BunkingBoardByArea {...props} />)
    fireEvent.click(getByTestId('camper-btn-201'))

    // autoPanToBunk should be called; the utility itself no-ops on null/undefined bunkCmId
    expect(autoPanSpy).toHaveBeenCalledWith(
      null, // no bunk_cm_id assigned (undefined ?? null = null)
      expect.anything()
    )
  })
})
