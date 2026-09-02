/**
 * Tests for UnassignedCampers prod-mode gating.
 *
 * In prod mode (no scenario), the unassigned area must:
 * - Disable its droppable target so drags can't land there.
 * - Render its CamperCards as non-draggable.
 *
 * In scenario mode, both must work as before.
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
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    addPendingCamper: () => {},
    removePendingCamper: () => {},
    getPendingAnimationDelay: () => 0,
    groups: [],
    addCamperToGroup: () => {},
    getCamperLockGroup: () => null,
    getGroupMembers: () => [],
    isDraftMode: false,
  }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

import UnassignedCampers from './UnassignedCampers'
import type { Camper } from '../types/app-types'

const fakeCamper: Camper = {
  id: 'pb-1',
  person_cm_id: 1000001,
  name: 'Emma Johnson',
  grade: 5,
  gender: 'F',
  assigned_bunk: '',
  assigned_bunk_cm_id: null,
} as unknown as Camper

describe('UnassignedCampers prod-mode gating', () => {
  beforeEach(() => {
    useDroppableMock.mockClear()
    useSortableMock.mockClear()
  })

  it('disables the droppable target when isProductionMode is true', () => {
    render(<UnassignedCampers campers={[fakeCamper]} isProductionMode={true} />)
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'unassigned', disabled: true })
    )
  })

  it('enables the droppable target when isProductionMode is false', () => {
    render(<UnassignedCampers campers={[fakeCamper]} isProductionMode={false} />)
    expect(useDroppableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'unassigned', disabled: false })
    )
  })

  it('renders camper cards as non-draggable in prod mode', () => {
    render(<UnassignedCampers campers={[fakeCamper]} isProductionMode={true} />)
    expect(useSortableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pb-1', disabled: true })
    )
  })

  it('renders camper cards as draggable in scenario mode', () => {
    render(<UnassignedCampers campers={[fakeCamper]} isProductionMode={false} />)
    expect(useSortableMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'pb-1', disabled: false })
    )
  })
})
