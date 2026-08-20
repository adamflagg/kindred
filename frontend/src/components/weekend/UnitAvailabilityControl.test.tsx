/**
 * The write-in / release control: the writer this table never had.
 *
 * `PUT /api/lodging/availability` shipped with no caller anywhere in the
 * frontend, which is how `lodging_availability` sat unwritten and a request
 * model requiring a scenario nobody could supply went unnoticed. This control
 * is the caller.
 *
 * ONE CONTROL, TWO INPUTS (owner ruling, 2026-08-09, kindred#2078). Hold IS
 * the write-in: there is no separate "mark unavailable" action, and a note
 * reading "burst pipe" rendering as an occupant name is an accepted cost. The
 * control takes a REQUIRED occupant and an OPTIONAL note.
 *
 * Fictional data throughout.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, WriteInCoverRow } from '../../types/lodging'
import { UnitAvailabilityControl } from './UnitAvailabilityControl'

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
    occupant_name: '',
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

const STAFF_CABIN = unit({
  unit_id: 'u2',
  code: 'aspen-lodge',
  name: 'Aspen Lodge',
  inventory_class: 'staff_default',
  is_family_available: false,
})

/**
 * The server-resolved write-in cover — the ONLY way the wire says "somebody is
 * in this space" since kindred#2382 PR 4 retired the
 * `family_available_override === false` shim. That field answers the
 * staff↔family ROLE alone now, which is why the release fixtures below still
 * use it and the write-in fixtures do not.
 */
function cover(overrides: Partial<WriteInCoverRow> = {}): WriteInCoverRow {
  return {
    unit_id: 'u1',
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    occupant_name: 'Emma Johnson',
    note: '',
    ...overrides,
  }
}

const WRITTEN_IN_CABIN = unit({
  write_ins: [cover()],
  occupant_name: 'Emma Johnson',
  reason: '',
  is_family_available: false,
})

function renderControl(props: Partial<React.ComponentProps<typeof UnitAvailabilityControl>> = {}) {
  const onSubmit = vi.fn()
  render(
    <UnitAvailabilityControl
      unit={unit()}
      canManage
      isSaving={false}
      onSubmit={onSubmit}
      {...props}
    />
  )
  return { onSubmit }
}

