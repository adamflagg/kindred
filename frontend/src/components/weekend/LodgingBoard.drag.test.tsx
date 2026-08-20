/**
 * Drag placement on the board: the gate, and the wiring from a drop to a write.
 *
 * jsdom cannot perform a pointer drag — every element measures 0×0, so
 * dnd-kit's collision detection has nothing to collide. The settled idiom in
 * this repo is to mock at the boundary: `DndContext` is replaced with a
 * pass-through that captures `onDragEnd`, so the test can deliver the exact
 * event dnd-kit would have and assert on what the board did with it. That
 * exercises the real `resolveDrop` and the real call into the mutation.
 *
 * What is NOT tested here is the resolution itself — which drops are no-ops,
 * which are refused. Those are pure and live in `dragPlacement.test.ts`.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { UNPLACED_DROPPABLE_ID, unitDroppableId } from './dragPlacement'
import { LodgingBoard } from './LodgingBoard'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

// Returns a promise because the real hook does: the board chains `.catch()`
// on it to keep a rejected write from surfacing as an unhandled rejection.
const move = vi.fn((_intent: unknown) => Promise.resolve())
vi.mock('../../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: (...args: unknown[]) => {
    placementOptions.push(args[0])
    return { move, isMoving: false }
  },
}))
let placementOptions: unknown[] = []

// The board also writes availability now. Mocked here only to keep the real
// hook's `useApiWithAuth` out of a tree with no AuthProvider — this file is
// about drag, and the availability gate is pinned in
// `LodgingBoard.availability.test.tsx`.
vi.mock('../../hooks/useUnitAvailability', () => ({
  useUnitAvailability: () => ({ setAvailability: vi.fn(), pendingUnitId: '' }),
}))

// Same reason: the board now also writes merges. The merge gesture and its
// own gate are pinned in `LodgingBoard.merge.test.tsx`.
vi.mock('../../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({ setCombined: vi.fn(), pendingUnitId: null }),
}))

/** The last `onDragEnd` the board handed to DndContext. */
let onDragEnd: ((event: unknown) => void) | undefined
/** Its `onDragStart` sibling — the half the needs-misfit hatch (#1912) rides on. */
let onDragStart: ((event: unknown) => void) | undefined

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd: handler,
      onDragStart: startHandler,
    }: {
      children: ReactNode
      onDragEnd: (e: unknown) => void
      onDragStart: (e: unknown) => void
    }) => {
      onDragEnd = handler
      onDragStart = startHandler
      return <div data-testid="dnd-context">{children}</div>
    },
  }
})

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  onDragEnd = undefined
  onDragStart = undefined
  placementOptions = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

// The board reads its collapsed areas from the query string, so it needs a
// router. `MemoryRouter` rather than a real one, so no `?closed=` written by
// one test can leak into the next.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/weekend/fc1/housing']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

const SCENARIO = 'scn7x2k9qw3mnbv'

function renderBoard(props: Partial<Parameters<typeof LodgingBoard>[0]> = {}) {
  return render(
    <LodgingBoard
      parties={[party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })]}
      units={[unit(), unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })]}
      year={2026}
      sessionCmId={1000001}
      scenario={SCENARIO}
      canManage={true}
      {...props}
    />,
    { wrapper }
  )
}

function startDrag(activeId: string) {
  if (!onDragStart) throw new Error('the board never registered a drag-start handler')
  const start = onDragStart
  act(() => {
    start({ active: { id: activeId } })
  })
}

function drop(activeId: string, overId: string | null) {
  if (!onDragEnd) throw new Error('the board never registered a drag handler')
  onDragEnd({ active: { id: activeId }, over: overId === null ? null : { id: overId } })
}

