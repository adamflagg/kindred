/**
 * Tests for BunkCard droppable gating in prod mode.
 *
 * The bunk-level useDroppable must be disabled when isProductionMode=true so
 * dragged campers cannot drop onto a bunk in prod.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const useDroppableMock = vi.fn((_args: unknown) => ({ setNodeRef: () => {}, isOver: false }))

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    useDroppable: (args: unknown) => useDroppableMock(args),
  }
})

vi.mock('@dnd-kit/sortable', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/sortable')>('@dnd-kit/sortable')
  return {
    ...actual,
    useSortable: () => ({
      attributes: {},
      listeners: {},
      setNodeRef: () => {},
      transform: null,
      transition: undefined,
      isDragging: false,
    }),
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    getCamperLockState: () => 'none',
    getCamperLockGroupColor: () => undefined,
    isDraftMode: false,
  }),
}))

vi.mock('../hooks', () => ({
  useBunkRequestContext: () => ({
    getSatisfiedRequestInfo: (personCmId: number) => ({
      person_cm_id: personCmId,
      per_request: [],
      counted_totals: {
        material_parent: { satisfied: 0, total: 0 },
        staff: { satisfied: 0, total: 0 },
      },
      immaterial: { satisfied: 0, total: 0 },
      flags: {
        parent_min_one_violation: false,
        staff_unsatisfied_alert: false,
        has_any_counted_request: false,
      },
    }),
  }),
  useBunkRequestsFromContext: () => ({ data: {}, requestStatus: {} }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

import { useBunkRequestContext } from '../hooks'

import BunkCard from './BunkCard'

const fakeBunk = {
  id: 'bunk-pb-1',
  cm_id: 9001,
  name: 'B-Eagle',
  capacity: 12,
  gender: 'M',
  campers: [],
  occupancy: 0,
  utilization: 0,
}

describe('mock contract — getSatisfiedRequestInfo CamperSatisfaction', () => {
  it('returns counted_totals / immaterial / flags shape', () => {
    const ctx = useBunkRequestContext()
    const info = ctx.getSatisfiedRequestInfo(1)
    expect(info.counted_totals.material_parent).toEqual({ satisfied: 0, total: 0 })
    expect(info.counted_totals.staff).toEqual({ satisfied: 0, total: 0 })
    expect(info.immaterial).toEqual({ satisfied: 0, total: 0 })
    expect(info.flags).toEqual({
      parent_min_one_violation: false,
      staff_unsatisfied_alert: false,
      has_any_counted_request: false,
    })
  })
})

describe('BunkCard droppable prod gating', () => {
  beforeEach(() => useDroppableMock.mockClear())

  it('disables droppable in prod mode', () => {
    render(
      <BunkCard
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bunk={fakeBunk as any}
        isDragging={false}
        isProductionMode={true}
        defaultCapacity={12}
        activeDragCamper={null}
      />
    )
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bunk-bunk-pb-1', disabled: true })
    )
  })

  it('enables droppable in scenario mode', () => {
    render(
      <BunkCard
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        bunk={fakeBunk as any}
        isDragging={false}
        isProductionMode={false}
        defaultCapacity={12}
        activeDragCamper={null}
      />
    )
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'bunk-bunk-pb-1', disabled: false })
    )
  })
})