describe('UnitAvailabilityControl', () => {
  /*
   * ★ THE WRITE-IN PROMPT IS GONE FROM THIS CONTROL (owner ruling, 2026-08-18).
   *
   * Nine tests were deleted here, not weakened — they specified a form this
   * strip no longer mounts. Where each guarantee now lives:
   *
   *   an occupant name is REQUIRED      -> AssignFamilyModal.test.tsx, "will
   *                                        not write in an empty name"
   *   the note is OPTIONAL              -> WriteInCard.test.tsx's edit form,
   *                                        and AssignFamilyModal.test.tsx's
   *                                        "writes in from the Write in button"
   *   name and note never substitute    -> WriteInCard.test.tsx's edit form
   *   a MERGED building can be written  -> LodgingUnitCard.test.tsx, the
   *     into                               Assign pill's own gate
   *   an abandoned form is cleared      -> AssignFamilyModal clears its query
   *                                        and note on write
   *
   * ⚠️ Those pointers named `PlaceFamilyPicker` until kindred#2072's AS2
   * replaced the inline box with `AssignFamilyModal`. Repointed rather than
   * dropped — a pointer into a deleted file is how a guarantee stops being
   * findable and then stops being true.
   *
   * The reason the strip lost it: the card already carried a family box, so
   * every tile offered two typeable rectangles for one question — who is
   * sleeping here — and #2090's gate on this one meant a partly-filled merged
   * building could be written into by neither.
   */

  it('offers nothing without bunking.manage', () => {
    // The same gate as the endpoint. A control that 403s on click is worse
    // than no control: it teaches staff the board is broken.
    renderControl({ canManage: false })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers nothing to write into an OCCUPIED unit — a write-in and a placement are mutually exclusive (#2090)', () => {
    // Nothing, and no longer BECAUSE it is occupied. The strip stopped
    // offering a write-in at all on 2026-08-18 — creating one is the card's
    // own family box — so occupancy is not a dimension this control has any
    // more, and it takes no `occupied` prop to carry it.
    renderControl()

    expect(screen.queryByRole('button', { name: /write in/i })).not.toBeInTheDocument()
  })

  it('offers no write-in on an ordinary family cabin either', () => {
    // The regression guard, inverted by the same ruling: this used to assert
    // the button WAS offered here. A second typeable box beside the card's
    // family picker, both asking who is sleeping in the cabin, is exactly what
    // the ruling removed.
    renderControl()

    expect(screen.queryByRole('button', { name: /write in/i })).not.toBeInTheDocument()
  })

  it('releases a staff cabin to families for this weekend', async () => {
    // Rare and explicit, not absent (spec §3). One season of placements
    // corroborates that staff cabins are never released; it does not prove it.
    const user = userEvent.setup()
    const { onSubmit } = renderControl({ unit: STAFF_CABIN })

    await user.click(screen.getByRole('button', { name: /release/i }))
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Overflow weekend')
    await user.click(screen.getByRole('button', { name: /^release$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      unitId: 'u2',
      unitName: 'Aspen Lodge',
      familyAvailable: true,
      occupantName: '',
      reason: 'Overflow weekend',
    })
  })

  it('asks a release for a reason and NOT for an occupant', () => {
    // Opening a staff cabin to families names nobody. Prompting for an
    // occupant there would ask for a fact that does not exist -- which is why
    // the flag became a three-way prompt rather than staying a boolean.
    renderControl({ unit: STAFF_CABIN })

    expect(screen.queryByRole('textbox', { name: /^occupant$/i })).not.toBeInTheDocument()
  })

  it('still refuses a release with no reason', async () => {
    // The release branch keeps its own required field and its own wording.
    // Reshaping the flag must not quietly retire the guardrail on the branch
    // that still needs it.
    const user = userEvent.setup()
    const { onSubmit } = renderControl({ unit: STAFF_CABIN })

    await user.click(screen.getByRole('button', { name: /release/i }))
    await user.click(screen.getByRole('button', { name: /^release$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say why/i)).toBeInTheDocument()
  })

  it('takes the refusal back as soon as staff start typing', async () => {
    // Generic form behaviour, pinned on the one prompt that still exists. It
    // used to be pinned on the write-in's occupant field; that prompt went
    // with the `hold` action on 2026-08-18.
    const user = userEvent.setup()
    renderControl({ unit: STAFF_CABIN })

    await user.click(screen.getByRole('button', { name: /release/i }))
    await user.click(screen.getByRole('button', { name: /^release$/i }))
    expect(screen.getByText(/say why/i)).toBeInTheDocument()

    await user.type(screen.getByRole('textbox', { name: 'Reason' }), 'B')
    expect(screen.queryByText(/say why/i)).not.toBeInTheDocument()
  })

  it('offers NOTHING on a written-into cabin — the removal is the X on its card', () => {
    // kindred#2381, superseding #2252's "Clear Write-in" label here. That
    // button named whichever row the server resolved first, which was sound
    // only while a card could carry one write-in. A merged container covers
    // every write-in beneath it, so one button had four rows to choose from:
    // each click destroyed the row it named, the card re-populated with the
    // next occupant, and the action read as a no-op. Each `WriteInCard` owns
    // its own removal now.
    renderControl({ unit: WRITTEN_IN_CABIN })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('leaves a write-in\u2019s note to the occupant card and prints no italic line of its own', () => {
    // The note used to sit here, under the badge row, as
    // `text-muted-foreground text-sm italic`. Since kindred#2078 it rides
    // INSIDE the occupant card in the well -- it describes the occupant, not
    // the room -- so printing it here too would put the identical string twice
    // on one card, which is the double-print 1500000148 was written to avoid.
    renderControl({
      unit: unit({
        write_ins: [cover({ note: 'Back Monday' })],
        occupant_name: 'Emma Johnson',
        reason: 'Back Monday',
        is_family_available: false,
      }),
      canManage: false,
    })

    expect(screen.queryByText('Back Monday')).not.toBeInTheDocument()
    expect(screen.queryByText('Emma Johnson')).not.toBeInTheDocument()
  })

  it('shows why a staff cabin was released, to whoever is looking', () => {
    // The one branch that still prints here, and the reason the line survives
    // at all: a release has no occupant and draws no card in the well, so
    // there is nowhere else for its reason to be read. Shown WITHOUT
    // bunking.manage, as before -- reading why a cabin changed hands is not a
    // write, and the staff member who needs it most may not hold the
    // permission.
    renderControl({
      unit: unit({
        inventory_class: 'staff_default',
        family_available_override: true,
        reason: 'Overflow weekend',
        is_family_available: true,
      }),
      canManage: false,
    })

    expect(screen.getByText('Overflow weekend')).toBeInTheDocument()
  })

  it('does not offer a second write while this unit is being written', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderControl({
      unit: unit({ family_available_override: true }),
      isSaving: true,
    })

    await user.click(screen.getByRole('button', { name: 'Clear Cedar 1' }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('offers nothing on a SPLIT container', () => {
    // It gets no card, so there is nothing here to act on.
    renderControl({ unit: unit({ is_container: true }) })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers nothing on a MERGED building — but no longer closes its write-in path', () => {
    // #2090's gate used to leave a partly-filled merged building with NO
    // write-in path at all: refused here, and its rooms have no cards of their
    // own to carry one. The card's family box now takes it, whether or not a
    // family is already placed. See `LodgingUnitCard`'s `canPickFamily`.
    renderControl({ unit: unit({ is_container: true, is_combined: true }) })

    expect(screen.queryByRole('button', { name: /write in/i })).not.toBeInTheDocument()
  })
})

describe('a write-in this unit inherited from elsewhere in the tree', () => {
  /*
   * The row names one unit; it closes a SPACE. Split a written-into building
   * and its rooms inherit the write-in — and the building, having no card any
   * more, has nowhere to offer a removal from. The inheriting CARD carries it,
   * as the X on the `WriteInCard` it draws in its well (kindred#2381); this
   * strip resolves ROLE rows only and stays out of it.
   */
  const ROOM_UNDER_A_WRITTEN_IN_HOUSE = unit({
    unit_id: 'u-room',
    code: 'house-a',
    name: 'House A',
    write_ins: [
      {
        unit_id: 'u-house',
        unit_code: 'house',
        unit_name: 'House',
        occupant_name: 'Liam Garcia',
        note: '',
      },
    ],
  })

  it('offers no strip action at all, rather than one that names a row out of several', () => {
    renderControl({ unit: ROOM_UNDER_A_WRITTEN_IN_HOUSE })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
