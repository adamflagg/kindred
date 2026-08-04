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
import { render } from '@testing-library/react'
import type { ReactNode } from 'react'
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

/** The last `onDragEnd` the board handed to DndContext. */
let onDragEnd: ((event: unknown) => void) | undefined

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd: handler,
    }: {
      children: ReactNode
      onDragEnd: (e: unknown) => void
    }) => {
      onDragEnd = handler
      return <div data-testid="dnd-context">{children}</div>
    },
  }
})

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  onDragEnd = undefined
  placementOptions = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
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
    allocation_default: 'family_pool',
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
