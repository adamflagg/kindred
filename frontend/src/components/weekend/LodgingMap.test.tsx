/**
 * The map surface. Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { LodgingMap } from './LodgingMap'

// Opening a family opens FamilyDetailsPanel, which reaches AccessibilityFlagList
// -> usePermissions -> useAuth and throws without a provider. Mocked exactly as
// LodgingBoard.test.tsx and FamilyDetailsPanel.test.tsx do, because the same
// panel is being opened here.
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

// One client per TEST, built outside the render path. Constructing it inside the
// wrapper body rebuilds it on every render, discarding the cache and starting a
// fresh loading pass underneath assertions that already resolved.
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 4,
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
    map_x: 0.4,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 9001,
    person_cm_id: 0,
    display_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
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

const UNITS = [
  unit(),
  unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2', map_x: 0.7, map_y: 0.2 }),
]

/** One party in cedar-1, so a mark has an occupant to open. */
const PLACED = party({ display_name: 'Johnson', unit_code: 'cedar-1', unit_name: 'Cedar 1' })

describe('LodgingMap', () => {
  it('draws a mark for every positioned room', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getAllByTestId('map-mark')).toHaveLength(2)
  })

  it('still draws the marks when the camp map image fails to load', () => {
    // A fresh clone without the private repo, and CI, have no asset. An empty
    // box reads as "no cabins" rather than "the picture is missing".
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    fireEvent.error(screen.getByTestId('map-backdrop'))
    expect(screen.getAllByTestId('map-mark')).toHaveLength(2)
    expect(screen.getByText(/map image unavailable/i)).toBeInTheDocument()
  })

  it('says it is a read-only CampMinder mirror, as the board does', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByText(/CampMinder mirror, read-only/i)).toBeInTheDocument()
  })

  it('opens a popover when a mark is clicked', async () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
  })

  it('lists an unplaced party on the unplaced rail', () => {
    render(<LodgingMap parties={[party({ display_name: 'Silva' })]} units={UNITS} year={2026} />)
    expect(screen.getByText('Silva')).toBeInTheDocument()
  })

  it('lists a merged party as placed but off the map, never as unplaced', () => {
    const merged = party({
      display_name: 'Nguyen',
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      is_merged_slot: true,
    })
    render(<LodgingMap parties={[merged]} units={UNITS} year={2026} />)
    const rail = screen.getByTestId('map-offmap-rail')
    expect(rail).toHaveTextContent('Nguyen')
  })

  it('opens the family panel embedded in the sidebar, not as an overlay', async () => {
    // FamilyDetailsPanel exists in one copy for both surfaces; `embedded` is the
    // mode it provides for this one. Its embedded branch renders the
    // family-details-panel testid without the overlay's click-outside layer.
    render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />, { wrapper })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
  })

  it('reports rooms nobody has positioned rather than dropping them silently', () => {
    render(
      <LodgingMap
        parties={[]}
        units={[...UNITS, unit({ unit_id: 'u3', code: 'cedar-3', map_x: 0, map_y: 0 })]}
        year={2026}
      />
    )
    expect(screen.getByText(/1 room has no position/i)).toBeInTheDocument()
  })
})