describe('LodgingBoard — the write gate', () => {
  it('makes cards draggable in a scenario', () => {
    // `aria-roledescription="draggable"` is what dnd-kit actually puts on the
    // node, and it is the honest thing to assert. Two nearby forms do NOT
    // work: `[draggable="true"]` is the HTML5 attribute dnd-kit never uses (so
    // the older mirror test would pass just as happily with drag fully wired),
    // and testing-library's `description` option reads `aria-describedby`,
    // which is a different attribute pointing at DndContext's announcement
    // node.
    const { container } = renderBoard()
    expect(container.querySelectorAll('[aria-roledescription="draggable"]').length).toBeGreaterThan(
      0
    )
  })

  it('offers nothing draggable on the CampMinder mirror', () => {
    // No scenario is summer's production mode: read-only for everyone.
    const { container } = renderBoard({ scenario: '' })
    expect(container.querySelector('[aria-roledescription="draggable"]')).toBeNull()
  })

  it('offers nothing draggable without bunking.manage', () => {
    const { container } = renderBoard({ canManage: false })
    expect(container.querySelector('[aria-roledescription="draggable"]')).toBeNull()
  })

  it('offers nothing draggable without a weekend to write into', () => {
    // `session_cm_id` is `gt=0` server-side, so a board that let a drop
    // through without one would send a guaranteed 422.
    const { container } = renderBoard({ sessionCmId: 0 })
    expect(container.querySelector('[aria-roledescription="draggable"]')).toBeNull()
  })
})

describe('LodgingBoard — a drop becomes a write', () => {
  it('places a party dropped on another unit', () => {
    renderBoard()
    drop('household-101', unitDroppableId('cedar-2'))
    expect(move).toHaveBeenCalledTimes(1)
    expect(move.mock.calls[0]?.[0]).toMatchObject({ kind: 'place', unitId: 'u2' })
  })

  it('unplaces a party dropped on the queue', () => {
    // The drop target is the floating badge, NOT the 240px rail — that rail is
    // gone. And the write is a DELETE: kindred#1974 retired the tombstone POST.
    renderBoard()
    drop('household-101', UNPLACED_DROPPABLE_ID)
    expect(move.mock.calls[0]?.[0]).toMatchObject({ kind: 'unplace' })
  })

  it('writes nothing when the drag ends over nothing', () => {
    renderBoard()
    drop('household-101', null)
    expect(move).not.toHaveBeenCalled()
  })

  it('writes nothing when a party is dropped back where it started', () => {
    renderBoard()
    drop('household-101', unitDroppableId('cedar-1'))
    expect(move).not.toHaveBeenCalled()
  })

  it('writes nothing on the mirror even if a drop event arrives', () => {
    // Belt to the disabled-droppable braces. A drop that reached the handler
    // here would be the one path around the read-only gate.
    renderBoard({ scenario: '' })
    drop('household-101', unitDroppableId('cedar-2'))
    expect(move).not.toHaveBeenCalled()
  })

  it('gives the mutation the weekend and scenario it must write into', () => {
    renderBoard()
    expect(placementOptions[0]).toMatchObject({
      year: 2026,
      sessionCmId: 1000001,
      scenario: SCENARIO,
    })
  })
})

