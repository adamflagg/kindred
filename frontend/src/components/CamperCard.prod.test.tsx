/**
 * Tests for CamperCard prod-mode tooltip and parent-paramount icon matrix.
 *
 * In prod mode the card must render title="Switch to a scenario to edit" on
 * its root element. In scenario mode no such title is set.
 *
 * The card renders a parent triangle when flags.parent_min_one_violation is
 * true, and a separate amber staff dot when flags.staff_unsatisfied_alert is
 * true. Both can render simultaneously; staff dot is independent of parent
 * state.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CamperSatisfaction } from '../types/satisfaction'

const EMPTY_COUNT = { satisfied: 0, total: 0 }

const emptySatisfiedInfo: CamperSatisfaction = {
  person_cm_id: 1000001,
  per_request: [],
  counted_totals: {
    material_parent: EMPTY_COUNT,
    staff: EMPTY_COUNT,
  },
  immaterial: EMPTY_COUNT,
  flags: {
    parent_min_one_violation: false,
    staff_unsatisfied_alert: false,
    has_any_counted_request: false,
  },
}

let mockSatisfiedInfo: CamperSatisfaction = { ...emptySatisfiedInfo }
function setSatisfiedInfo(overrides: Partial<CamperSatisfaction>) {
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
}

describe('CamperCard parent-paramount icons', () => {
  it('renders parent triangle when parent_min_one_violation is true', () => {
    setSatisfiedInfo({
      counted_totals: { material_parent: { total: 1, satisfied: 0 }, staff: EMPTY_COUNT },
      flags: {
        parent_min_one_violation: true,
        staff_unsatisfied_alert: false,
        has_any_counted_request: true,
      },
    })
    const { container } = render(
      <CamperCard camper={assignedCamper} isDraggable={true} isProductionMode={false} />
    )
    expect(container.querySelector('[title*="parent request"]')).not.toBeNull()
    expect(container.querySelector('[title*="staff request"]')).toBeNull()
  })

  it('renders staff dot when staff_unsatisfied_alert is true and no parent violation', () => {
    setSatisfiedInfo({
      counted_totals: { material_parent: EMPTY_COUNT, staff: { total: 1, satisfied: 0 } },
      flags: {
        parent_min_one_violation: false,
        staff_unsatisfied_alert: true,
        has_any_counted_request: true,
      },
    })
    const { container } = render(
      <CamperCard camper={assignedCamper} isDraggable={true} isProductionMode={false} />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
    expect(container.querySelector('[title*="staff request"]')).not.toBeNull()
  })

  it('renders BOTH icons when parent_min_one_violation and staff_unsatisfied_alert are both true', () => {
    setSatisfiedInfo({
      counted_totals: {
        material_parent: { total: 1, satisfied: 0 },
        staff: { total: 1, satisfied: 0 },
      },
      flags: {
        parent_min_one_violation: true,
        staff_unsatisfied_alert: true,
        has_any_counted_request: true,
      },
    })
    const { container } = render(
      <CamperCard camper={assignedCamper} isDraggable={true} isProductionMode={false} />
    )
    expect(container.querySelector('[title*="parent request"]')).not.toBeNull()
    expect(container.querySelector('[title*="staff request"]')).not.toBeNull()
  })

  it('renders staff dot when staff unsat even if parent is satisfied', () => {
    setSatisfiedInfo({
      counted_totals: {
        material_parent: { total: 1, satisfied: 1 },
        staff: { total: 1, satisfied: 0 },
      },
      flags: {
        parent_min_one_violation: false,
        staff_unsatisfied_alert: true,
        has_any_counted_request: true,
      },
    })
    const { container } = render(
      <CamperCard camper={assignedCamper} isDraggable={true} isProductionMode={false} />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
    expect(container.querySelector('[title*="staff request"]')).not.toBeNull()
  })

  it('renders no icons when both flags are false', () => {
    setSatisfiedInfo({
      counted_totals: {
        material_parent: { total: 1, satisfied: 1 },
        staff: { total: 1, satisfied: 1 },
      },
      flags: {
        parent_min_one_violation: false,
        staff_unsatisfied_alert: false,
        has_any_counted_request: true,
      },
    })
    const { container } = render(
      <CamperCard camper={assignedCamper} isDraggable={true} isProductionMode={false} />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
    expect(container.querySelector('[title*="staff request"]')).toBeNull()
  })
})

describe('CamperCard satisfaction suppression', () => {
  beforeEach(() => {
    setSatisfiedInfo({
      counted_totals: { material_parent: { total: 1, satisfied: 0 }, staff: EMPTY_COUNT },
      flags: {
        parent_min_one_violation: true,
        staff_unsatisfied_alert: false,
        has_any_counted_request: true,
      },
    })
  })

  it('hides parent triangle when camper is unassigned', () => {
    // fakeCamper has assigned_bunk_cm_id: null
    const { container } = render(
      <CamperCard camper={fakeCamper} isDraggable={true} isProductionMode={false} />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
  })

  it('hides parent triangle while dragging', () => {
    const { container } = render(
      <CamperCard
        camper={assignedCamper}
        isDraggable={true}
        isDragging={true}
        isProductionMode={false}
      />
    )
    expect(container.querySelector('[title*="parent request"]')).toBeNull()
  })

  it('shows parent triangle for assigned non-dragging camper with violation', () => {
    const { container } = render(
      <CamperCard
        camper={assignedCamper}
        isDraggable={true}
        isDragging={false}
        isProductionMode={false}
      />
    )
    expect(container.querySelector('[title*="parent request"]')).not.toBeNull()
  })
})
