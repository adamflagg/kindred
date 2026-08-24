/**
 * The weekend's unplaced queue. Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
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

/**
 * The four-group filter row — kindred#2480, picks locked 2026-08-24.
 *
 * Chips are ICON + COUNT with no text label, so every query below addresses
 * them by accessible name (test infrastructure per frontend/CLAUDE.md, not an
 * accessibility posture).
 */
describe('the filter chips (kindred#2480)', () => {
  function open() {
    return userEvent.click(screen.getByRole('button', { name: /unplaced parties/i }))
  }

  /**
   * Chips are addressed through the filter row, never through `screen`: each
   * card draws its OWN marks as tooltip buttons carrying the same names, so a
   * bare `getByRole` matches the chip and every card that has that mark.
   */
  function chip(name: RegExp) {
    return within(screen.getByTestId('unplaced-filters')).getByRole('button', { name })
  }

  // Distinct CHILD names, not just distinct sort_names: the card draws its
  // identity from the children run, so same-named children make every row
  // read identically and the list assertions cannot tell them apart.
  const under2 = party({
    household_cm_id: 201,
    sort_name: 'Alvarez',
    children: [{ person_cm_id: 9101, display_name: 'Mia Alvarez', age: 1, grade: 0 }],
    flags: { has_child_under_two: true },
  })
  const bathroom = party({
    household_cm_id: 202,
    sort_name: 'Bennett',
    children: [{ person_cm_id: 9102, display_name: 'Liam Bennett', age: 7, grade: 2 }],
    flags: { needs_private_bathroom: true },
  })
  const sharer = party({
    household_cm_id: 203,
    sort_name: 'Castillo',
    children: [{ person_cm_id: 9103, display_name: 'Ivy Castillo', age: 9, grade: 4 }],
    share: { preference: 'yes_share' },
  })
  const plain = party({
    household_cm_id: 204,
    sort_name: 'Delgado',
    children: [{ person_cm_id: 9104, display_name: 'Theo Delgado', age: 6, grade: 1 }],
  })

  it('renders one chip per group, each carrying its count', async () => {
    render(
      <FloatingUnplacedBadge parties={[under2, bathroom, sharer, plain]} onOpenParty={vi.fn()} />,
      { wrapper }
    )
    await open()
    expect(chip(/child under 2/i)).toHaveTextContent('1')
    expect(chip(/bathroom in unit/i)).toHaveTextContent('1')
    expect(chip(/open to sharing/i)).toHaveTextContent('1')
    // Power: nobody asked. The chip still renders — a hidden chip cannot say
    // "this group is empty", which is the whole reason the pick was "dim".
    expect(chip(/power/i)).toHaveTextContent('0')
  })

  it('narrows the list to the picked group', async () => {
    render(
      <FloatingUnplacedBadge parties={[under2, bathroom, sharer, plain]} onOpenParty={vi.fn()} />,
      { wrapper }
    )
    await open()
    await userEvent.click(chip(/child under 2/i))
    expect(screen.getByText(/Alvarez/)).toBeInTheDocument()
    expect(screen.queryByText(/Bennett/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Delgado/)).not.toBeInTheDocument()
  })

  it('is SINGLE-select: a second chip replaces the first, never adds to it', async () => {
    // The ruling's whole purpose — a party in 2+ groups never needs a
    // tie-break rule because two groups are never active at once.
    render(<FloatingUnplacedBadge parties={[under2, bathroom, plain]} onOpenParty={vi.fn()} />, {
      wrapper,
    })
    await open()
    await userEvent.click(chip(/child under 2/i))
    await userEvent.click(chip(/bathroom in unit/i))

    expect(chip(/bathroom in unit/i)).toHaveAttribute('aria-pressed', 'true')
    expect(chip(/child under 2/i)).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByText(/Bennett/)).toBeInTheDocument()
    expect(screen.queryByText(/Alvarez/)).not.toBeInTheDocument()
  })

  it('clears the filter when the active chip is clicked again', async () => {
    render(<FloatingUnplacedBadge parties={[under2, plain]} onOpenParty={vi.fn()} />, { wrapper })
    await open()
    await userEvent.click(chip(/child under 2/i))
    expect(screen.queryByText(/Delgado/)).not.toBeInTheDocument()
    await userEvent.click(chip(/child under 2/i))
    expect(screen.getByText(/Delgado/)).toBeInTheDocument()
    expect(chip(/child under 2/i)).toHaveAttribute('aria-pressed', 'false')
  })

  it('disables a zero-count chip rather than hiding it', async () => {
    render(<FloatingUnplacedBadge parties={[plain]} onOpenParty={vi.fn()} />, { wrapper })
    await open()
    expect(chip(/power/i)).toBeInTheDocument()
    expect(chip(/power/i)).toBeDisabled()
  })

  it('counts over ALL unplaced parties, not the name-search subset', async () => {
    // A chip's number must not move while you type, or it stops answering
    // "is this group worth clicking".
    render(<FloatingUnplacedBadge parties={[under2, bathroom, plain]} onOpenParty={vi.fn()} />, {
      wrapper,
    })
    await open()
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'Bennett')
    expect(chip(/child under 2/i)).toHaveTextContent('1')
  })

  it('names the group in its own empty state, and offers a way out', async () => {
    // Distinct from "Everyone has a cabin." (nothing queued) and from the
    // name-search miss — three different dead ends, three different messages.
    //
    // Reached by PLACING the last match while the filter is live, not by
    // clicking: an empty group's chip is disabled, so a dead end can never be
    // chosen, only worked into. That is the working-session case — filter to
    // sharing, place the last sharer, and the list empties under you.
    const { rerender } = render(
      <FloatingUnplacedBadge parties={[sharer, plain]} onOpenParty={vi.fn()} />,
      { wrapper }
    )
    await open()
    await userEvent.click(chip(/open to sharing/i))
    expect(screen.getByText(/Castillo/)).toBeInTheDocument()

    rerender(<FloatingUnplacedBadge parties={[plain]} onOpenParty={vi.fn()} />)
    expect(screen.getByText(/no unplaced parties are open to sharing/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /clear filter/i }))
    expect(screen.getByText(/Theo Delgado/)).toBeInTheDocument()
  })

  it('keeps the ACTIVE chip clickable at zero so the dead end can be left', async () => {
    // The disabled rule is `count === 0 && !isActive`. Without the second
    // half, working the last match out of a filtered group would trap the
    // queue: an empty list and a chip that cannot be switched off.
    const { rerender } = render(
      <FloatingUnplacedBadge parties={[sharer, plain]} onOpenParty={vi.fn()} />,
      { wrapper }
    )
    await open()
    await userEvent.click(chip(/open to sharing/i))
    rerender(<FloatingUnplacedBadge parties={[plain]} onOpenParty={vi.fn()} />)
    expect(chip(/open to sharing/i)).toBeEnabled()
    await userEvent.click(chip(/open to sharing/i))
    expect(screen.getByText(/Theo Delgado/)).toBeInTheDocument()
  })

  it('shows no filter row at all when the queue is empty', async () => {
    render(<FloatingUnplacedBadge parties={[]} onOpenParty={vi.fn()} />, { wrapper })
    await open()
    expect(screen.queryByTestId('unplaced-filters')).not.toBeInTheDocument()
    expect(screen.getByText(/everyone has a cabin/i)).toBeInTheDocument()
  })
})