describe('LodgingBoard — threading the dragged family for the needs hatch (#1912)', () => {
  /*
   * The card receives no drag state of its own, so the board is where the
   * party in flight reaches all ~82 of them. That plumbing IS the frontend
   * half of #1912; the mark itself is pinned in `LodgingUnitCard.test.tsx`.
   *
   * Advisory throughout: nothing here disables a droppable or dims a card.
   */
  const needsPower = party({
    household_cm_id: 101,
    flags: { needs_power: true },
  })
  const dark = unit({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1', power_coverage: 'none' })
  const lit = unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2', power_coverage: 'all' })

  function cards(container: HTMLElement) {
    return {
      dark: container.querySelector('[data-unit-code="cedar-1"]'),
      lit: container.querySelector('[data-unit-code="cedar-2"]'),
    }
  }

  it('marks nothing until a family is actually in flight', () => {
    const { container } = renderBoard({ parties: [needsPower], units: [dark, lit] })
    expect(cards(container).dark).not.toHaveAttribute('data-needs-fit')
  })

  it('marks the spaces that cannot meet the dragged family need', () => {
    const { container } = renderBoard({ parties: [needsPower], units: [dark, lit] })
    startDrag('household-101')
    expect(cards(container).dark).toHaveAttribute('data-needs-fit', 'unmet')
    expect(cards(container).lit).not.toHaveAttribute('data-needs-fit')
  })

  it("leaves the drop accepted — this is advisory, not #2087's block", () => {
    const { container } = renderBoard({ parties: [needsPower], units: [dark, lit] })
    startDrag('household-101')
    expect(cards(container).dark).not.toHaveClass('opacity-40')
    expect(cards(container).dark).not.toHaveClass('pointer-events-none')
    drop('household-101', unitDroppableId('cedar-1'))
    expect(move).toHaveBeenCalledTimes(1)
  })

  it('raises no hatch for a MERGE drag, which carries no family at all', () => {
    // `handleDragStart` clears `dragging` the moment it recognises a card
    // drag, so the misfit hatch and the invalid-merge dim can never be raised
    // by one gesture — which is why the card needs no gate between them.
    const { container } = renderBoard({
      parties: [needsPower],
      units: [
        { ...dark, parent_code: 'east-wing' },
        { ...lit, parent_code: 'east-wing' },
      ],
    })
    startDrag('merge:cedar-2')
    expect(cards(container).dark).not.toHaveAttribute('data-needs-fit')
  })
})

describe('LodgingBoard — placing a family from the space itself (kindred#2080)', () => {
  /*
   * The board's half of the second placement path. What is pinned here is the
   * WIRING — that the picker's choice reaches the same mutation a drop does,
   * carrying the intent `resolveDrop` would have produced. Which placements
   * are refused is pure and lives in `dragPlacement.test.ts`.
   */
  const GARCIA = party({
    household_cm_id: 202,
    display_name: 'Garcia',
    sort_name: 'Garcia',
    adults: [{ adult_number: 1, display_name: 'Liam Garcia', relationship: 'Father' }],
  })

  function boardWithUnplaced(props: Partial<Parameters<typeof LodgingBoard>[0]> = {}) {
    return renderBoard({
      parties: [
        party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] }),
        GARCIA,
      ],
      ...props,
    })
  }

  // The Assign pill, which OPENS the modal — kindred#2072's AS2 replaced the
  // inline combobox this used to reach for. The gate each test below asks
  // about is unchanged; the control it asks through is not.
  function pickerFor(name: string) {
    return screen.getByRole('button', { name: new RegExp(`assign to ${name}`, 'i') })
  }

  it('mounts the control on every placeable space, occupied or not', () => {
    boardWithUnplaced()
    expect(pickerFor('Cedar 2')).toBeInTheDocument()
    // Cedar 1 already holds a family and STILL offers the box. It did not
    // before 2026-08-18, on the rule that hid the strip's write-in on an
    // occupied card — a rule this change deletes, because the box is now the
    // only way to write somebody in and a partly-filled merged building was
    // left with no path at all.
    expect(pickerFor('Cedar 1')).toBeInTheDocument()
  })

  it('offers nothing without a scenario', () => {
    boardWithUnplaced({ scenario: '' })
    expect(screen.queryByRole('button', { name: /assign to/i })).not.toBeInTheDocument()
  })

  it('offers nothing without the permission to place', () => {
    boardWithUnplaced({ canManage: false })
    expect(screen.queryByRole('button', { name: /assign to/i })).not.toBeInTheDocument()
  })

  it('lists the UNPLACED parties, never one already in a cabin', async () => {
    const user = userEvent.setup()
    boardWithUnplaced()
    await user.click(pickerFor('Cedar 2'))
    const options = screen.getAllByRole('option')
    expect(options).toHaveLength(1)
    expect(options[0]).toHaveTextContent('Liam Garcia')
  })

  it('writes the same intent the equivalent drop would', async () => {
    const user = userEvent.setup()
    boardWithUnplaced()
    await user.click(pickerFor('Cedar 2'))
    await user.click(screen.getByRole('option', { name: /Liam Garcia/ }))
    expect(move).toHaveBeenCalledTimes(1)
    expect(move.mock.calls[0]?.[0]).toEqual({
      kind: 'place',
      party: GARCIA,
      unitId: 'u2',
      unitCode: 'cedar-2',
      unitName: 'Cedar 2',
    })
  })
})
