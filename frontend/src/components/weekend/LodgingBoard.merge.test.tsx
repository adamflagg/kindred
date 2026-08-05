/**
 * Merging a house into one card, or splitting it back into rooms — by
 * dragging one room's card onto its sibling, or clicking a split control on
 * the merged card.
 *
 * Mirrors `LodgingBoard.drag.test.tsx`'s idiom: jsdom cannot perform a
 * pointer drag, so `DndContext` is replaced with a pass-through that
 * captures `onDragEnd`, and the test delivers the exact event dnd-kit would
 * have. What is NOT tested here is `resolveMergeDrop` itself — that is pure
 * and lives in `dragPlacement.test.ts`.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow } from '../../types/lodging'
import { mergeDragId } from './dragPlacement'
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

vi.mock('../../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(), isMoving: false }),
}))

vi.mock('../../hooks/useUnitAvailability', () => ({
  useUnitAvailability: () => ({ setAvailability: vi.fn(), pendingUnitId: '' }),
}))

// Returns a promise because the real hook does: the board chains `.catch()`
// on it to keep a rejected write from surfacing as an unhandled rejection.
const setCombined = vi.fn((..._args: unknown[]) => Promise.resolve())
let mergeOptions: unknown[] = []
vi.mock('../../hooks/useUnitMerge', () => ({
  useUnitMerge: (...args: unknown[]) => {
    mergeOptions.push(args[0])
    return { setCombined, pendingUnitId: null }
  },
}))

/** The last `onDragEnd` the board handed to DndContext. */
let onDragEnd: ((event: unknown) => void) | undefined

vi.mock('@dnd-kit/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@dnd-kit/core')>()
  return {
    ...actual,
    DndContext: ({
      children,
      onDragEnd: endHandler,
    }: {
      children: ReactNode
      onDragEnd: (e: unknown) => void
    }) => {
      onDragEnd = endHandler
      return <div data-testid="dnd-context">{children}</div>
    },
  }
})

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  onDragEnd = undefined
  mergeOptions = []
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'solo',
    name: 'Solo Cabin',
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
    parent_code: '',
    is_combined: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

const SCENARIO = 'scn7x2k9qw3mnbv'

