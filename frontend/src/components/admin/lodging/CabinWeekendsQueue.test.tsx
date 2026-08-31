/**
 * The cabin-weekend attribution queue's admin tab — Home 2 in the approved
 * design (kindred#2648 UI half), the always-accessible surface. Stale rows
 * are hidden by default with a toggle to reveal them.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { SessionAttributionQueueItem } from '../../../hooks/useSessionAttributionQueue'

const useSessionAttributionQueue = vi.fn()

vi.mock('../../../hooks/useSessionAttributionQueue', () => ({
  useSessionAttributionQueue: () => useSessionAttributionQueue(),
}))

// The admin tab has no roster context (unlike the board's modal), so its
// family-name resolution is its own per-household hook — see
// `useWeekendRoster.ts`'s `useHouseholdFamilyLabel` doc comment for why it is
// built on `useHouseholdJourney` rather than a second naming derivation.
// Mocked by household id here, matching how `useSessionAttributionQueue`
// above is mocked, so this file stays a pure component test.
const householdFamilyLabels = new Map<number, string | undefined>()

vi.mock('../../../hooks/useWeekendRoster', () => ({
  useHouseholdFamilyLabel: (householdCmId: number) => householdFamilyLabels.get(householdCmId),
}))

import { CabinWeekendsQueue } from './CabinWeekendsQueue'

function itemFixture(over: Partial<SessionAttributionQueueItem> = {}): SessionAttributionQueueItem {
  return {
    id: 'q1',
    rawValue: 'Ridge I',
    sourceField: 'Family Camp Cabin',
    householdCmId: 2000001,
    personCmId: 0,
    occurrences: 3,
    firstSeen: '2026-08-18 00:00:00.000Z',
    lastSeen: '2026-08-23 00:00:00.000Z',
    resolvedUnitNames: ['Ridge I'],
    candidates: [
      { sessionCmId: 1309515, short: 'FC2', dateRange: '', isSuggested: true },
      { sessionCmId: 1309519, short: 'FC6', dateRange: '', isSuggested: false },
    ],
    isStale: false,
    ...over,
  }
}

function baseHookResult(items: SessionAttributionQueueItem[]) {
  return {
    isLoading: false,
    error: null,
    data: items,
    items,
    confirm: vi.fn(),
    isConfirming: false,
  }
}

describe('CabinWeekendsQueue', () => {
  beforeEach(() => {
    householdFamilyLabels.clear()
  })

  it('shows loading state before the queue settles', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: true,
      error: null,
      data: undefined,
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    render(<CabinWeekendsQueue />)
    expect(screen.getByText(/Loading/i)).toBeInTheDocument()
  })

  it('says the queue is clean when nothing is waiting', () => {
    useSessionAttributionQueue.mockReturnValue(baseHookResult([]))
    render(<CabinWeekendsQueue />)
    expect(screen.getByText(/no cabins are waiting/i)).toBeInTheDocument()
  })

  it('renders one row per current (non-stale) item', () => {
    useSessionAttributionQueue.mockReturnValue(
      baseHookResult([
        itemFixture({ id: 'q1', rawValue: 'Ridge I', resolvedUnitNames: [] }),
        itemFixture({ id: 'q2', rawValue: 'River C', resolvedUnitNames: [] }),
      ])
    )
    render(<CabinWeekendsQueue />)
    expect(screen.getByText('Ridge I')).toBeInTheDocument()
    expect(screen.getByText('River C')).toBeInTheDocument()
  })

  it('hides stale rows by default', () => {
    useSessionAttributionQueue.mockReturnValue(
      baseHookResult([
        itemFixture({ id: 'q1', rawValue: 'Ridge I', resolvedUnitNames: [], isStale: false }),
        itemFixture({ id: 'q9', rawValue: 'Tuolumne 2', resolvedUnitNames: [], isStale: true }),
      ])
    )
    render(<CabinWeekendsQueue />)
    expect(screen.getByText('Ridge I')).toBeInTheDocument()
    expect(screen.queryByText('Tuolumne 2')).not.toBeInTheDocument()
  })

  it('reveals stale rows once the toggle is clicked', async () => {
    const user = userEvent.setup()
    useSessionAttributionQueue.mockReturnValue(
      baseHookResult([
        itemFixture({ id: 'q1', rawValue: 'Ridge I', resolvedUnitNames: [], isStale: false }),
        itemFixture({ id: 'q9', rawValue: 'Tuolumne 2', resolvedUnitNames: [], isStale: true }),
      ])
    )
    render(<CabinWeekendsQueue />)

    await user.click(screen.getByRole('button', { name: /show.*outdated/i }))

    expect(screen.getByText('Tuolumne 2')).toBeInTheDocument()
  })

  it('offers no stale toggle at all when nothing is stale', () => {
    useSessionAttributionQueue.mockReturnValue(baseHookResult([itemFixture()]))
    render(<CabinWeekendsQueue />)
    expect(screen.queryByRole('button', { name: /outdated/i })).not.toBeInTheDocument()
  })

  it('confirms the item that owns the clicked button, for the clicked weekend', async () => {
    const confirm = vi.fn()
    const user = userEvent.setup()
    const item = itemFixture()
    useSessionAttributionQueue.mockReturnValue({ ...baseHookResult([item]), confirm })
    render(<CabinWeekendsQueue />)

    await user.click(screen.getByRole('button', { name: /This is FC2/ }))

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(confirm).toHaveBeenCalledWith(item, 1309515)
  })

  describe('the family name (kindred#2650)', () => {
    it("shows a row's resolved family name instead of its raw household id", () => {
      householdFamilyLabels.set(2000001, 'The Johnson Family')
      useSessionAttributionQueue.mockReturnValue(baseHookResult([itemFixture()]))

      render(<CabinWeekendsQueue />)

      expect(screen.getByText(/The Johnson Family/)).toBeInTheDocument()
      expect(screen.queryByText(/2000001/)).not.toBeInTheDocument()
    })

    it('falls back to the raw household id when the per-row hook resolves nothing', () => {
      // householdFamilyLabels left empty — the hook mock returns undefined,
      // matching a first-time household with no attendee row yet.
      useSessionAttributionQueue.mockReturnValue(baseHookResult([itemFixture()]))

      render(<CabinWeekendsQueue />)

      expect(screen.getByText(/2000001/)).toBeInTheDocument()
    })

    it('offers no click target — the admin tab has no roster party to hand FamilyDetailsPanel', () => {
      householdFamilyLabels.set(2000001, 'The Johnson Family')
      useSessionAttributionQueue.mockReturnValue(baseHookResult([itemFixture()]))

      render(<CabinWeekendsQueue />)

      expect(screen.queryByRole('button', { name: 'The Johnson Family' })).not.toBeInTheDocument()
    })
  })
})
