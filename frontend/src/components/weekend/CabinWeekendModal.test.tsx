/**
 * The cabin-weekend chip's detail modal (Home 1, kindred#2648 UI half) — pops
 * open from the board's stats-bar chip, `ui/Modal` shell, and reuses
 * `SessionAttributionRow` for every row relevant to the currently selected
 * weekend.
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

import { CabinWeekendModal } from './CabinWeekendModal'

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
    candidates: [
      { sessionCmId: 1309515, short: 'FC2', dateRange: '', isSuggested: true },
      { sessionCmId: 1309519, short: 'FC6', dateRange: '', isSuggested: false },
    ],
    isStale: false,
    ...over,
  }
}

function renderModal(over: Partial<ComponentProps<typeof CabinWeekendModal>> = {}) {
  return render(
    <MemoryRouter>
      <CabinWeekendModal
        isOpen
        onClose={vi.fn()}
        weekendCmId={1309515}
        weekendLabel="FC2"
        {...over}
      />
    </MemoryRouter>
  )
}

describe('CabinWeekendModal', () => {
  it('renders only rows whose candidates include the currently viewed weekend', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        itemFixture({
          id: 'q1',
          rawValue: 'Ridge I',
          candidates: [{ sessionCmId: 1309515, short: 'FC2', dateRange: '', isSuggested: true }],
        }),
        itemFixture({
          id: 'q2',
          rawValue: 'River C',
          candidates: [{ sessionCmId: 1366768, short: 'RSC', dateRange: '', isSuggested: true }],
        }),
      ],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    renderModal()

    expect(screen.getByText('Ridge I')).toBeInTheDocument()
    expect(screen.queryByText('River C')).not.toBeInTheDocument()
  })

  it('never shows a stale row, even without a toggle — the condensed home stays condensed', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [itemFixture({ id: 'q9', rawValue: 'Tuolumne 2', isStale: true })],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    renderModal()

    expect(screen.queryByText('Tuolumne 2')).not.toBeInTheDocument()
  })

  it('says nothing is waiting when this weekend has no relevant rows', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    renderModal()

    expect(screen.getByText(/nothing waiting on this weekend/i)).toBeInTheDocument()
  })

  it('lists what is waiting for OTHER weekends, without offering to confirm it here', () => {
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [
        itemFixture({
          id: 'q2',
          rawValue: 'River C',
          candidates: [{ sessionCmId: 1366768, short: 'RSC', dateRange: '', isSuggested: true }],
        }),
      ],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    renderModal()

    expect(screen.getByText(/other weekend/i)).toBeInTheDocument()
    expect(screen.getByText(/River C/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /This is RSC/ })).not.toBeInTheDocument()
  })

  it('confirms through the same shared row action, for the confirmed weekend', async () => {
    const confirm = vi.fn()
    const user = userEvent.setup()
    const item = itemFixture()
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [item],
      items: [],
      confirm,
      isConfirming: false,
    })
    renderModal()

    await user.click(screen.getByRole('button', { name: /This is FC2/ }))

    expect(confirm).toHaveBeenCalledWith(item, 1309515)
  })

  it('closes on Done', async () => {
    const onClose = vi.fn()
    const user = userEvent.setup()
    useSessionAttributionQueue.mockReturnValue({
      isLoading: false,
      error: null,
      data: [],
      items: [],
      confirm: vi.fn(),
      isConfirming: false,
    })
    renderModal({ onClose })

    await user.click(screen.getByRole('button', { name: /done/i }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
