/**
 * One row of the cabin-weekend attribution queue. Shared by the admin queue
 * tab and the board's modal (kindred#2648 UI half) — see
 * `useSessionAttributionQueue`'s module doc for why it is one component.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { SessionAttributionQueueItem } from '../../../hooks/useSessionAttributionQueue'
import { SessionAttributionRow } from './SessionAttributionRow'

function itemFixture(over: Partial<SessionAttributionQueueItem> = {}): SessionAttributionQueueItem {
  return {
    id: 'q1',
    rawValue: 'Willow 1',
    sourceField: 'Family Camp Cabin',
    householdCmId: 2000001,
    personCmId: 0,
    occurrences: 3,
    firstSeen: '2026-08-18 00:00:00.000Z',
    lastSeen: '2026-08-23 00:00:00.000Z',
    resolvedUnitNames: ['Willow 1'],
    candidates: [
      {
        sessionCmId: 1309515,
        short: 'Family Camp 2',
        dateRange: 'Aug 20–23, 2026',
        isSuggested: true,
      },
      {
        sessionCmId: 1309519,
        short: 'Family Camp 6',
        dateRange: 'Sep 24–27, 2026',
        isSuggested: false,
      },
    ],
    isStale: false,
    ...over,
  }
}

describe('SessionAttributionRow', () => {
  it('shows the raw CampMinder value and the household it belongs to', () => {
    // The fixture's raw value and its resolved unit happen to be the same
    // string ("Willow 1" is an exact-match alias for itself) — a realistic
    // case, so this asserts BOTH render rather than picking one arbitrarily.
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.getAllByText('Willow 1')).toHaveLength(2)
    expect(screen.getByText(/2000001/)).toBeInTheDocument()
  })

  it('shows the person id instead when the row is person-scoped', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ householdCmId: 0, personCmId: 3100001 })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText(/3100001/)).toBeInTheDocument()
  })

  it('shows the alias-resolved unit name(s), never the raw value twice', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ resolvedUnitNames: ['Willow 2', 'Willow 3'] })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText('Willow 2 + Willow 3')).toBeInTheDocument()
  })

  it('says the cabin is not recognized when the alias table has no match', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ resolvedUnitNames: [] })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText(/not recognized/i)).toBeInTheDocument()
  })

  it('offers a confirm action for every candidate weekend, labeled with its own name', () => {
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.getByRole('button', { name: /This is Family Camp 2/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /This is Family Camp 6/ })).toBeInTheDocument()
  })

  it('marks the suggested candidate, and only the suggested one, as the best guess', () => {
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.getAllByText(/best guess/i)).toHaveLength(1)
  })

  it('confirms with the CLICKED candidate’s own session id, not the suggested one', async () => {
    const onConfirm = vi.fn()
    const user = userEvent.setup()
    render(
      <SessionAttributionRow item={itemFixture()} onConfirm={onConfirm} isConfirming={false} />
    )

    await user.click(screen.getByRole('button', { name: /This is Family Camp 6/ }))

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(onConfirm).toHaveBeenCalledWith(1309519)
  })

  it('disables every confirm action while a confirm is in flight', () => {
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={true} />)
    expect(screen.getByRole('button', { name: /This is Family Camp 2/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /This is Family Camp 6/ })).toBeDisabled()
  })

  it('flags an outdated row so staff know to skip it rather than pick a weekend', () => {
    render(
      <SessionAttributionRow
        item={itemFixture({ isStale: true })}
        onConfirm={vi.fn()}
        isConfirming={false}
      />
    )
    expect(screen.getByText(/outdated/i)).toBeInTheDocument()
  })

  it('offers no change-weekend affordance — confirmation is one-time, per the open kindred#2648 decision', () => {
    // A resolved row never reaches this component (the queue hook already
    // filters to is_resolved = false), so there is nothing here shaped like
    // an edit control at all: no "Undo", no "Change weekend". This test pins
    // that absence directly, since the failure mode is someone adding one
    // back onto a still-open row without re-reading why it isn't here.
    render(<SessionAttributionRow item={itemFixture()} onConfirm={vi.fn()} isConfirming={false} />)
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /change weekend/i })).not.toBeInTheDocument()
  })

  // Owner finding on kindred#2650: "the modal has household ID which is not
  // helpful, needs to show the family name". `familyName` is resolved by
  // each home differently (board roster vs. a per-household journey fetch on
  // the admin tab) and handed down as a plain string — this component stays
  // ignorant of where it came from.
  describe('the resolved family name', () => {
    it('shows the family name instead of the raw household id, when one resolves', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
        />
      )
      expect(screen.getByText(/The Johnson Family/)).toBeInTheDocument()
      expect(screen.queryByText(/2000001/)).not.toBeInTheDocument()
    })

    it('falls back to the raw household id when no name resolves — a poor id beats a blank row', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName={undefined}
        />
      )
      expect(screen.getByText(/2000001/)).toBeInTheDocument()
    })

    it('falls back to the raw household id when the resolved name is blank', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName=""
        />
      )
      expect(screen.getByText(/2000001/)).toBeInTheDocument()
    })

    it('never resolves a family name for a person-scoped row — the id stays', () => {
      render(
        <SessionAttributionRow
          item={itemFixture({ householdCmId: 0, personCmId: 3100001 })}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
        />
      )
      expect(screen.getByText(/3100001/)).toBeInTheDocument()
      expect(screen.queryByText(/The Johnson Family/)).not.toBeInTheDocument()
    })
  })

  describe('opening the family from the row', () => {
    it('renders the name as a click target that opens the family, when a handler is given', async () => {
      const onOpenFamily = vi.fn()
      const user = userEvent.setup()
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
          onOpenFamily={onOpenFamily}
        />
      )

      await user.click(screen.getByRole('button', { name: 'The Johnson Family' }))

      expect(onOpenFamily).toHaveBeenCalledTimes(1)
      expect(onOpenFamily).toHaveBeenCalledWith(2000001)
    })

    it('renders plain text, never a dead click, when no handler is given — the admin tab has nothing to open', () => {
      render(
        <SessionAttributionRow
          item={itemFixture()}
          onConfirm={vi.fn()}
          isConfirming={false}
          familyName="The Johnson Family"
        />
      )
      expect(screen.queryByRole('button', { name: 'The Johnson Family' })).not.toBeInTheDocument()
      expect(screen.getByText(/The Johnson Family/)).toBeInTheDocument()
    })

    it('never renders a click target for a person-scoped row, even if a handler is given', () => {
      render(
        <SessionAttributionRow
          item={itemFixture({ householdCmId: 0, personCmId: 3100001 })}
          onConfirm={vi.fn()}
          isConfirming={false}
          onOpenFamily={vi.fn()}
        />
      )
      expect(screen.queryByRole('button', { name: /3100001/ })).not.toBeInTheDocument()
    })
  })
})
