/**
 * Tests for CamperCard prod-mode tooltip and parent-paramount icon matrix.
 *
 * In prod mode the card must render title="Switch to a scenario to edit" on
 * its root element. In scenario mode no such title is set.
 *
 * Stage 2 parent-paramount: the card renders a parent triangle when parent
 * requests are unsatisfied, and a separate amber staff dot when staff requests
 * are unsatisfied. Both can render simultaneously; staff dot is independent
 * of parent state (resolved Q #6 in the Stage 2 spec).
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

interface MockSatisfiedInfo {
  totalRequests: number
  satisfiedCount: number
  topPrioritySatisfied: boolean
  priorityLevels: number[]
  hasLockedPriority: boolean
  parentTotal: number
  parentSatisfied: number
  staffTotal: number
  staffSatisfied: number
}

const emptySatisfiedInfo: MockSatisfiedInfo = {
  totalRequests: 0,
  satisfiedCount: 0,
  topPrioritySatisfied: false,
  priorityLevels: [],
  hasLockedPriority: false,
  parentTotal: 0,
  parentSatisfied: 0,
  staffTotal: 0,
  staffSatisfied: 0,
}

let mockSatisfiedInfo: MockSatisfiedInfo = { ...emptySatisfiedInfo }
function setSatisfiedInfo(overrides: Partial<MockSatisfiedInfo>) {
  mockSatisfiedInfo = { ...emptySatisfiedInfo, ...overrides }
}

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
  }
})

vi.mock('../contexts/LockGroupContext', () => ({
  useLockGroupContext: () => ({
    addPendingCamper: () => {},
    removePendingCamper: () => {},
    getPendingAnimationDelay: () => 0,
    groups: [],
    addCamperToGroup: () => {},
    getCamperLockGroup: () => null,
    getGroupMembers: () => [],
  }),
}))

vi.mock('../hooks', () => ({
  useBunkRequestContext: () => ({
    getSatisfiedRequestInfo: () => mockSatisfiedInfo,
  }),
  useCamperHistoryContext: () => ({ getLastYearHistory: () => null }),
}))

vi.mock('../hooks/useCurrentYear', () => ({ useYear: () => 2026 }))

import CamperCard from './CamperCard'
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

beforeEach(() => {
  setSatisfiedInfo({})
})

describe('CamperCard prod tooltip', () => {
  it('shows the scenario tooltip when isProductionMode=true', () => {
    const { container } = render(
      <CamperCard camper={fakeCamper} isDraggable={false} isProductionMode={true} />
    )
    const root = container.querySelector('[data-camper-card]')
    expect(root?.getAttribute('title')).toBe('Switch to a scenario to edit')
  })

  it('does not set a tooltip in scenario mode', () => {
    const { container } = render(
      <CamperCard camper={fakeCamper} isDraggable={true} isProductionMode={false} />
    )
    const root = container.querySelector('[data-camper-card]')
    expect(root?.getAttribute('title')).toBeNull()
  })
})

const assignedCamper: Camper = {
  ...fakeCamper,
  assigned_bunk_cm_id: 100,
} as unknown as Camper

describe('CamperCard parent-paramount icons', () => {
  it('renders parent triangle when parentTotal > 0 and parentSatisfied === 0', () => {
    setSatisfiedInfo({
      totalRequests: 1,
      satisfiedCount: 0,
      parentTotal: 1,
      parentSatisfied: 0,
    })
    const { container } = render(
      <CamperCard
        camper={assignedCamper}
        isDraggable={true}
        isProductionMode={false}
        bunkCampers={[{ cmId: 1000001, grade: 5 }]}
      />
    )
    expect(container.querySelector('[title*="parent request"]')).not.toBeNull()
    expect(container.querySelector('[title*="staff request"]')).toBeNull()
  })

  it('renders staff dot when staffTotal > 0 / staffSatisfied === 0 / parentTotal === 0', () => {
    setSatisfiedInfo({
      totalRequests: 1,
      satisfiedCount: 0,
      staffTotal: 1,
      staffSatisfied: 0,
    })
    const { container } = render(
      <CamperCard
        camper={assignedCamper}
        isDraggable={true}
        isProductionMode={false}
        bunkCampers={[{ cmId: 1000001, grade: 5 }]}
      />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
    expect(container.querySelector('[title*="staff request"]')).not.toBeNull()
  })

  it('renders BOTH icons when parent and staff are both unsatisfied', () => {
    setSatisfiedInfo({
      totalRequests: 2,
      satisfiedCount: 0,
      parentTotal: 1,
      parentSatisfied: 0,
      staffTotal: 1,
      staffSatisfied: 0,
    })
    const { container } = render(
      <CamperCard
        camper={assignedCamper}
        isDraggable={true}
        isProductionMode={false}
        bunkCampers={[{ cmId: 1000001, grade: 5 }]}
      />
    )
    expect(container.querySelector('[title*="parent request"]')).not.toBeNull()
    expect(container.querySelector('[title*="staff request"]')).not.toBeNull()
  })

  it('renders staff dot when staff unsat even if parent is satisfied (resolved Q #6)', () => {
    setSatisfiedInfo({
      totalRequests: 2,
      satisfiedCount: 1,
      parentTotal: 1,
      parentSatisfied: 1,
      staffTotal: 1,
      staffSatisfied: 0,
    })
    const { container } = render(
      <CamperCard
        camper={assignedCamper}
        isDraggable={true}
        isProductionMode={false}
        bunkCampers={[{ cmId: 1000001, grade: 5 }]}
      />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
    expect(container.querySelector('[title*="staff request"]')).not.toBeNull()
  })

  it('renders no icons when both parent and staff are fully satisfied', () => {
    setSatisfiedInfo({
      totalRequests: 2,
      satisfiedCount: 2,
      parentTotal: 1,
      parentSatisfied: 1,
      staffTotal: 1,
      staffSatisfied: 1,
    })
    const { container } = render(
      <CamperCard
        camper={assignedCamper}
        isDraggable={true}
        isProductionMode={false}
        bunkCampers={[{ cmId: 1000001, grade: 5 }]}
      />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
    expect(container.querySelector('[title*="staff request"]')).toBeNull()
  })
})
