/**
 * The board's availability gate, which is NOT the placement gate.
 *
 * Placement needs a scenario: it writes a draft plan. Availability does not —
 * 1500000135 deleted the dimension because a burst pipe closes a cabin in every
 * plan for that weekend — so reusing `canPlace` here would put the deleted
 * dimension back at the UI layer and leave staff looking at the CampMinder
 * mirror unable to close a cabin at all.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
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

vi.mock('../../hooks/useLodgingPlacement', () => ({
  useLodgingPlacement: () => ({ move: vi.fn(), isMoving: false }),
}))

// The board now also writes merges. The merge gesture and its own gate are
// pinned in `LodgingBoard.merge.test.tsx`; this file is about availability.
vi.mock('../../hooks/useUnitMerge', () => ({
  useUnitMerge: () => ({ setCombined: vi.fn(), pendingUnitId: null }),
}))

const setAvailability = vi.fn((_intent: unknown) => Promise.resolve())
let availabilityOptions: unknown[] = []
let pendingUnitId = ''
vi.mock('../../hooks/useUnitAvailability', () => ({
  useUnitAvailability: (...args: unknown[]) => {
    availabilityOptions.push(args[0])
    return { setAvailability, pendingUnitId }
  },
}))

let client: QueryClient

beforeEach(() => {
  vi.clearAllMocks()
  availabilityOptions = []
  pendingUnitId = ''
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

// The board reads its collapsed areas from the query string, so it needs a
// router. `MemoryRouter` rather than a real one, so no `?closed=` written by
// one test can leak into the next.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/weekend/fc1/housing']}>{children}</MemoryRouter>
    </QueryClientProvider>
  )
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
    household_cm_id: 1000001,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

const SCENARIO = 'scn7x2k9qw3mnbv'

function renderBoard(props: Partial<Parameters<typeof LodgingBoard>[0]> = {}) {
  return render(
    <LodgingBoard
      parties={[party()]}
      units={[unit(), unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })]}
      year={2026}
      sessionCmId={1000001}
      scenario={SCENARIO}
      canManage={true}
      {...props}
    />,
    { wrapper }
  )
}

describe('LodgingBoard — the availability gate', () => {
  it('offers the control on the CampMinder mirror, where placement is refused', () => {
    // THE divergence from `canPlace`, and the reason this file exists. Who is
    // sleeping in a cabin is a fact about the weekend, not about a plan: staff
    // must be able to record one without first creating a scenario to record
    // it in.
    renderBoard({ scenario: '' })

    expect(screen.getByRole('button', { name: 'Write in Cedar 1' })).toBeInTheDocument()
  })

  it('offers no control without bunking.manage', () => {
    // The same gate as the endpoint, which is `require_permission(BUNKING_MANAGE)`.
    renderBoard({ canManage: false })

    expect(screen.queryByRole('button', { name: 'Write in Cedar 1' })).not.toBeInTheDocument()
  })

  it('offers no control without a weekend to write into', () => {
    // `session_cm_id` is `gt=0` server-side, and the prop defaults to 0 for the
    // board tests that exercise no writes.
    renderBoard({ sessionCmId: 0 })

    expect(screen.queryByRole('button', { name: 'Write in Cedar 1' })).not.toBeInTheDocument()
  })

  it('names the weekend it is writing into', () => {
    renderBoard()

    expect(availabilityOptions[0]).toEqual({ year: 2026, sessionCmId: 1000001 })
  })
})

describe('LodgingBoard — the control becomes a write', () => {
  it('sends the unit staff clicked, with the occupant and note they typed', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByRole('button', { name: 'Write in Cedar 2' }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), 'Emma Johnson')
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Back Monday')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(setAvailability).toHaveBeenCalledTimes(1)
    expect(setAvailability).toHaveBeenCalledWith({
      unitId: 'u2',
      unitName: 'Cedar 2',
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: 'Back Monday',
    })
  })

  it('waits on the card being written, and only that one', async () => {
    // 81 cards share one mutation. A bare `isPending` would freeze the whole
    // board while one cabin is being written into.
    pendingUnitId = 'u1'
    renderBoard()

    expect(screen.getByRole('button', { name: 'Write in Cedar 1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Write in Cedar 2' })).toBeEnabled()
    await Promise.resolve()
  })
})

describe('LodgingBoard — clearing a write-in this card inherited', () => {
  /*
   * The row names one unit; it closes a SPACE. Split a written-into building
   * and its ROOMS inherit the write-in, while the building — no longer drawn —
   * has nowhere to offer the clear from. The room offers it, and both the write
   * and the in-flight disable have to follow the row rather than the card.
   */
  const COVER = {
    unit_id: 'u-house',
    unit_code: 'house',
    unit_name: 'House',
    occupant_name: 'Liam Garcia',
    note: '',
  }
  const room = unit({ unit_id: 'u-room', code: 'house-a', name: 'House A', write_in: COVER })

  it('sends the unit that HOLDS the row, not the card it was clicked on', async () => {
    const user = userEvent.setup()
    renderBoard({ units: [room] })

    await user.click(screen.getByRole('button', { name: 'Clear House A' }))

    expect(setAvailability).toHaveBeenCalledWith({
      unitId: 'u-house',
      unitName: 'House',
      familyAvailable: null,
      occupantName: '',
      reason: '',
    })
  })

  it('disables the card while the row it points at is being written', async () => {
    // `pendingUnitId` names the unit the WRITE targets, which for an inherited
    // clear is never this card's own id — so keying the disable on the card
    // alone leaves the button live for the whole write and invites a second
    // click on a row that is already going away.
    pendingUnitId = 'u-house'
    renderBoard({ units: [room] })

    expect(screen.getByRole('button', { name: 'Clear House A' })).toBeDisabled()
  })
})
