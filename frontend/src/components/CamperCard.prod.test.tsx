/**
 * Tests for CamperCard prod-mode tooltip.
 *
 * In prod mode the card must render title="Switch to a scenario to edit" on
 * its root element. In scenario mode no such title is set.
 */
import { render } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

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
    getSatisfiedRequestInfo: () => ({
      totalRequests: 0,
      satisfiedCount: 0,
      topPrioritySatisfied: false,
      priorityLevels: [],
      hasLockedPriority: false,
    }),
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
