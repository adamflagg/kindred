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
    expect(screen.getByRole('button', { name: /1 unplaced families/i })).toHaveTextContent('1')
  })

  it('files a household under its surname, not its mailing title', async () => {
    // The two names are chosen so the orderings DISAGREE: by surname it is
    // Chen then Johnson, by mailing title it is "Johnson Household" then "The
    // Chen Family". A pair that sorted the same either way would pin nothing.
    render(
      <FloatingUnplacedBadge
        parties={[
          party({ display_name: 'Johnson Household', sort_name: 'Johnson', household_cm_id: 101 }),
          party({ display_name: 'The Chen Family', sort_name: 'Chen', household_cm_id: 102 }),
        ]}
        onOpenParty={vi.fn()}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    const names = screen.getAllByTestId('family-card-name').map((el) => el.textContent)
    expect(names).toEqual(['The Chen Family', 'Johnson Household'])
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
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.type(screen.getByPlaceholderText(/filter by name/i), 'Olivia')
    expect(screen.getAllByTestId('family-card-name').map((el) => el.textContent)).toEqual([
      'Garcia Household',
    ])
  })

  it('says everyone has a cabin when nothing is queued', async () => {
    render(<FloatingUnplacedBadge parties={[]} onOpenParty={vi.fn()} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /0 unplaced families/i }))
    expect(screen.getByText(/Everyone has a cabin/i)).toBeInTheDocument()
  })

  it('opens a party when its card is clicked', async () => {
    const onOpenParty = vi.fn()
    render(<FloatingUnplacedBadge parties={[party()]} onOpenParty={onOpenParty} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /unplaced families/i }))
    await userEvent.click(screen.getByRole('button', { name: /The Johnson Family/ }))
    expect(onOpenParty).toHaveBeenCalledWith(expect.objectContaining({ household_cm_id: 101 }))
  })
})
