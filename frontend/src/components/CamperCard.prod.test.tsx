/**
 * Tests for CamperCard prod-mode tooltip and parent-paramount icon matrix.
 *
 * In prod mode the card must render title="Switch to a scenario to edit" on
 * its root element. In scenario mode no such title is set.
 *
 * Stage 3a parent-paramount Shape A: the card renders a parent triangle when
 * parentMinOneViolation is true, and a separate amber staff dot when
 * staffUnsatisfiedAlert is true. Both can render simultaneously; staff dot is
 * independent of parent state (resolved Q #6 in the Stage 2 spec).
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RequestSlice, SatisfiedRequestInfo } from '../contexts/BunkRequestContext'

const EMPTY_SLICE: RequestSlice = { total: 0, satisfied: 0, satisfactionRate: 1 }

const emptySatisfiedInfo: SatisfiedRequestInfo = {
  materialParent: EMPTY_SLICE,
  bestEffortParent: EMPTY_SLICE,
  staff: EMPTY_SLICE,
  parentMinOneViolation: false,
  staffUnsatisfiedAlert: false,
  topPrioritySatisfied: false,
  priorityLevels: [],
}

let mockSatisfiedInfo: SatisfiedRequestInfo = { ...emptySatisfiedInfo }
function setSatisfiedInfo(overrides: Partial<SatisfiedRequestInfo>) {
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
  it('renders parent triangle when parentMinOneViolation is true', () => {
    setSatisfiedInfo({
      materialParent: { total: 1, satisfied: 0, satisfactionRate: 0 },
      parentMinOneViolation: true,
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

  it('renders staff dot when staffUnsatisfiedAlert is true and no parent violation', () => {
    setSatisfiedInfo({
      staff: { total: 1, satisfied: 0, satisfactionRate: 0 },
      staffUnsatisfiedAlert: true,
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

  it('renders BOTH icons when parentMinOneViolation and staffUnsatisfiedAlert are both true', () => {
    setSatisfiedInfo({
      materialParent: { total: 1, satisfied: 0, satisfactionRate: 0 },
      staff: { total: 1, satisfied: 0, satisfactionRate: 0 },
      parentMinOneViolation: true,
      staffUnsatisfiedAlert: true,
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
      materialParent: { total: 1, satisfied: 1, satisfactionRate: 1 },
      staff: { total: 1, satisfied: 0, satisfactionRate: 0 },
      parentMinOneViolation: false,
      staffUnsatisfiedAlert: true,
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

  it('renders no icons when both parentMinOneViolation and staffUnsatisfiedAlert are false', () => {
    setSatisfiedInfo({
      materialParent: { total: 1, satisfied: 1, satisfactionRate: 1 },
      staff: { total: 1, satisfied: 1, satisfactionRate: 1 },
      parentMinOneViolation: false,
      staffUnsatisfiedAlert: false,
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
