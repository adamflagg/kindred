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
import type { RosterPartyRow } from '../../types/lodging'

const useSessionAttributionQueue = vi.fn()

vi.mock('../../hooks/useSessionAttributionQueue', () => ({
  // Args FORWARDED, not swallowed: what this modal asks the hook for depends
  // on whether it is open — see the evidence test at the bottom of this file.
  useSessionAttributionQueue: (...args: unknown[]) => useSessionAttributionQueue(...args),
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

function partyFixture(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    display_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Riley Johnson', last_name: 'Johnson', age: 8 }],
    ...overrides,
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

  describe('the family name and its click-through (kindred#2650)', () => {
    it("resolves a row's family name from the roster this modal's host page already has loaded", () => {
      useSessionAttributionQueue.mockReturnValue({
        isLoading: false,
        error: null,
        data: [itemFixture()],
        items: [],
        confirm: vi.fn(),
        isConfirming: false,
      })
      renderModal({ parties: [partyFixture()] })

      expect(screen.getByText(/The Johnson Family/)).toBeInTheDocument()
      expect(screen.queryByText(/2000001/)).not.toBeInTheDocument()
    })

    it('falls back to the raw household id when the roster has no matching party', () => {
      useSessionAttributionQueue.mockReturnValue({
        isLoading: false,
        error: null,
        data: [itemFixture()],
        items: [],
        confirm: vi.fn(),
        isConfirming: false,
      })
      renderModal({ parties: [] })

      expect(screen.getByText(/2000001/)).toBeInTheDocument()
    })

    it('opens the FULL roster party for the household on click, not just its id', async () => {
      const onOpenFamily = vi.fn()
      const user = userEvent.setup()
      const party = partyFixture()
      useSessionAttributionQueue.mockReturnValue({
        isLoading: false,
        error: null,
        data: [itemFixture()],
        items: [],
        confirm: vi.fn(),
        isConfirming: false,
      })
      renderModal({ parties: [party], onOpenFamily })

      await user.click(screen.getByRole('button', { name: 'The Johnson Family' }))

      expect(onOpenFamily).toHaveBeenCalledTimes(1)
      expect(onOpenFamily).toHaveBeenCalledWith(party)
    })

    it('renders no click target when the roster has no matching party, even with a handler given', () => {
      useSessionAttributionQueue.mockReturnValue({
        isLoading: false,
        error: null,
        data: [itemFixture()],
        items: [],
        confirm: vi.fn(),
        isConfirming: false,
      })
      renderModal({ parties: [], onOpenFamily: vi.fn() })

      expect(screen.queryByRole('button', { name: /2000001/ })).not.toBeInTheDocument()
    })
  })

  /**
   * ⭐ THE COPY #2650 WITHHELD. That PR deliberately avoided
   * "confident"-adjacent language here, because the only signal behind the
   * best guess was `AttributeSession`'s `last_updated` heuristic — which the
   * 2026 snapshot shows has no per-household resolution at all (136 cabin
   * values, seven distinct `last_updated` days, 83% on two of them). §12.8
   * supplies the real board comparison, so the explanation can now say what
   * the guess is actually made of.
   */
  it('says the best guess is a board comparison, now that it is one', async () => {
    renderModal()
    await screen.findByText(/CampMinder only stores one cabin/)
    expect(screen.getByText(/what each weekend\u2019s board already holds/)).toBeInTheDocument()
  })

  it('does not promise a demotion that the all-conflict case never performs', async () => {
    // §12.8.3: when EVERY candidate conflicts, nothing is demoted — the row
    // raises an alarm about the cabin value instead, because moving the guess
    // would move it onto a weekend the rule has just called wrong. So the
    // explanation must not say a taken weekend is demoted full stop; it loses
    // the guess to a FREE one, and where there is no free one it keeps it.
    renderModal()
    const explanation = (await screen.findByText(/CampMinder only stores one cabin/)).textContent
    expect(explanation).toContain('loses the guess to one that is free')
  })

  /**
   * THE EVIDENCE IS FETCHED ON OPEN, NOT ON MOUNT. `CabinWeekendEntry` renders
   * this modal unconditionally and toggles `isOpen`, so the component function
   * — and every hook in it — runs for the whole board session. The occupancy
   * query is `staleTime: 0` with `refetchOnWindowFocus`, so an ungated mount
   * would re-read every candidate weekend's board on each alt-tab back while
   * this modal is shut and drawing nothing.
   *
   * It also makes `useSessionAttributionConflicts`'s own `gcTime: 0` note true
   * as written: the query really does start clean on each open now.
   */
  it('asks for no occupancy evidence while it is closed', () => {
    renderModal({ isOpen: false })
    expect(useSessionAttributionQueue).toHaveBeenCalledWith({ evidence: false })
  })

  it('asks for it once it is open — the rows draw a verdict each', () => {
    renderModal({ isOpen: true })
    expect(useSessionAttributionQueue).toHaveBeenCalledWith({ evidence: true })
  })
})
