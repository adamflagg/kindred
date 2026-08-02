/**
 * The detail panel is what makes §3.8's omissions a DEFERRAL rather than a
 * loss — request text and the medical narrative are one click away, not gone.
 *
 * It mirrors `CamperDetailsPanel`'s interaction contract and reuses none of
 * its 1442 camper-coupled lines.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'

const isAdmin = { value: true }

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: isAdmin.value,
    permissions: [],
    hasPermission: () => isAdmin.value,
    hasAnyPermission: () => isAdmin.value,
  }),
}))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

const REQUEST_TEXT = 'We would like to be near the Garcia family if there is room.'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
    adults: [
      { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
      { adult_number: 2, display_name: 'David Johnson', relationship: 'Father' },
    ],
    children: [{ person_cm_id: 9001, display_name: 'Noah Johnson', age: 8, grade: 3 }],
    party_size: 3,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: 'Friday 6pm',
    is_returning: true,
    share: {
      preference: 'yes_share',
      proximity: ['with'],
      request_text: REQUEST_TEXT,
      needs_resolution: false,
    },
    flags: { has_medical_narrative: true },
    ...overrides,
  }
}

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    allocation_default: 'family_pool',
    reservation_state: null,
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

beforeEach(() => {
  isAdmin.value = true
})

describe('FamilyDetailsPanel — the content the card omits', () => {
  it('shows the verbatim request text, one click from the board', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText(REQUEST_TEXT)).toBeInTheDocument()
  })

  it('offers the medical reveal, which the card never does', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByRole('button', { name: /medical detail/i })).toBeInTheDocument()
  })

  it('does not offer the medical reveal for an adult-weekend party', () => {
    // A person-grain party has no household, so there is nothing to look a
    // narrative up by and the reveal could only ever fail.
    render(
      <FamilyDetailsPanel
        party={party({
          grain: 'person',
          household_cm_id: 0,
          person_cm_id: 5001,
          adults: [],
          children: [],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.queryByRole('button', { name: /medical detail/i })).not.toBeInTheDocument()
  })
})

describe('FamilyDetailsPanel — household identity', () => {
  it('names the household', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'Johnson' })).toBeInTheDocument()
  })

  it('lists adults with their relationships', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Mother')).toBeInTheDocument()
    expect(screen.getByText('David Johnson')).toBeInTheDocument()
  })

  it('lists children with ages and grades', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText('Noah Johnson')).toBeInTheDocument()
    expect(screen.getByText(/Age 8/)).toBeInTheDocument()
  })

  it('reports party size, arrival and returning status', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText(/Friday 6pm/)).toBeInTheDocument()
    expect(screen.getByText('Returning')).toBeInTheDocument()
  })
})

describe('FamilyDetailsPanel — current placement', () => {
  it('names the unit and its area', () => {
    render(<FamilyDetailsPanel party={party()} unit={unit()} year={2026} onClose={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Cedar Grove')).toBeInTheDocument()
  })

  it('says a merged slot is a merge', () => {
    render(
      <FamilyDetailsPanel
        party={party({ unit_code: '', unit_name: 'Cedar 3 + Cedar 4', is_merged_slot: true })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('Cedar 3 + Cedar 4')).toBeInTheDocument()
    expect(screen.getByText('Merged')).toBeInTheDocument()
  })

  it('says an unplaced party has no cabin yet', () => {
    render(
      <FamilyDetailsPanel
        party={party({ unit_code: '', unit_name: '' })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('No cabin yet')).toBeInTheDocument()
  })

  it('reports the fit verdict', () => {
    render(
      <FamilyDetailsPanel
        party={party({ flags: { needs_power: true } })}
        unit={unit()}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('Fit not verified')).toBeInTheDocument()
  })
})

describe('FamilyDetailsPanel — interaction contract', () => {
  it('marks itself so the board click-outside handler can spare it', () => {
    const { container } = render(
      <FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />,
      { wrapper }
    )
    expect(container.querySelector('[data-panel="family-details"]')).toBeInTheDocument()
  })

  it('lays a click-outside catcher over the page', () => {
    const { container } = render(
      <FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />,
      { wrapper }
    )
    expect(container.querySelector('.pointer-events-none.fixed.inset-0')).toBeInTheDocument()
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={onClose} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }))
    // The slide-out animation runs first; jsdom fires animationend only when
    // driven, so the close is requested rather than immediate.
    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
  })

  it('drops the overlay chrome in embedded mode, so the map can reuse it', () => {
    // One component, both surfaces — a second implementation is exactly what
    // this prop exists to prevent.
    const { container } = render(
      <FamilyDetailsPanel party={party()} year={2026} embedded={true} onClose={vi.fn()} />,
      { wrapper }
    )
    expect(container.querySelector('.pointer-events-none.fixed.inset-0')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Johnson' })).toBeInTheDocument()
  })

  it('closes immediately in embedded mode, where there is no slide-out', async () => {
    const onClose = vi.fn()
    render(<FamilyDetailsPanel party={party()} year={2026} embedded={true} onClose={onClose} />, {
      wrapper,
    })
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('runs the exit animation when the parent requests a close', () => {
    render(
      <FamilyDetailsPanel party={party()} year={2026} requestClose={true} onClose={vi.fn()} />,
      { wrapper }
    )
    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
  })
})
