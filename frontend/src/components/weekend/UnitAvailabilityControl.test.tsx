/**
 * The reserve/release control: the writer this table never had.
 *
 * `PUT /api/lodging/availability` shipped with no caller anywhere in the
 * frontend, which is how `lodging_availability` reached zero rows and a request
 * model requiring a scenario nobody could supply. This control is the caller.
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

const HELD_CABIN = unit({
  family_available_override: false,
  reason: 'Burst pipe',
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
  it('offers nothing without bunking.manage', () => {
    // The same gate as the endpoint. A control that 403s on click is worse
    // than no control: it teaches staff the board is broken.
    renderControl({ canManage: false })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('holds a family cabin back for this weekend, with the reason staff gave', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /hold/i }))
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Burst pipe')
    await user.click(screen.getByRole('button', { name: /^hold$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ familyAvailable: false, reason: 'Burst pipe' })
  })

  it('releases a staff cabin to families for this weekend', async () => {
    // Rare and explicit, not absent (spec §3). One season of placements
    // corroborates that staff cabins are never released; it does not prove it.
    const user = userEvent.setup()
    const { onSubmit } = renderControl({ unit: STAFF_CABIN })

    await user.click(screen.getByRole('button', { name: /release/i }))
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Overflow weekend')
    await user.click(screen.getByRole('button', { name: /^release$/i }))

    expect(onSubmit).toHaveBeenCalledWith({ familyAvailable: true, reason: 'Overflow weekend' })
  })

  it('will not take a cabin out of service without saying why, and says so', async () => {
    // A row with no reason is the one a staff member cannot act on next week:
    // they can see the cabin is closed and have no way to learn whether the
    // pipe has been fixed.
    //
    // The visible refusal is asserted, not just the absent call. An earlier
    // version disabled the submit button AND guarded in the handler; deleting
    // the guard broke no test, because a click on a disabled button never
    // reaches a handler at all. Two guards masking each other means neither is
    // pinned — so the button stays live and the refusal is a thing you can see.
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /hold/i }))
    await user.click(screen.getByRole('button', { name: /^hold$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say why/i)).toBeInTheDocument()
  })

  it('refuses an empty reason submitted from the keyboard too', async () => {
    // Enter in the text field is a second way into the same handler, and the
    // one a staff member typing quickly will actually use.
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /hold/i }))
    await user.type(screen.getByRole('textbox', { name: /reason/i }), '{Enter}')

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say why/i)).toBeInTheDocument()
  })

  it('treats blank space as no reason at all', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderControl()

    await user.click(screen.getByRole('button', { name: /hold/i }))
    await user.type(screen.getByRole('textbox', { name: /reason/i }), '   ')
    await user.click(screen.getByRole('button', { name: /^hold$/i }))

    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText(/say why/i)).toBeInTheDocument()
  })

  it('takes the refusal back as soon as staff start typing', async () => {
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: /hold/i }))
    await user.click(screen.getByRole('button', { name: /^hold$/i }))
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'B')

    expect(screen.queryByText(/say why/i)).not.toBeInTheDocument()
  })

  it('clears an override in one click, writing null rather than a value that agrees', async () => {
    // `null` DELETES the row. Writing "available" onto a family cabin instead
    // would pin it against a later change to its role -- the reversal-encoding
    // failure spec §5.4 rejected, arriving through the UI.
    const user = userEvent.setup()
    const { onSubmit } = renderControl({ unit: HELD_CABIN })

    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(onSubmit).toHaveBeenCalledWith({ familyAvailable: null, reason: '' })
    expect(screen.queryByRole('textbox', { name: /reason/i })).not.toBeInTheDocument()
  })

  it('shows why a cabin is held, to whoever is looking', async () => {
    // The reason exists to be read next week. It is shown WITHOUT
    // bunking.manage too: knowing a cabin is closed for a burst pipe is not a
    // write, and the staff member who needs it most may not hold the
    // permission.
    renderControl({ unit: HELD_CABIN, canManage: false })

    expect(screen.getByText('Burst pipe')).toBeInTheDocument()
    await Promise.resolve()
  })

  it('does not offer a second write while this unit is being written', async () => {
    const user = userEvent.setup()
    const { onSubmit } = renderControl({ unit: HELD_CABIN, isSaving: true })

    await user.click(screen.getByRole('button', { name: /clear/i }))

    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('offers nothing on a building row', () => {
    renderControl({ unit: unit({ is_container: true }) })

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('abandons the reason when the form is cancelled', async () => {
    // Reopening with the last abandoned reason still in the box is how a
    // burst-pipe note ends up on the wrong cabin.
    const user = userEvent.setup()
    renderControl()

    await user.click(screen.getByRole('button', { name: /hold/i }))
    await user.type(screen.getByRole('textbox', { name: /reason/i }), 'Burst pipe')
    await user.click(screen.getByRole('button', { name: /cancel/i }))
    await user.click(screen.getByRole('button', { name: /hold/i }))

    expect(screen.getByRole('textbox', { name: /reason/i })).toHaveValue('')
  })
})
