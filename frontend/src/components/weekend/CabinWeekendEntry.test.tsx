/**
 * The cabin-weekend chip's stats-bar entry point (Home 1, kindred#2648 UI
 * half) — owns the modal's open state, exactly like `PushWriteInsEntry` owns
 * `PushWriteInsModal`'s.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'

import type { SessionAttributionQueueItem } from '../../hooks/useSessionAttributionQueue'

const useSessionAttributionQueue = vi.fn()

vi.mock('../../hooks/useSessionAttributionQueue', () => ({
  useSessionAttributionQueue: () => useSessionAttributionQueue(),
}))

import { CabinWeekendEntry } from './CabinWeekendEntry'

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
    resolvedUnitNames: [],
    candidates: [{ sessionCmId: 1309515, short: 'FC2', dateRange: '', isSuggested: true }],
    isStale: false,
    ...over,
  }
}

function renderEntry(props: Partial<ComponentProps<typeof CabinWeekendEntry>> = {}) {
  return render(
    <MemoryRouter>
      <CabinWeekendEntry sessionCmId={1309515} weekendLabel="FC2" canManage {...props} />
    </MemoryRouter>
  )
}

describe('CabinWeekendEntry', () => {
  it('renders nothing when no weekend is selected', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [itemFixture()],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    const { container } = renderEntry({ sessionCmId: 0 })
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing for a user without bunking.manage', () => {
    // The confirm write is gated server-side by the collection's existing
    // bunking.manage rule (kindred#2648's backend contract — no new
    // permission), but the AFFORDANCE follows the same RBAC placement as
    // every other write control on this board (CLAUDE.md §4).
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [itemFixture()],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    const { container } = renderEntry({ canManage: false })
    expect(container).toBeEmptyDOMElement()
  })

  it('counts only rows relevant to the selected weekend', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        itemFixture({
          id: 'q1',
          candidates: [{ sessionCmId: 1309515, short: 'FC2', dateRange: '', isSuggested: true }],
        }),
        itemFixture({
          id: 'q2',
          candidates: [{ sessionCmId: 1366768, short: 'RSC', dateRange: '', isSuggested: true }],
        }),
      ],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    renderEntry()
    expect(screen.getByRole('button', { name: /1 cabin needs a weekend/i })).toBeInTheDocument()
  })

  it('excludes stale rows from the count', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [itemFixture({ id: 'q1', isStale: true })],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    const { container } = renderEntry()
    expect(container).toBeEmptyDOMElement()
  })

  it('opens the modal when the chip is clicked', async () => {
    const user = userEvent.setup()
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [itemFixture()],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    renderEntry()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /needs? a weekend/i }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
