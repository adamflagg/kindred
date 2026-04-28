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
    getSatisfiedRequestInfo: () => ({
      totalRequests: 0,
      satisfiedCount: 0,
      topPrioritySatisfied: false,
      priorityLevels: [],
      hasLockedPriority: false,
    }),
  }),
  useBunkRequestsFromContext: () => ({ data: {}, requestStatus: {} }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

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