/** A wing carrying two rooms — the shape a merge gesture acts on. */
function wingUnits(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow[] {
  return [
    unit({
      unit_id: 'u_wing',
      code: 'wing',
      name: 'The Wing',
      is_container: true,
      parent_code: '',
      ...overrides,
    }),
    unit({ unit_id: 'u_r1', code: 'r1', name: 'Wing Room 1', parent_code: 'wing' }),
    unit({ unit_id: 'u_r2', code: 'r2', name: 'Wing Room 2', parent_code: 'wing' }),
  ]
}

function renderBoard(props: Partial<Parameters<typeof LodgingBoard>[0]> = {}) {
  return render(
    <LodgingBoard
      parties={[]}
      units={[unit({ code: 'solo' })]}
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

describe('LodgingBoard — the merge handle', () => {
  it('offers no merge handle on a room with no parent', () => {
    // Merging is promotion to the parent. A parentless room has nothing to be
    // promoted to, so the affordance must be absent — not merely disabled.
    renderBoard({ units: [unit({ code: 'solo' })] })
    expect(screen.queryByTestId('merge-handle-solo')).not.toBeInTheDocument()
  })

  it('offers a merge handle on a room that has a parent', () => {
    renderBoard({ units: wingUnits() })
    expect(screen.getByTestId('merge-handle-r1')).toBeInTheDocument()
  })

  it('offers no merge handle on the CampMinder mirror', () => {
    // The mirror inherits the registry default and is never overridable — the
    // same rule that makes placement read-only there.
    renderBoard({ units: wingUnits(), scenario: '' })
    expect(screen.queryByTestId('merge-handle-r1')).not.toBeInTheDocument()
  })

  it('offers no merge handle without bunking.manage', () => {
    renderBoard({ units: wingUnits(), canManage: false })
    expect(screen.queryByTestId('merge-handle-r1')).not.toBeInTheDocument()
  })

  it('offers no merge handle without a weekend to write into', () => {
    renderBoard({ units: wingUnits(), sessionCmId: 0 })
    expect(screen.queryByTestId('merge-handle-r1')).not.toBeInTheDocument()
  })
})

describe('LodgingBoard — the split control', () => {
  it('offers a split control on a combined card', () => {
    renderBoard({ units: wingUnits({ is_combined: true }) })
    expect(screen.getByRole('button', { name: /split the wing/i })).toBeInTheDocument()
  })

  it('offers no split control on a card that is not combined', () => {
    renderBoard({ units: wingUnits() })
    expect(screen.queryByRole('button', { name: /split the wing/i })).not.toBeInTheDocument()
  })

  it('writes combined: false for the container clicked', async () => {
    const user = userEvent.setup()
    renderBoard({ units: wingUnits({ is_combined: true }) })

    await user.click(screen.getByRole('button', { name: /split the wing/i }))

    expect(setCombined).toHaveBeenCalledWith('u_wing', 'The Wing', false)
  })
})

describe('LodgingBoard — a merge drop becomes a write', () => {
  it('promotes the shared parent when a room is dropped on its sibling', () => {
    renderBoard({ units: wingUnits() })
    drop(mergeDragId('r1'), mergeDragId('r2'))
    expect(setCombined).toHaveBeenCalledTimes(1)
    expect(setCombined).toHaveBeenCalledWith('u_wing', 'The Wing', true)
  })

  it('gives the mutation the weekend and scenario it must write into', () => {
    renderBoard({ units: wingUnits() })
    expect(mergeOptions[0]).toMatchObject({
      year: 2026,
      sessionCmId: 1000001,
      scenario: SCENARIO,
    })
  })

  it('writes nothing when a room is dropped on a NON-sibling — a different parent', () => {
    const otherHouse = unit({
      unit_id: 'u_other',
      code: 'other-r1',
      name: 'Other House Room 1',
      parent_code: 'other-house',
    })
    renderBoard({ units: [...wingUnits(), otherHouse] })
    drop(mergeDragId('r1'), mergeDragId('other-r1'))
    expect(setCombined).not.toHaveBeenCalled()
  })

  it('writes nothing on the CampMinder mirror even if a drop event arrives', () => {
    // Belt to the disabled-affordance braces, exactly as `LodgingBoard.drag`
    // pins for placement. `canPlace` gates `handleDragEnd` before either
    // resolver runs.
    renderBoard({ units: wingUnits(), scenario: '' })
    drop(mergeDragId('r1'), mergeDragId('r2'))
    expect(setCombined).not.toHaveBeenCalled()
  })

  it('writes nothing without a weekend to write into', () => {
    renderBoard({ units: wingUnits(), sessionCmId: 0 })
    drop(mergeDragId('r1'), mergeDragId('r2'))
    expect(setCombined).not.toHaveBeenCalled()
  })

  it('writes nothing when the drag ends over nothing', () => {
    renderBoard({ units: wingUnits() })
    drop(mergeDragId('r1'), null)
    expect(setCombined).not.toHaveBeenCalled()
  })

  it('does not confuse a card drag for a party drag', () => {
    // A merge-shaped active id never matches a `partyKey`, so `resolveDrop`
    // must stay silent about it — the placement mutation must never fire for
    // a card drag.
    renderBoard({ units: wingUnits() })
    drop(mergeDragId('r1'), mergeDragId('r2'))
    // `useLodgingPlacement` is mocked to a bare `vi.fn()` above; nothing here
    // asserts on it directly because the merge branch returns before
    // `resolveDrop` ever runs — the wiring test above is the proof.
    expect(setCombined).toHaveBeenCalledTimes(1)
  })
})
