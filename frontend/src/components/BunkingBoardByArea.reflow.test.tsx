/**
 * Tests for BunkingBoardByArea panel-reflow and auto-pan behavior.
 *
 * Reflow: when the camper detail panel opens, computeBoardReflow decides how
 * much (if at all) to trim the board. On wide screens the board is untouched
 * (no inline marginRight, full column count); on narrow screens it gets an
 * inline marginRight trim and drops a grid column. computeBoardReflow is mocked
 * to drive each path since jsdom has no real layout geometry.
 *
 * Auto-pan: autoPanToBunk fires ONLY when the board actually reflowed
 * (reflow.didReflow) — never on a wide screen where the board didn't move.
 *
 * Both behaviors are tested at the logic-seam level (rendered state / spy
 * calls), not pixels.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { computeBoardReflow } from '../utils/bunkBoardLayout'
import * as autoPanModule from '../utils/bunkAutoPan'

// computeBoardReflow does real DOM measurement (getBoundingClientRect +
// window.innerWidth), which jsdom can't provide meaningfully. Mock it so each
// test can drive the wide-screen (no reflow) vs narrow-screen (reflow) path
// deterministically; keep the rest of the module real (getBunkGridClass etc.).
vi.mock('../utils/bunkBoardLayout', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/bunkBoardLayout')>()
  return { ...actual, computeBoardReflow: vi.fn() }
})
const mockComputeBoardReflow = vi.mocked(computeBoardReflow)

/** Wide screen: panel floats over the gutter — board untouched, no pan. */
const WIDE_NO_REFLOW = { marginRightPx: 0, dropColumn: false, didReflow: false }
/** Narrow screen: board trimmed + a column dropped → reflow + pan. */
const NARROW_REFLOW = { marginRightPx: 300, dropColumn: true, didReflow: true }

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
    // Default to the wide-screen path (no reflow) unless a test overrides it.
    mockComputeBoardReflow.mockReturnValue(WIDE_NO_REFLOW)
  })

  it('board wrapper has no right-margin trim when no camper is selected', () => {
    const { container } = render(<BunkingBoardByArea {...makeBaseProps()} />)

    const wrapper = container.querySelector('[data-board-wrapper]') as HTMLElement | null
    expect(wrapper).not.toBeNull()
    // Closed: no inline marginRight applied.
    expect(wrapper?.style.marginRight ?? '').toBe('')
  })

  it('WIDE screen: selecting a camper does NOT trim the board or drop a column', () => {
    mockComputeBoardReflow.mockReturnValue(WIDE_NO_REFLOW)
    const props = makeBaseProps()
    const { container, getByTestId } = render(<BunkingBoardByArea {...props} />)

    fireEvent.click(getByTestId('camper-btn-100'))

    const wrapper = container.querySelector('[data-board-wrapper]') as HTMLElement | null
    const grid = container.querySelector('[data-bunk-grid]')
    // No trim (panel floats over the background gutter), full column count kept.
    expect(wrapper?.style.marginRight ?? '').toBe('')
    expect(grid?.className ?? '').toContain('xl:grid-cols-4')
  })

  it('NARROW screen: selecting a camper trims the board and drops a column', () => {
    mockComputeBoardReflow.mockReturnValue(NARROW_REFLOW)
    const props = makeBaseProps()
    const { container, getByTestId } = render(<BunkingBoardByArea {...props} />)

    fireEvent.click(getByTestId('camper-btn-100'))

    const wrapper = container.querySelector('[data-board-wrapper]') as HTMLElement | null
    const grid = container.querySelector('[data-bunk-grid]')
    // Trim equals the measured overlap (px), and the grid drops a column.
    expect(wrapper?.style.marginRight).toBe('300px')
    expect(grid?.className ?? '').toContain('xl:grid-cols-3')
    expect(grid?.className ?? '').not.toContain('xl:grid-cols-4')
  })

  it('board loses the trim + restores full columns when the panel closes', () => {
    mockComputeBoardReflow.mockReturnValue(NARROW_REFLOW)
    const props = makeBaseProps()
    const { container, getByTestId, queryByTestId } = render(<BunkingBoardByArea {...props} />)

    fireEvent.click(getByTestId('camper-btn-100'))
    const wrapper = container.querySelector('[data-board-wrapper]') as HTMLElement | null
    expect(wrapper?.style.marginRight).toBe('300px')

    // Close the panel — measureReflow resets to the no-reflow state regardless
    // of the mock (the early-return path fires when there's no selection).
    fireEvent.click(getByTestId('panel-close-btn'))

    expect(queryByTestId('camper-panel')).toBeNull()
    expect(wrapper?.style.marginRight ?? '').toBe('')
    const grid = container.querySelector('[data-bunk-grid]')
    expect(grid?.className ?? '').toContain('xl:grid-cols-4')
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

describe('BunkingBoardByArea — auto-pan (coupled to reflow)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockComputeBoardReflow.mockReturnValue(WIDE_NO_REFLOW)
  })

  it('calls autoPanToBunk when a camper is selected AND the board reflowed (narrow)', () => {
    mockComputeBoardReflow.mockReturnValue(NARROW_REFLOW)
    const autoPanSpy = vi.spyOn(autoPanModule, 'autoPanToBunk')

    const props = makeBaseProps()
    const { getByTestId } = render(<BunkingBoardByArea {...props} />)

    // Select Emma Johnson (person_cm_id=100, assigned_bunk_cm_id=9001)
    fireEvent.click(getByTestId('camper-btn-100'))

    // Board reflowed → pan to the selected camper's bunk so it stays visible.
    expect(autoPanSpy).toHaveBeenCalledWith(
      9001, // assigned_bunk_cm_id for Emma Johnson
      expect.anything() // scroll container (HTMLElement or null)
    )
  })

  it('does NOT call autoPanToBunk on a wide screen where the board did not reflow', () => {
    mockComputeBoardReflow.mockReturnValue(WIDE_NO_REFLOW)
    const autoPanSpy = vi.spyOn(autoPanModule, 'autoPanToBunk')

    const props = makeBaseProps()
    const { getByTestId } = render(<BunkingBoardByArea {...props} />)

    // Selecting a camper when the board doesn't move must not jump the scroll.
    fireEvent.click(getByTestId('camper-btn-100'))

    expect(autoPanSpy).not.toHaveBeenCalled()
  })

  it('does not call autoPanToBunk when no camper is selected (initial render)', () => {
    mockComputeBoardReflow.mockReturnValue(NARROW_REFLOW)
    const autoPanSpy = vi.spyOn(autoPanModule, 'autoPanToBunk')

    render(<BunkingBoardByArea {...makeBaseProps()} />)

    // autoPanToBunk must not fire on initial render when no selection exists
    // (it would scroll the board unexpectedly on mount)
    expect(autoPanSpy).not.toHaveBeenCalled()
  })

  it('passes null bunkCmId for an unassigned camper when reflowed (graceful no-op)', () => {
    mockComputeBoardReflow.mockReturnValue(NARROW_REFLOW)
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
