/**
 * Tests for FloatingUnassignedBadge prod-mode gating.
 *
 * The floating unassigned popover is the actual drop target in the live UI
 * (UnassignedCampers.tsx exists but isn't rendered in the bunking board).
 * In prod mode the droppable must be disabled and the inner CamperCards
 * must be non-draggable.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const useDroppableMock = vi.fn((_args: unknown) => ({ setNodeRef: () => {}, isOver: false }))
const useSortableMock = vi.fn((_args: unknown) => ({
  attributes: {},
  listeners: {},
  setNodeRef: () => {},
  transform: null,
  transition: undefined,
  isDragging: false,
}))

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
    useSortable: (args: unknown) => useSortableMock(args),
    SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  }
})

vi.mock('../hooks', () => ({
  useBunkRequestsFromContext: () => ({ data: {}, requestStatus: {} }),
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
      topPrioritySatisfied: false,
      priorityLevels: [],
    }),
  }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    getCamperLockState: () => 'none',
    getCamperLockGroupColor: () => undefined,
    isDraftMode: false,
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

import FloatingUnassignedBadge from './FloatingUnassignedBadge'
import type { Camper } from '../types/app-types'

const fakeCamper: Camper = {
  id: 'pb-1',
  person_cm_id: 1000001,
  name: 'Emma Johnson',
  first_name: 'Emma',
  last_name: 'Johnson',
  grade: 5,
  gender: 'F',
  assigned_bunk: '',
  assigned_bunk_cm_id: null,
} as unknown as Camper

describe('FloatingUnassignedBadge prod-mode gating', () => {
  beforeEach(() => {
    useDroppableMock.mockClear()
    useSortableMock.mockClear()
  })

  it('disables the unassigned droppable when isProductionMode=true', () => {
    render(
      <FloatingUnassignedBadge
        campers={[fakeCamper]}
        onCamperClick={() => {}}
        isExpanded={true}
        onToggle={() => {}}
        onClose={() => {}}
        isProductionMode={true}
      />
    )
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'unassigned', disabled: true })
    )
  })

  it('enables the droppable in scenario mode', () => {
    render(
      <FloatingUnassignedBadge
        campers={[fakeCamper]}
        onCamperClick={() => {}}
        isExpanded={true}
        onToggle={() => {}}
        onClose={() => {}}
        isProductionMode={false}
      />
    )
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'unassigned', disabled: false })
    )
  })

  it('renders camper cards as non-draggable in prod mode', () => {
    render(
      <FloatingUnassignedBadge
        campers={[fakeCamper]}
        onCamperClick={() => {}}
        isExpanded={true}
        onToggle={() => {}}
        onClose={() => {}}
        isProductionMode={true}
      />
    )
    expect(useSortableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pb-1', disabled: true })
    )
  })
})
