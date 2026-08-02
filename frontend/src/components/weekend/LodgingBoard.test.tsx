/**
 * The board tab: an unplaced rail beside area-grouped sections of slot cards.
 *
 * With no scenario this is a CampMinder MIRROR and read-only, and the surface
 * has to say so — otherwise a staff member reasonably reads a board as
 * something they can move things on.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { LodgingBoard } from './LodgingBoard'

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

// One client per TEST, built outside the render path. Constructing it inside
// the wrapper body rebuilds it on every render, discarding the cache and
// starting a fresh loading pass underneath assertions that already resolved.
// Same fix as `admin/lodging/LodgingUnitsPanel.test.tsx`.
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

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
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

describe('LodgingBoard — layout', () => {
  it('draws one section per area', () => {
    render(
      <LodgingBoard
        parties={[]}
        units={[
          unit(),
          unit({
            unit_id: 'u2',
            code: 'ridge-1',
            name: 'Ridge 1',
            area_code: 'NR',
            area_name: 'North Ridge',
          }),
        ]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByRole('heading', { name: /Cedar Grove/ })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: /North Ridge/ })).toBeInTheDocument()
  })

  it('collapses an area section', async () => {
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Cedar Grove/ }))
    expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
  })

  it('puts unplaced families in the rail', () => {
    render(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />, { wrapper })
    const rail = screen.getByRole('complementary', { name: /unplaced/i })
    expect(within(rail).getByText('Johnson')).toBeInTheDocument()
  })

  it('admits on the surface that the rail ranking is half-uncomputable', () => {
    // §3.7 wanted "a share request whose partner is not yet placed" too. No
    // request names are resolved to households (spec §7.3, unbuilt), so the
    // partner leg does not exist and the surface must not imply it does.
    render(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />, { wrapper })
    const rail = screen.getByRole('complementary', { name: /unplaced/i })
    expect(within(rail).getByText(/mandatory accommodation only/i)).toBeInTheDocument()
  })

  it('says so when nobody is waiting', () => {
    render(
      <LodgingBoard
        parties={[party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' })]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
    const rail = screen.getByRole('complementary', { name: /unplaced/i })
    expect(within(rail).getByText(/Everyone has a cabin/i)).toBeInTheDocument()
  })
})

describe('LodgingBoard — it is a mirror, and says so', () => {
  it('carries the amber CM badge', () => {
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.getByText(/CampMinder mirror/i)).toBeInTheDocument()
  })

  it('says it is read-only', () => {
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.getByText(/read-only/i)).toBeInTheDocument()
  })

  it('offers nothing draggable', () => {
    const { container } = render(
      <LodgingBoard
        parties={[party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' })]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
    expect(container.querySelector('[draggable="true"]')).toBeNull()
  })
})

describe('LodgingBoard — the consent flag', () => {
  function sharedBoard() {
    return render(
      <LodgingBoard
        parties={[
          party({
            unit_code: 'cedar-1',
            unit_name: 'Cedar 1',
            share: {
              preference: 'no_share',
              proximity: [],
              request_text: '',
              needs_resolution: false,
            },
          }),
          party({
            household_cm_id: 102,
            display_name: 'Garcia',
            unit_code: 'cedar-1',
            unit_name: 'Cedar 1',
            share: {
              preference: 'yes_share',
              proximity: ['with'],
              request_text: '',
              needs_resolution: false,
            },
          }),
        ]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
  }

  it('surfaces the one real sharing conflict on the slot', () => {
    sharedBoard()
    expect(screen.getByText(/said no to sharing/i)).toBeInTheDocument()
  })

  it('summarises the flag count at the top of the board', () => {
    sharedBoard()
    expect(screen.getByText(/1 shared cabin needs a look/i)).toBeInTheDocument()
  })

  it('says nothing when there is nothing to flag', () => {
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.queryByText(/needs a look/i)).not.toBeInTheDocument()
  })
})

describe('LodgingBoard — nobody disappears', () => {
  it('lists a party placed on something the board cannot draw', () => {
    // A merge has no unit code, so there is no card for it. Dropping the
    // party would make the board quietly disagree with the roster.
    render(
      <LodgingBoard
        parties={[party({ unit_code: '', unit_name: 'Cedar 3 + Cedar 4', is_merged_slot: true })]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.getByText(/Placed outside the board/i)).toBeInTheDocument()
    expect(screen.getByText('Johnson')).toBeInTheDocument()
  })

  it('does not draw that section when everything fits on the board', () => {
    render(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.queryByText(/Placed outside the board/i)).not.toBeInTheDocument()
  })
})

describe('LodgingBoard — the detail panel', () => {
  it('opens on a family card and shows the request text the card withheld', async () => {
    render(
      <LodgingBoard
        parties={[
          party({
            unit_code: 'cedar-1',
            unit_name: 'Cedar 1',
            share: {
              preference: 'yes_share',
              proximity: ['with'],
              request_text: 'Hoping for a cabin near the creek.',
              needs_resolution: false,
            },
          }),
        ]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
    expect(screen.queryByText('Hoping for a cabin near the creek.')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByText('Hoping for a cabin near the creek.')).toBeInTheDocument()
  })
})

describe('LodgingBoard — an empty registry', () => {
  it('explains an empty board instead of rendering nothing', () => {
    render(<LodgingBoard parties={[]} units={[]} year={2026} />, { wrapper })
    expect(screen.getByText(/No lodging units in the registry yet/i)).toBeInTheDocument()
  })
})
