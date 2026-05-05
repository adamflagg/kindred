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
    // Stage 3a Shape A — three-slice split. The pre-3a flat shape
    // (totalRequests/parentTotal/staffTotal) silently leaves consumers
    // reading materialParent.total / staff.total etc. as undefined.
    getSatisfiedRequestInfo: () => ({
      materialParent: { total: 0, satisfied: 0, satisfactionRate: 0 },
      bestEffortParent: { total: 0, satisfied: 0, satisfactionRate: 0 },
      staff: { total: 0, satisfied: 0, satisfactionRate: 0 },
      parentMinOneViolation: false,
      staffUnsatisfiedAlert: false,
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

// Stage 3a Shape A migration — the mocked getSatisfiedRequestInfo must
// return the new three-slice shape (materialParent / bestEffortParent /
// staff), not the pre-Stage-3a flat shape (totalRequests, parentTotal,
// staffTotal). Audit 2026-04-29 found three test files still returning
// the legacy shape; consumers reading the new shape silently got
// undefined.
describe('mock contract — getSatisfiedRequestInfo Shape A', () => {
  it('returns materialParent / bestEffortParent / staff slices', () => {
    const ctx = useBunkRequestContext()
    const info = ctx.getSatisfiedRequestInfo(1, 2, [], null)
    expect(info.materialParent).toEqual({ total: 0, satisfied: 0, satisfactionRate: 0 })
    expect(info.bestEffortParent).toEqual({ total: 0, satisfied: 0, satisfactionRate: 0 })
    expect(info.staff).toEqual({ total: 0, satisfied: 0, satisfactionRate: 0 })
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
