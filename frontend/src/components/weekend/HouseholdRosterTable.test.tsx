/**
 * The roster table renders both grains: a household party (family camp,
 * where CampMinder enrols only the children) and a person party (adult
 * weekends, where individuals enrol directly).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { HouseholdRosterTable } from './HouseholdRosterTable'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: 'The Johnson Family',
    adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
    children: [{ person_cm_id: 1000001, display_name: 'Emma Johnson', age: 9, grade: 4 }],
    party_size: 2,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
      needs_resolution: false,
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
      has_medical_narrative: false,
    },
    ...overrides,
  }
}

describe('HouseholdRosterTable', () => {
  it('shows an empty state rather than an empty table', () => {
    render(<HouseholdRosterTable parties={[]} year={2026} />, { wrapper })
    expect(screen.getByText('No households enrolled for this weekend yet.')).toBeInTheDocument()
  })

  it('renders adults and children counts for a household party', () => {
    render(<HouseholdRosterTable parties={[party()]} year={2026} />, { wrapper })
    expect(screen.getByText('The Johnson Family')).toBeInTheDocument()
    expect(screen.getByText('1 adult · 1 child')).toBeInTheDocument()
    expect(screen.getByText('Olivia Johnson')).toBeInTheDocument()
    expect(screen.getByText('Emma Johnson (9)')).toBeInTheDocument()
  })

  it('pluralises adults and children correctly', () => {
    render(
      <HouseholdRosterTable
        parties={[
          party({
            adults: [
              { adult_number: 1, display_name: 'Olivia Chen', relationship: 'Parent' },
              { adult_number: 2, display_name: 'Noah Chen', relationship: 'Parent' },
            ],
            children: [
              { person_cm_id: 1000001, display_name: 'Emma Chen', age: 9, grade: 4 },
              { person_cm_id: 1000003, display_name: 'Liam Chen', age: 7, grade: 2 },
            ],
            party_size: 4,
          }),
        ]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('2 adults · 2 children')).toBeInTheDocument()
  })

  it('renders a child of unknown age without a bare parenthesis', () => {
    render(
      <HouseholdRosterTable
        parties={[
          party({
            children: [
              { person_cm_id: 1000001, display_name: 'Emma Johnson', age: null, grade: null },
            ],
          }),
        ]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('shows the assigned unit, or "Unassigned" when there is none', () => {
    const { rerender } = render(<HouseholdRosterTable parties={[party()]} year={2026} />, {
      wrapper,
    })
    expect(screen.getByText('Unassigned')).toBeInTheDocument()

    rerender(
      <HouseholdRosterTable
        parties={[party({ unit_code: 'ridge-a', unit_name: 'Ridge A' })]}
        year={2026}
      />
    )
    expect(screen.getByText('Ridge A')).toBeInTheDocument()
  })

  it('marks a merged slot so staff know two rooms were combined', () => {
    render(
      <HouseholdRosterTable
        parties={[party({ unit_name: 'Wawona', is_merged_slot: true })]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Merged')).toBeInTheDocument()
  })

  it('flags a returning family', () => {
    render(<HouseholdRosterTable parties={[party({ is_returning: true })]} year={2026} />, {
      wrapper,
    })
    expect(screen.getByText('Returning')).toBeInTheDocument()
  })

  it('shows the arrival ETA when the family gave one', () => {
    render(
      <HouseholdRosterTable parties={[party({ arrival_eta: 'Friday around 4pm' })]} year={2026} />,
      { wrapper }
    )
    expect(screen.getByText('Friday around 4pm')).toBeInTheDocument()
  })

  it('renders a person-grain party for an adult weekend', () => {
    render(
      <HouseholdRosterTable
        parties={[
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 1000004,
            display_name: 'Olivia Chen',
            adults: [{ adult_number: 1, display_name: 'Olivia Chen', relationship: '' }],
            children: [],
            party_size: 1,
          }),
        ]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.getByText('1 adult')).toBeInTheDocument()
  })

  it('keeps household and person parties with colliding ids as distinct rows', () => {
    // The two grains number independently, so a household cm_id can equal a
    // person cm_id. A key built from only one of them would collapse the rows.
    render(
      <HouseholdRosterTable
        parties={[
          party({ household_cm_id: 7, person_cm_id: 0, display_name: 'The Johnson Family' }),
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 7,
            display_name: 'Olivia Chen',
            children: [],
          }),
        ]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText('The Johnson Family')).toBeInTheDocument()
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
  })
})
