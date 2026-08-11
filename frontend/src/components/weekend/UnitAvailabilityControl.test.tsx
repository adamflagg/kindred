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

import type { LodgingUnitRow } from '../../types/lodging'
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

const WRITTEN_IN_CABIN = unit({
  family_available_override: false,
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
      occupied={false}
      isSaving={false}
      onSubmit={onSubmit}
      {...props}
    />
  )
  return { onSubmit }
}

describe('UnitAvailabilityControl', () => {
  it('offers nothing without bunking.manage', () => {
    // The same gate as the endpoint. A control that 403s on click is worse
    // than no control: it teaches staff the board is broken.
    renderControl({ canManage: false })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers nothing to write into an OCCUPIED unit — a write-in and a placement are mutually exclusive (#2090)', () => {
    // A space that already has a family assigned may not also be marked
    // held. `occupied` is a fact from the slot's own parties, kept separate
    // from `canManage`'s permission gate — folding it in there would
    // resurrect the scenario dimension 1500000135 deleted.
    renderControl({ occupied: true })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('still offers to write into an unoccupied unit (regression guard)', () => {
    renderControl({ occupied: false })

    expect(screen.getByRole('button', { name: /write in/i })).toBeInTheDocument()
  })

  it('writes an occupant into a family cabin, with no note at all', async () => {
    // The note is OPTIONAL. This is the common path and the one that must not
    // grow a second required field by accident.
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), 'Emma Johnson')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      familyAvailable: false,
      occupantName: 'Emma Johnson',
      reason: '',
    })
  })

  it('carries the optional note beside the occupant when staff give one', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), 'Liam Garcia')
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Back Monday')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      familyAvailable: false,
      occupantName: 'Liam Garcia',
      reason: 'Back Monday',
    })
  })

  it('accepts a note that is not a person, because there is no second control for one', async () => {
    // The accepted cost, ruled on rather than prevented: a staff member who
    // types "burst pipe" into the occupant field gets a card showing an
    // occupant called "burst pipe". Splitting the two cases was explicitly
    // rejected as not worth a second concept.
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), 'burst pipe')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      familyAvailable: false,
      occupantName: 'burst pipe',
      reason: '',
    })
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

  it('will not write a nameless occupant into a cabin, and says so', async () => {
    // A write-in with no name is a closed room nobody can account for: staff
    // can see it is unavailable and have no way to learn who is in it.
    //
    // The visible refusal is asserted, not just the absent call. An earlier
    // version disabled the submit button AND guarded in the handler; deleting
    // the guard broke no test, because a click on a disabled button never
    // reaches a handler at all. Two guards masking each other means neither is
    // pinned — so the button stays live and the refusal is a thing you can see.
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say who is in it/i)).toBeInTheDocument()
  })

  it('does not let the optional note stand in for the occupant', async () => {
    // The whole point of two fields: a note is not a name, and a write-in
    // with only a note is exactly the state 1500000148 unwound.
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Back Monday')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say who is in it/i)).toBeInTheDocument()
  })

  it('refuses an empty occupant submitted from the keyboard too', async () => {
    // Enter in the text field is a second way into the same handler, and the
    // one a staff member typing quickly will actually use.
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), '{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say who is in it/i)).toBeInTheDocument()
  })

  it('treats blank space as no occupant at all', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), '   ')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say who is in it/i)).toBeInTheDocument()
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
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.click(screen.getByRole('button', { name: /^write in$/i }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), 'E')

    expect(screen.queryByText(/say who is in it/i)).not.toBeInTheDocument()
  })

  it('clears an override in one click, writing null rather than a value that agrees', async () => {
    // `null` DELETES the row. Writing "available" onto a family cabin instead
    // would pin it against a later change to its role -- the reversal-encoding
    // failure spec §5.4 rejected, arriving through the UI.
    const user = userEvent.setup()
    const { onSubmit } = renderControl({ unit: WRITTEN_IN_CABIN })

    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(onSubmit).toHaveBeenCalledWith({ familyAvailable: null, occupantName: '', reason: '' })
    expect(screen.queryByRole('textbox', { name: /^occupant$/i })).not.toBeInTheDocument()
  })

  it('leaves a write-in\u2019s note to the occupant card and prints no italic line of its own', () => {
    // The note used to sit here, under the badge row, as
    // `text-muted-foreground text-sm italic`. Since kindred#2078 it rides
    // INSIDE the occupant card in the well -- it describes the occupant, not
    // the room -- so printing it here too would put the identical string twice
    // on one card, which is the double-print 1500000148 was written to avoid.
    renderControl({
      unit: unit({
        family_available_override: false,
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
    const { onSubmit } = renderControl({ unit: WRITTEN_IN_CABIN, isSaving: true })

    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('offers nothing on a SPLIT container', () => {
    // It gets no card, so there is nothing here to act on.
    renderControl({ unit: unit({ is_container: true }) })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers to write into a MERGED building', async () => {
    // The staff-facing half of the container fix. A merged building IS the
    // card the board draws in place of its rooms, so it is the only surface a
    // write-in for that building can be recorded on -- merging is exactly what
    // takes its rooms' own cards away.
    const user = userEvent.setup()
    const { onSubmit } = renderControl({
      unit: unit({
        unit_id: 'u3',
        code: 'clouds-rest',
        name: 'Clouds Rest',
        is_container: true,
        is_combined: true,
      }),
    })

    await user.click(screen.getByRole('button', { name: 'Write in Clouds Rest' }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), 'Liam Garcia')
    await user.click(screen.getByRole('button', { name: /^write in$/i }))

    expect(onSubmit).toHaveBeenCalledWith({
      familyAvailable: false,
      occupantName: 'Liam Garcia',
      reason: '',
    })
  })

  it('still offers nothing on a MERGED building that holds a family (#2090)', () => {
    renderControl({
      unit: unit({ is_container: true, is_combined: true }),
      occupied: true,
    })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('abandons BOTH fields when the form is cancelled', async () => {
    // Reopening with the last abandoned entry still in the box is how one
    // cabin's occupant ends up written into another. Two fields, two ways to
    // get that wrong.
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: /write in/i }))
    await user.type(screen.getByRole('textbox', { name: /^occupant$/i }), 'Emma Johnson')
    await user.type(screen.getByRole('textbox', { name: /note/i }), 'Back Monday')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByRole('button', { name: /write in/i }))

    expect(screen.getByRole('textbox', { name: /^occupant$/i })).toHaveValue('')
    expect(screen.getByRole('textbox', { name: /note/i })).toHaveValue('')
  })
})
