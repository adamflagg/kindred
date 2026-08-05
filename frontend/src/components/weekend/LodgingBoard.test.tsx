/**
 * The board tab: area-grouped sections of slot cards, with the unplaced
 * families in the floating corner queue rather than a rail.
 *
 * With no scenario this is a CampMinder MIRROR and read-only, and the surface
 * has to say so — otherwise a staff member reasonably reads a board as
 * something they can move things on.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
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

// The board reaches auth through `useLodgingPlacement` now. It renders inside
// AuthProvider in the app; here the provider would be pure ceremony, and these
// tests never write.
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
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
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
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

  it('spaces the card grid on summer’s gap-3', () => {
    /*
     * `BunkingBoardByArea` lays its bunks out at `gap-3` (12px); this board
     * ran at `gap-2.5` (10px). Two pixels, but it is the same grammar
     * mismatch as the type scale was — summer uses the stock scale and this
     * board reached for a half-step beside it (CLAUDE.md §4).
     *
     * Both grids, not one: the off-board section is the same grid of the same
     * cards, and a 2px disagreement between the two is the kind of thing that
     * survives for a year because nobody sees them adjacent.
     *
     * Classes, not computed style — jsdom parses no Tailwind.
     */
    const { container } = render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, {
      wrapper,
    })
    const grids = [...container.querySelectorAll('[data-unit-card]')].map((c) => c.parentElement)
    expect(grids.length).toBeGreaterThan(0)
    for (const grid of grids) {
      expect(grid).toHaveClass('gap-3')
      expect(grid).not.toHaveClass('gap-2.5')
    }
  })

  it('collapses an area section', async () => {
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Cedar Grove/ }))
    expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
  })

  it('has no unplaced rail eating the width', () => {
    // The rail cost 240px of every board, permanently, for a list that is
    // usually short. Summer has never had one.
    render(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.queryByRole('complementary', { name: /unplaced/i })).not.toBeInTheDocument()
  })

  it('puts unplaced parties in the corner queue', async () => {
    render(<LodgingBoard parties={[party()]} units={[unit()]} year={2026} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /1 unplaced parties/i }))
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Johnson')
  })

  it('says so when nobody is waiting', async () => {
    render(
      <LodgingBoard
        parties={[party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' })]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /0 unplaced parties/i }))
    expect(screen.getByText(/Everyone has a cabin/i)).toBeInTheDocument()
  })
})

describe('LodgingBoard — the mode belongs to the header', () => {
  it('does not repeat the mode over the content', () => {
    // The header's ModeBadge is the one indicator, as it is on summer's
    // bunking board — which carries no chip of its own. Two indicators is one
    // more than can be kept honest: the chip here was hardcoded amber and went
    // on claiming the mirror after #1967 let staff select a draft.
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.queryByText(/CampMinder mirror/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/read-only/i)).not.toBeInTheDocument()
  })

  it('offers nothing draggable', () => {
    // Asserts on `aria-roledescription`, which is what dnd-kit actually sets.
    // This previously looked for `[draggable="true"]` — the HTML5 attribute
    // dnd-kit never uses — so it would have kept passing after drag shipped,
    // which is the one thing it exists to catch.
    const { container } = render(
      <LodgingBoard
        parties={[party({ unit_code: 'cedar-1', unit_name: 'Cedar 1' })]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
    expect(container.querySelector('[aria-roledescription="draggable"]')).toBeNull()
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
              eligibility: 'declined',
              eligibility_source: 'form',
              answers_conflict: false,
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
              eligibility: 'open',
              eligibility_source: 'form',
              answers_conflict: false,
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
    // Exact text, not a regex: FamilyCard also renders a "Declined sharing"
    // chip for the party itself, and a loose match cannot tell the slot's
    // flag from the card's chip.
    expect(screen.getByText('1 family did not request sharing')).toBeInTheDocument()
  })

  it('summarises the flag count at the top of the board', () => {
    sharedBoard()
    expect(screen.getByText(/1 shared cabin needs a look/i)).toBeInTheDocument()
  })

  it('says nothing when there is nothing to flag', () => {
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.queryByText(/needs a look/i)).not.toBeInTheDocument()
  })

  // HANDOFF §4 defers two consent questions to the drag PR — does a named
  // partner count as mutual, and does silence count as consent — with the
  // instruction to SAY ON THE SURFACE what the board flags on. The code had
  // already answered both (`named` does not flag, `unknown` does); what was
  // missing was staff being able to read the rule anywhere. Once staff can
  // create a shared cabin by dragging, an unexplained amber flag is a rule
  // they have to reverse-engineer from behaviour.
  it('states the rule it flags on, so an amber cabin is not a mystery', () => {
    sharedBoard()
    const rule = screen.getByTestId('consent-rule')
    // Silence is NOT consent — the household is chased for the form, not
    // moved. Matched without the apostrophe on purpose: the copy uses a
    // typographic ’, and pinning punctuation makes the test fail on a
    // rewording that changes nothing about the rule.
    expect(rule).toHaveTextContent(/answered the cabin form/i)
    // A named partner is not verified mutual: that needs request names
    // resolved to households (spec §7.3, unbuilt), so staff judge from the
    // panel rather than the board refusing.
    expect(rule).toHaveTextContent(/not checked for mutual/i)
  })

  it('does not lecture when no cabin is flagged', () => {
    render(<LodgingBoard parties={[]} units={[unit()]} year={2026} />, { wrapper })
    expect(screen.queryByTestId('consent-rule')).not.toBeInTheDocument()
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

describe('LodgingBoard — the card gets the registry its sharing chip needs', () => {
  it('chips a container-named household against one named a room beneath it', () => {
    // WIRING, not logic. `overlappingPartyKeys` is the one definition of
    // overlap and it expands a container code to its rooms — but only if it is
    // handed the registry. `buildBoard` always has it; `LodgingUnitCard` takes
    // it as an OPTIONAL prop defaulting to `[]` (so the many leaf-card tests
    // need not pass one), which means the board silently dropping `units` here
    // restores the exact bug the expansion exists to fix, one level up, with
    // the card's own unit tests still green because they pass `units`
    // directly. This is the assertion that fails if that prop goes missing.
    render(
      <LodgingBoard
        parties={[
          party({
            household_cm_id: 101,
            display_name: 'Alpha',
            unit_code: 'house',
            unit_name: 'The House',
            share: { eligibility: 'declined' },
          }),
          party({
            household_cm_id: 102,
            display_name: 'Beta',
            unit_code: 'r1',
            unit_name: 'Room 1',
            share: { eligibility: 'declined' },
          }),
        ]}
        units={[
          unit({ unit_id: 'uh', code: 'house', name: 'The House', is_container: true }),
          unit({ unit_id: 'u_r1', code: 'r1', name: 'Room 1', parent_code: 'house' }),
          unit({ unit_id: 'u_r2', code: 'r2', name: 'Room 2', parent_code: 'house' }),
        ]}
        year={2026}
      />,
      { wrapper }
    )
    // Alpha fans down onto both rooms; Beta holds `r1`. They overlap in `r1`,
    // so both carry the per-party chip there. Alpha's copy on `r2` is nobody's
    // share, which is why this is 2 and not 3.
    expect(screen.getAllByText('Did not request sharing')).toHaveLength(2)
  })
})

describe('LodgingBoard — an empty registry', () => {
  it('explains an empty board instead of rendering nothing', () => {
    render(<LodgingBoard parties={[]} units={[]} year={2026} />, { wrapper })
    expect(screen.getByText(/No lodging units in the registry yet/i)).toBeInTheDocument()
  })
})

describe('LodgingBoard — the details panel updates in place', () => {
  it('does not remount the panel when a second family is opened', async () => {
    // Summer's panel is unkeyed, so switching campers updates it rather than
    // sliding it out and back in. A remount would replay the entrance
    // animation for a panel that never left the screen.
    render(
      <LodgingBoard
        parties={[
          party({ display_name: 'Johnson Household', sort_name: 'Johnson', household_cm_id: 101 }),
          party({ display_name: 'Chen Household', sort_name: 'Chen', household_cm_id: 102 }),
        ]}
        units={[unit()]}
        year={2026}
      />,
      { wrapper }
    )
    // Both parties are left unplaced (no unit_code/unit_name override) so
    // both cards are reachable from the corner queue and the panel can be
    // switched between them without touching the board itself.
    await userEvent.click(screen.getByRole('button', { name: /2 unplaced parties/i }))
    await userEvent.click(screen.getByRole('button', { name: /Johnson Household/ }))
    const first = screen.getByTestId('family-details-panel')

    await userEvent.click(screen.getByRole('button', { name: /Chen Household/ }))
    const second = screen.getByTestId('family-details-panel')

    expect(second).toBe(first)
    expect(second).toHaveTextContent('Chen Household')
  })
})
