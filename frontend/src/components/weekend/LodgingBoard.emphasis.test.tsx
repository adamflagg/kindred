/**
 * The board arms the share-emphasis burst exactly once, and either drag kills
 * it.
 *
 * The hook's own rules are pinned in `hooks/useShareEmphasisBurst.test.tsx`
 * and the timeline's in `shareEmphasis.test.ts`; this file exists for the one
 * thing neither can see — that the board is actually WIRED to them, and that
 * a halo reaches the DOM through `FamilyCard` -> `ShareMarks`.
 *
 * "Either drag" is load-bearing and is why the drag cases below are two, not
 * one. The board holds `dragging` AND `draggingMergeUnit`, and
 * `handleDragStart` sets exactly one of them per gesture — so a suppression
 * that reads only the first is dead through every merge. A hook test cannot
 * catch that; it only ever sees the boolean the board already computed.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { mergeDragId } from './dragPlacement'
import { LodgingBoard } from './LodgingBoard'
import { partyKey } from './partyKey'
import {
  SHARE_MOTION_SELECTOR,
  defaultShareEmphasisRunner,
  type ShareEmphasisBurst,
} from './shareEmphasis'

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

vi.mock('../../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(), isMoving: false }),
}))

vi.mock('../../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({ setCombined: vi.fn(), pendingUnitId: null }),
}))

vi.mock('../../hooks/useUnitAvailability', () => ({
  useUnitAvailability: () => ({ setAvailability: vi.fn(), pendingUnitId: '' }),
}))

/**
 * The last `onDragStart` the board handed to DndContext.
 *
 * jsdom cannot perform a pointer drag — every element measures 0x0, so dnd-kit
 * has nothing to collide. The settled idiom in this repo (see
 * `LodgingBoard.drag.test.tsx`) is to mock at the boundary and deliver the
 * exact event dnd-kit would have, which exercises the board's real
 * `handleDragStart` and the real state it sets.
 */
let onDragStart: ((event: unknown) => void) | undefined

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragStart: startHandler,
    }: {
      children: ReactNode
      onDragStart: (e: unknown) => void
    }) => {
      onDragStart = startHandler
      return <div data-testid="dnd-context">{children}</div>
    },
  }
})

/** Stands in for the GSAP timeline — this file asserts on the WIRING, not the motion. */
function fakeBurst(): ShareEmphasisBurst {
  const burst = { targets: [] as HTMLElement[], active: true, kill: (): void => {} }
  burst.kill = (): void => {
    burst.active = false
  }
  return burst
}

let client: QueryClient
let run: ReturnType<typeof vi.spyOn>
/** Every burst the board armed this test, so a kill can be observed. */
let bursts: ShareEmphasisBurst[]

beforeEach(() => {
  vi.restoreAllMocks()
  onDragStart = undefined
  bursts = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  run = vi.spyOn(defaultShareEmphasisRunner, 'run').mockImplementation(() => {
    const burst = fakeBurst()
    bursts.push(burst)
    return burst
  })
})

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
    household_cm_id: 1000001,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Samuel Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: { preference: 'yes_share' },
    ...overrides,
  }
}

describe('LodgingBoard — the share-emphasis burst', () => {
  it('draws the halo on an open-to-sharing household', () => {
    const { container } = render(
      <LodgingBoard parties={[party()]} units={[unit()]} year={2026} />,
      {
        wrapper,
      }
    )
    expect(container.querySelectorAll(SHARE_MOTION_SELECTOR).length).toBeGreaterThan(0)
  })

  it('arms the burst once on arrival and never again on a refetch', () => {
    const { rerender } = render(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />, {
      wrapper,
    })
    expect(run).toHaveBeenCalledTimes(1)
    // A refetch hands the board a fresh array with the same content — the
    // failure this test exists for is a board that re-breathes on it.
    rerender(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />)
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('does not arm on an empty roster, so the first real payload still gets its burst', () => {
    const { rerender } = render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, {
      wrapper,
    })
    expect(run).not.toHaveBeenCalled()
    rerender(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />)
    expect(run).toHaveBeenCalledTimes(1)
  })
})

describe('LodgingBoard — a drag kills the burst, and there are TWO kinds of drag', () => {
  function armBoard(): ShareEmphasisBurst {
    render(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />, { wrapper })
    if (!onDragStart) throw new Error('the board never registered a drag-start handler')
    const burst = bursts[0]
    if (!burst) throw new Error('the board never armed a burst')
    expect(burst.active).toBe(true)
    return burst
  }

  it('suppresses on a party drag — the card gesture staff use most', () => {
    const burst = armBoard()
    act(() => {
      onDragStart?.({ active: { id: partyKey(party()) } })
    })
    expect(burst.active).toBe(false)
  })

  it('suppresses on a merge-handle drag, which never sets `dragging` at all', () => {
    // `handleDragStart` takes the merge branch with `setDraggingMergeUnit(...)`
    // and `setDragging(null)`, so `dragging` stays null for the WHOLE merge
    // gesture. Suppression keyed on `dragging` alone therefore reads "no drag
    // in flight" while the marks pulse over #2528's hatch/wash highlight —
    // exactly the precision task the suppression rule exists to protect.
    const burst = armBoard()
    act(() => {
      onDragStart?.({ active: { id: mergeDragId('cedar-1') } })
    })
    expect(burst.active).toBe(false)
  })
})
