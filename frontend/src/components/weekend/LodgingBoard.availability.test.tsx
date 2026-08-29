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

// The board now also mounts `PushWriteInsModal` (kindred#2477 Task 8), which
// calls the real `useApiWithAuth` directly rather than through a wrapped
// hook. Mocked here for the same reason `useUnitAvailability`/`useUnitMerge`
// are above: this tree carries no AuthProvider, and the push queue itself is
// pinned in `PushWriteInsModal.test.tsx` and `LodgingBoard.pushEntry.test.tsx`.
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

const setAvailability = vi.fn((_intent: unknown) => Promise.resolve())
const removeWriteIn = vi.fn((_intent: unknown) => Promise.resolve())
let availabilityOptions: unknown[] = []
let pendingUnitId = ''
vi.mock('../../hooks/useUnitAvailability', () => ({
  useUnitAvailability: (...args: unknown[]) => {
    availabilityOptions.push(args[0])
    return { setAvailability, removeWriteIn, pendingUnitId }
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

    // The Assign PILL since kindred#2072's AS2, and the inline box before it.
    // Named for the write-in alone here, because with no scenario there is
    // nothing to place — the control has always been careful not to name an
    // action the staff member cannot take, and the modal behind it opens as a
    // write-in box only.
    expect(
      screen.getByRole('button', { name: /write in an occupant for cedar 1/i })
    ).toBeInTheDocument()
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

  it('names the weekend AND the board it is writing into', () => {
    // The scenario is what kindred#2382 PR 4 added. Reads REPLACE since PR 3,
    // so a write-in recorded here and written to the LIVE table is replaced
    // away by this scenario's own read — staff record an occupancy and the
    // board they made it on does not show it.
    renderBoard()

    expect(availabilityOptions[0]).toEqual({
      year: 2026,
      sessionCmId: 1000001,
      scenario: SCENARIO,
    })
  })

  it('writes the live board when no scenario is selected', () => {
    // Blank is a SCOPE, not a refusal: staff evaluate the real board, so the
    // mirror keeps its write path. Same prop, same hook, different target.
    renderBoard({ scenario: '' })

    expect(availabilityOptions[0]).toEqual({ year: 2026, sessionCmId: 1000001, scenario: '' })
  })
})

describe('LodgingBoard — the control becomes a write', () => {
  it('sends the unit staff clicked, with the occupant and note they typed', async () => {
    const user = userEvent.setup()
    renderBoard()

    await user.click(screen.getByRole('button', { name: /assign to cedar 2/i }))
    await user.type(screen.getByRole('searchbox'), 'Emma Johnson')
    await user.type(screen.getByLabelText(/note/i), 'paper registration')
    // MAJOR B: a non-null count, typed through the real modal control,
    // exercised all the way through `writeAvailability` — the glue hop the
    // task-9 brief omitted. A `partySize: null` fixture here cannot tell a
    // forwarded value from a hardcoded one; `null` is what a hardcode would
    // produce too.
    // `selectOptions`, not `type` — People is a `<select>` since 2026-08-23
    // (kindred#2540) and `user.type` does not drive one.
    await user.selectOptions(screen.getByLabelText('People'), '3')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(setAvailability).toHaveBeenCalledTimes(1)
    expect(setAvailability).toHaveBeenCalledWith({
      unitId: 'u2',
      unitName: 'Cedar 2',
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      // ★ THE NOTE IS CARRIED AGAIN, and this test's own name finally
      // describes it. The strip collected an optional note beside the
      // occupant; the inline box that replaced it collected a name ONLY and
      // sent `reason: ''`, so recording WHY meant writing the occupant in and
      // then editing it from the pencil on its own card. kindred#2072's modal
      // has the width for the field, so the first write carries it.
      reason: 'paper registration',
      partySize: 3,
      // kindred#2583 step 4. A create RENAMES NOBODY, and says so rather than
      // leaving the field off: `undefined` and `null` reach the server as the
      // same thing here, but a producer that forgets the field is exactly how
      // the pencil's rename would silently become a create.
      previousOccupantName: null,
    })
  })

  it('waits on the card being written, and only that one', async () => {
    // 81 cards share one mutation. A bare `isPending` would freeze the whole
    // board while one cabin is being written into.
    pendingUnitId = 'u1'
    renderBoard()

    // The Assign PILL carries the per-card gate now that the strip button is
    // gone. It matters as much on a pill as it did on the box: the write it
    // starts is a modal away, and a second one submitted against an unsettled
    // first is a duplicate nobody asked for.
    expect(screen.getByRole('button', { name: /assign to cedar 1/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /assign to cedar 2/i })).toBeEnabled()
    await Promise.resolve()
  })
})

describe('LodgingBoard — removing a write-in this card inherited', () => {
  /*
   * The row names one unit; it closes a SPACE. Split a written-into building
   * and its ROOMS inherit the write-in, while the building — no longer drawn —
   * has nowhere to offer a removal from. The room's card carries it, as the X
   * on the `WriteInCard` it draws, and both the write and the in-flight
   * disable have to follow the ROW rather than the card.
   */
  const COVER = {
    unit_id: 'u-house',
    unit_code: 'house',
    unit_name: 'House',
    occupant_name: 'Liam Garcia',
    note: '',
  }
  const room = unit({ unit_id: 'u-room', code: 'house-a', name: 'House A', write_ins: [COVER] })

  it('sends the unit that HOLDS the row, not the card it was clicked on', async () => {
    const user = userEvent.setup()
    renderBoard({ units: [room] })

    await user.click(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' }))

    expect(removeWriteIn).toHaveBeenCalledWith({
      unitId: 'u-house',
      unitName: 'House',
      occupantName: 'Liam Garcia',
    })
  })

  it('does NOT send the clear verb, which would take the whole cabin', async () => {
    /*
     * kindred#2583 step 4, and the obligation #2598 handed down by name.
     *
     * `family_available: null` is CLEAR THIS UNIT ENTIRELY — the staff↔family
     * ROLE row and EVERY occupancy row on the unit. That is identical to
     * "remove this occupant" while a cabin can hold one write-in, which is
     * exactly why it survived this long unnoticed; the moment step 8 narrows
     * the unique index, one click on one occupant's × deletes the co-occupant
     * beside them and the release the cabin was carrying.
     *
     * Asserted as "the clear verb is not sent at all" rather than as a
     * different payload, so re-introducing it fails here rather than passing
     * with new field values.
     */
    const user = userEvent.setup()
    renderBoard({ units: [room] })

    await user.click(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' }))

    expect(setAvailability).not.toHaveBeenCalled()
  })

  it('disables the card while the row it points at is being written', () => {
    // `pendingUnitId` names the unit the WRITE targets, which for an inherited
    // removal is never this card's own id — so keying the disable on the card
    // alone leaves the X live for the whole write and invites a second click
    // on a row that is already going away. Matched with `some` since
    // kindred#2381: a merged card covers several rows and the pending write
    // belongs to whichever one was clicked.
    pendingUnitId = 'u-house'
    renderBoard({ units: [room] })

    expect(screen.getByRole('button', { name: 'Remove write-in Liam Garcia' })).toBeDisabled()
  })
})

describe('LodgingBoard — two occupants in one shareable cabin', () => {
  /*
   * THE STATE THE WHOLE OF kindred#2583 PART 2 EXISTS FOR, and it is
   * UNREACHABLE IN PRODUCTION TODAY: `idx_lodging_write_in_unique` still keys
   * on `(session_cm_id, year, unit)`, so a second row on one unit cannot be
   * created until step 8 narrows it. These tests build the payload the server
   * will publish the moment it does, and pin that the card's two controls
   * address two DIFFERENT rows rather than both reaching whichever the server
   * happened to return first.
   *
   * A `shareable` leaf sleeping 15 holding two paper families is the concrete
   * case: the model says the cabin may hold two, and until now the card could
   * only ever name one of them.
   */
  const SHARED = unit({
    unit_id: 'u-cedar3',
    code: 'cedar-3',
    name: 'Cedar 3',
    sleeps: 15,
    write_ins: [
      {
        unit_id: 'u-cedar3',
        unit_code: 'cedar-3',
        unit_name: 'Cedar 3',
        occupant_name: 'Olivia Chen',
        note: '',
        party_size: 3,
      },
      {
        unit_id: 'u-cedar3',
        unit_code: 'cedar-3',
        unit_name: 'Cedar 3',
        occupant_name: 'Emma Johnson',
        note: '',
        party_size: 4,
      },
    ],
  })

  it('draws one card per occupant', () => {
    renderBoard({ units: [SHARED] })

    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('removes the occupant whose × was clicked, and only that one', async () => {
    const user = userEvent.setup()
    renderBoard({ units: [SHARED] })

    await user.click(screen.getByRole('button', { name: 'Remove write-in Emma Johnson' }))

    expect(removeWriteIn).toHaveBeenCalledTimes(1)
    expect(removeWriteIn).toHaveBeenCalledWith({
      unitId: 'u-cedar3',
      unitName: 'Cedar 3',
      occupantName: 'Emma Johnson',
    })
  })

  it('edits the occupant whose pencil was clicked, naming the row it loaded', async () => {
    // The pencil's save is a COMPARE-AND-SWAP on the name the form opened
    // with. Without it the write is keyed on the NEW name, misses the
    // occupant-keyed finder, and creates a third row beside the two already
    // there — one rename, two occupants called Chen, and the board says
    // nothing.
    const user = userEvent.setup()
    renderBoard({ units: [SHARED] })

    await user.click(screen.getByRole('button', { name: 'Edit write-in Olivia Chen' }))
    const field = screen.getByLabelText('Occupant')
    await user.clear(field)
    await user.type(field, 'Olivia Reyes')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(setAvailability).toHaveBeenCalledWith({
      unitId: 'u-cedar3',
      unitName: 'Cedar 3',
      familyAvailable: false,
      occupantName: 'Olivia Reyes',
      reason: '',
      partySize: 3,
      previousOccupantName: 'Olivia Chen',
    })
  })

  it('names the loaded row even when the edit changes nothing about the name', async () => {
    // An unchanged name is still a swap, deliberately: it is what makes the
    // edit refuse when the row moved under the card, instead of quietly
    // writing a new one. Sending it only on a detected change would put the
    // create back on the path a staff member is most likely to take.
    const user = userEvent.setup()
    renderBoard({ units: [SHARED] })

    await user.click(screen.getByRole('button', { name: 'Edit write-in Emma Johnson' }))
    await user.type(screen.getByLabelText('Note (optional)'), 'back Monday')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(setAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        occupantName: 'Emma Johnson',
        previousOccupantName: 'Emma Johnson',
        reason: 'back Monday',
      })
    )
  })
})

describe('LodgingBoard — an occupant nobody named', () => {
  /*
   * `occupant_name` is permissive at the schema so an ingest or a fixture with
   * no author can write, and a row predating 1500000148 with an empty note
   * backfilled to nothing. ZERO such rows exist in the 2026 data; this is a
   * reachable state rather than an observed one.
   *
   * ⚠️ IT HAS NO ROW-ADDRESSED DELETE, and that is a BOOKED COST of Design B
   * rather than an oversight: `(unit_id, occupant_name)` is the address, and
   * a blank name addresses nothing — `WriteInDeleteRequest` refuses one. So
   * the × keeps sending the clear verb here, which is exactly what it did for
   * every row before this change.
   */
  const UNNAMED = unit({
    unit_id: 'u-cedar4',
    code: 'cedar-4',
    name: 'Cedar 4',
    write_ins: [
      {
        unit_id: 'u-cedar4',
        unit_code: 'cedar-4',
        unit_name: 'Cedar 4',
        occupant_name: '',
        note: '',
      },
    ],
  })

  it('falls back to the clear verb, because a blank name addresses no row', async () => {
    const user = userEvent.setup()
    renderBoard({ units: [UNNAMED] })

    await user.click(screen.getByRole('button', { name: 'Remove write-in Occupant not named' }))

    expect(removeWriteIn).not.toHaveBeenCalled()
    expect(setAvailability).toHaveBeenCalledWith({
      unitId: 'u-cedar4',
      unitName: 'Cedar 4',
      familyAvailable: null,
      occupantName: '',
      reason: '',
      partySize: null,
      // A clear renames nobody, and the server refuses the field on this half
      // outright — `previous_occupant_name` is occupancy-only.
      previousOccupantName: null,
    })
  })

  it('lets the pencil NAME it, addressing the row by its blank name', async () => {
    // The escape hatch, and the reason `previousOccupantName` is `string | null`
    // rather than a blank-means-absent string: `''` is a NAME here. Naming the
    // occupant is the only edit this row's pencil can make — the form refuses
    // to save a blank — and once named it has a row-addressed delete like any
    // other.
    const user = userEvent.setup()
    renderBoard({ units: [UNNAMED] })

    await user.click(screen.getByRole('button', { name: 'Edit write-in Occupant not named' }))
    await user.type(screen.getByLabelText('Occupant'), 'Olivia Chen')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(setAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        occupantName: 'Olivia Chen',
        previousOccupantName: '',
      })
    )
  })
})
