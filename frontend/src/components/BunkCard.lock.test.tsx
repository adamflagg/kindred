/**
 * Tests for BunkCard cabin-level lock/unlock toggle.
 *
 * Verifies:
 *  1. When onToggleLock is provided, a Lock toggle button renders (unlocked state).
 *  2. Clicking the button calls onToggleLock.
 *  3. When isLocked=true, aria-pressed is true and label says "Unlock cabin".
 *  4. When onToggleLock is NOT provided, no lock button renders.
 */
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import type { BunkWithCampers } from '../types/app-types'

// --- Module mocks (mirrors BunkCard.dnd.test.tsx pattern) ---

vi.mock('@dnd-kit/core', async () => {
  const actual = await vi.importActual<typeof import('@dnd-kit/core')>('@dnd-kit/core')
  return {
    ...actual,
    useDroppable: (_args: unknown) => ({ setNodeRef: () => {}, isOver: false }),
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

import BunkCard from './BunkCard'

// Minimal BunkWithCampers fixture — fictional bunk B-1, cm_id 2001
const fakeBunk = {
  id: 'bunk-pb-2001',
  cm_id: 2001,
  name: 'B-1',
  gender: 'M',
  area_id: 0,
  is_active: true,
  sort_order: 0,
  year: 2025,
  campers: [],
  occupancy: 0,
  utilization: 0,
  collectionId: 'bunks',
  collectionName: 'bunks',
  created: '2025-01-01T00:00:00Z',
  updated: '2025-01-01T00:00:00Z',
} as unknown as BunkWithCampers

describe('BunkCard cabin lock toggle', () => {
  it('renders a "Lock cabin" button when onToggleLock is provided (unlocked state)', () => {
    render(
      <BunkCard
        bunk={fakeBunk}
        onToggleLock={vi.fn()}
        isLocked={false}
        isProductionMode={false}
        defaultCapacity={12}
        activeDragCamper={null}
      />
    )
    const btn = screen.getByRole('button', { name: /lock cabin/i })
    expect(btn).toBeInTheDocument()
    expect(btn.getAttribute('aria-pressed')).toBe('false')
  })

  it('calls onToggleLock when the lock button is clicked', () => {
    const onToggleLock = vi.fn()
    render(
      <BunkCard
        bunk={fakeBunk}
        onToggleLock={onToggleLock}
        isLocked={false}
        isProductionMode={false}
        defaultCapacity={12}
        activeDragCamper={null}
      />
    )
    const btn = screen.getByRole('button', { name: /lock cabin/i })
    fireEvent.click(btn)
    expect(onToggleLock).toHaveBeenCalledTimes(1)
  })

  it('shows "Unlock cabin" label and aria-pressed=true when isLocked=true', () => {
    render(
      <BunkCard
        bunk={fakeBunk}
        onToggleLock={vi.fn()}
        isLocked={true}
        isProductionMode={false}
        defaultCapacity={12}
        activeDragCamper={null}
      />
    )
    const btn = screen.getByRole('button', { name: /unlock cabin/i })
    expect(btn).toBeInTheDocument()
    expect(btn.getAttribute('aria-pressed')).toBe('true')
  })

  it('renders the locked-card visual indicator (header badge) when isLocked=true', () => {
    render(
      <BunkCard
        bunk={fakeBunk}
        onToggleLock={vi.fn()}
        isLocked={true}
        isProductionMode={false}
        defaultCapacity={12}
        activeDragCamper={null}
      />
    )
    expect(screen.getByText(/locked/i)).toBeInTheDocument()
  })

  it('does NOT render a lock button when onToggleLock is not provided', () => {
    render(
      <BunkCard
        bunk={fakeBunk}
        isLocked={false}
        isProductionMode={false}
        defaultCapacity={12}
        activeDragCamper={null}
      />
    )
    expect(screen.queryByRole('button', { name: /lock cabin/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /unlock cabin/i })).toBeNull()
  })
})
