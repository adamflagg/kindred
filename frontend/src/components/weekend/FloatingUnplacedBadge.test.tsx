/**
 * The weekend's unplaced queue. Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { FloatingUnplacedBadge } from './FloatingUnplacedBadge'

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'The Johnson Family',
    sort_name: 'Johnson',
    adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

describe('FloatingUnplacedBadge', () => {
  it('counts the unplaced parties on the collapsed button', () => {
    render(<FloatingUnplacedBadge parties={[party()]} onOpenParty={vi.fn()} />, { wrapper })
    expect(screen.getByRole('button', { name: /1 unplaced parties/i })).toHaveTextContent('1')
  })

  it('files a household under its surname, not its mailing title', async () => {
    // The queue orders by `sort_name` (surname), registration order
    // notwithstanding: Chen before Johnson below. kindred#2074 removed the
    // mailing-title salutation from the card entirely, so this reads the
    // order off each party's own (distinct) child rather than off
    // `display_name` text that no longer renders.
    render(
      <FloatingUnplacedBadge
        parties={[
          party({ display_name: 'Johnson Household', sort_name: 'Johnson', household_cm_id: 101 }),
          party({
            display_name: 'The Chen Family',
            sort_name: 'Chen',
            household_cm_id: 102,
            children: [{ person_cm_id: 9002, display_name: 'Mia Chen', age: 6, grade: 0 }],
          }),
        ]}
        onOpenParty={vi.fn()}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced parties/i }))
    const names = screen.getAllByTestId('family-card-name').map((el) => el.textContent)
    expect(names).toEqual(['Mia Chen (6)', 'Noah Johnson (8)'])
  })

  it('no longer finds a household by its stale salutation, only by its real identity', async () => {
    // kindred#2084: the search index used to include `party.display_name`
    // (CampMinder's mailing_title salutation) verbatim. This household's
    // salutation names only one adult in a form that includes 'Mr.'; its
    // real attending adult ('Emma Johnson') is what the search index now
    // carries instead, via the same construction FamilyCard uses.
    render(
      <FloatingUnplacedBadge
        parties={[
          party({
            display_name: 'Mr. and Mrs. Johnson',
            sort_name: 'Johnson',
            adults: [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }],
          }),
        ]}
        onOpenParty={vi.fn()}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced parties/i }))

    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'Mr.')
    expect(screen.queryAllByTestId('family-card-name')).toEqual([])

    await userEvent.clear(screen.getByPlaceholderText(/filter by name/i))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'Emma')
    expect(screen.getAllByTestId('family-card-name')).toHaveLength(1)
  })

  it('finds a household by a child’s name', async () => {
    render(
      <FloatingUnplacedBadge
        parties={[
          party(),
          party({
            display_name: 'Garcia Household',
            sort_name: 'Garcia',
            household_cm_id: 102,
            children: [{ person_cm_id: 9002, display_name: 'Olivia Garcia', age: 7, grade: 2 }],
          }),
        ]}
        onOpenParty={vi.fn()}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced parties/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'Olivia')
    // kindred#2074: the surviving card shows the child's name, not the
    // household's removed salutation.
    expect(screen.getAllByTestId('family-card-name').map((el) => el.textContent)).toEqual([
      'Olivia Garcia (7)',
    ])
  })

  it('says everyone has a cabin when nothing is queued', async () => {
    render(<FloatingUnplacedBadge parties={[]} onOpenParty={vi.fn()} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /0 unplaced parties/i }))
    expect(screen.getByText(/Everyone has a cabin/i)).toBeInTheDocument()
  })

  it('keeps two adult-weekend individuals apart', async () => {
    // Adult weekends enrol PEOPLE, so every party's `household_cm_id` is the
    // wire's 0 — Pydantic serialises the default, it is never absent. A key
    // built with `??` reads that 0 as a present value and files the whole
    // queue under "person-0", so N individuals become one React key.
    render(
      <FloatingUnplacedBadge
        parties={[
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 9101,
            display_name: 'Riley Sam',
            sort_name: 'Sam',
            adults: [],
            children: [],
            party_size: 1,
          }),
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 9102,
            display_name: 'Samuel Johnson',
            sort_name: 'Johnson',
            adults: [],
            children: [],
            party_size: 1,
          }),
        ]}
        onOpenParty={vi.fn()}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced parties/i }))

    // Both are here, and filed under their real surnames.
    expect(screen.getAllByTestId('family-card-name').map((el) => el.textContent)).toEqual([
      'Samuel Johnson',
      'Riley Sam',
    ])
    // ...and React considers them two rows, not one rendered twice. This is
    // the half of the assertion that a colliding key actually trips.
    const duplicateKeyWarning = vi
      .mocked(console.error)
      .mock.calls.filter((args) => args.some((arg) => /same key/i.test(String(arg))))
    expect(duplicateKeyWarning).toEqual([])
  })

  it('opens a party when its card is clicked', async () => {
    const onOpenParty = vi.fn()
    render(<FloatingUnplacedBadge parties={[party()]} onOpenParty={onOpenParty} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /unplaced parties/i }))
    // kindred#2074: the card is reached by its child's name now -- the
    // household salutation ('The Johnson Family') no longer renders.
    await userEvent.click(screen.getByRole('button', { name: /Noah Johnson/ }))
    expect(onOpenParty).toHaveBeenCalledWith(expect.objectContaining({ household_cm_id: 101 }))
  })
})
