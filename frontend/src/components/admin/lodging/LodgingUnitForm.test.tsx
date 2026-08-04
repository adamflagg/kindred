/**
 * A unit created without an explicit is_active / inventory_class is
 * invisible AND unclassifiable — PocketBase has no per-field default for
 * bool or select. The form must never let that happen.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const createLodgingUnit = vi.fn()
const updateLodgingUnit = vi.fn()

vi.mock('../../../services/lodgingCrud', () => ({
  createLodgingUnit: (...args: unknown[]) => createLodgingUnit(...args),
  updateLodgingUnit: (...args: unknown[]) => updateLodgingUnit(...args),
}))

const toastError = vi.fn()

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}))

import type { LodgingAreaRecord, LodgingUnitInput, LodgingUnitRecord } from '../../../types/lodging'
import { LodgingUnitForm } from './LodgingUnitForm'

const AREAS: LodgingAreaRecord[] = [
  { id: 'area_1', name: 'North Zone', code: 'NORTH', map_x: 0.3, map_y: 0.2, sort_order: 1 },
]

const UNIT: LodgingUnitRecord = {
  id: 'u1',
  area: 'area_1',
  name: 'Cabin A',
  code: 'cabin-a',
  parent_unit: '',
  map_x: 0.3,
  map_y: 0.2,
  sleeps: 0,
  beds: null,
  max_beds: null,
  bathroom: 'none',
  bathroom_group: '',
  near_bathhouse: false,
  has_power: false,
  has_ac: false,
  has_fridge: false,
  is_accessible: false,
  has_tub: false,
  has_kitchenette: false,
  has_crib: false,
  has_changing_table: false,
  has_shared_fridge: false,
  inventory_class: 'family_pool',
  is_confirmed: false,
  is_active: true,
  is_container: false,
  notes: '',
}

describe('LodgingUnitForm — create', () => {
  it('submits is_active true and an explicit inventory_class', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const onSaved = vi.fn()
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={onSaved} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.is_active).toBe(true)
    expect(payload.inventory_class).toBe('family_pool')
    expect(onSaved).toHaveBeenCalled()
  })

  it('offers no blank option for the allocation default', () => {
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const select = screen.getByLabelText<HTMLSelectElement>('Allocation')
    const values = [...select.options].map((option) => option.value)
    expect(values).toEqual(['family_pool', 'staff_default'])
  })

  it('sends no sleeps value when capacity is left blank', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.sleeps).toBeUndefined()
  })

  it('never submits the API-only "unknown" bathroom token PocketBase would reject', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const bathroom = screen.getByLabelText<HTMLSelectElement>('Bathroom')
    expect([...bathroom.options].map((o) => o.value)).toEqual(['', 'none', 'private', 'shared'])

    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.bathroom).not.toBe('unknown')
  })
})

describe('LodgingUnitForm — edit', () => {
  it('shows a blank capacity field for a stored 0, never "0"', () => {
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Sleeps')).toHaveValue(null)
  })

  it('updates rather than creating', async () => {
    updateLodgingUnit.mockResolvedValue({ ...UNIT })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledWith('u1', expect.anything())
    })
    expect(createLodgingUnit).not.toHaveBeenCalled()
  })

  it('offers confirming amenities, which is what switches the roster fit check on', async () => {
    updateLodgingUnit.mockResolvedValue({ ...UNIT })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    await user.click(screen.getByLabelText('Amenities confirmed by staff'))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.is_confirmed).toBe(true)
  })
})

describe('LodgingUnitForm — code autogeneration', () => {
  it('derives a code from the name on create, so staff never type one', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Name'), 'Cabin North 2')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.code).toBe('cabin-north-2')
  })

  it('does not show the code field by default on create', () => {
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
  })
})

describe('LodgingUnitForm — spec fields Phase C omitted', () => {
  it('offers a parent unit picker that excludes the unit itself', () => {
    const other = {
      ...UNIT,
      id: 'u2',
      name: 'North Lodge',
      code: 'north-lodge',
      is_container: true,
    }
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT, other]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const select = screen.getByLabelText<HTMLSelectElement>('Parent unit')
    const values = [...select.options].map((o) => o.value)
    // '' (no parent) plus the other unit — never itself, which would be a cycle.
    expect(values).toEqual(['', 'u2'])
  })

  it('submits the amenity fields the spec requires', async () => {
    updateLodgingUnit.mockResolvedValue({ ...UNIT })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    await user.click(screen.getByLabelText('Has A/C'))
    await user.click(screen.getByLabelText('Has fridge'))
    await user.click(screen.getByLabelText('Near bathhouse'))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.has_ac).toBe(true)
    expect(payload.has_fridge).toBe(true)
    expect(payload.near_bathhouse).toBe(true)
  })
})

describe('LodgingUnitForm — parent picker safety', () => {
  it('excludes a non-container unit from the parent picker', () => {
    const room = { ...UNIT, id: 'u2', name: 'Plain Room', code: 'plain-room', is_container: false }
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT, room]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const select = screen.getByLabelText<HTMLSelectElement>('Parent unit')
    expect([...select.options].map((o) => o.value)).toEqual([''])
  })

  it("excludes the unit's own descendants, direct and grandchild, so a parent edit cannot create a cycle", () => {
    const child = {
      ...UNIT,
      id: 'u2',
      name: 'Child',
      code: 'child',
      parent_unit: 'u1',
      is_container: true,
    }
    const grandchild = {
      ...UNIT,
      id: 'u3',
      name: 'Grandchild',
      code: 'grandchild',
      parent_unit: 'u2',
      is_container: true,
    }
    const unrelated = {
      ...UNIT,
      id: 'u4',
      name: 'Unrelated Building',
      code: 'unrelated',
      is_container: true,
    }
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT, child, grandchild, unrelated]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    const select = screen.getByLabelText<HTMLSelectElement>('Parent unit')
    expect([...select.options].map((o) => o.value)).toEqual(['', 'u4'])
  })

  it('disables "is a building" once a unit has children, so unticking it cannot orphan them under a non-container parent', () => {
    const container = { ...UNIT, id: 'u1', name: 'Tioga Upstairs', is_container: true }
    const child = { ...UNIT, id: 'u2', name: 'Tioga 1', code: 'tioga-1', parent_unit: 'u1' }
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[container, child]}
        unit={container}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(
      screen.getByLabelText('This row is a building or floor, not a bookable room')
    ).toBeDisabled()
    expect(screen.getByText(/list this as their parent/i)).toBeInTheDocument()
  })

  it('leaves "is a building" editable for a unit with no children', () => {
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(
      screen.getByLabelText('This row is a building or floor, not a bookable room')
    ).not.toBeDisabled()
  })
})

describe('LodgingUnitForm — beds', () => {
  it('shows the suggested occupancy from the bed inventory', async () => {
    const user = userEvent.setup()
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))

    expect(screen.getByText(/Suggested: sleeps 2/i)).toBeInTheDocument()
  })

  it('adopts the suggestion into sleeps only when asked, never silently', async () => {
    const user = userEvent.setup()
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))
    expect(screen.getByLabelText('Sleeps')).toHaveValue(null)

    await user.click(screen.getByRole('button', { name: 'Use suggested' }))
    expect(screen.getByLabelText('Sleeps')).toHaveValue(2)
  })

  it('submits the bed inventory alongside sleeps', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'twin')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.beds).toEqual([{ type: 'twin', count: 1 }])
  })

  it('keeps the row while the count is being retyped, since only X removes a bed', async () => {
    // Selecting "2" and typing "3" empties the field for one keystroke. If
    // that empty value counts as 0 the row is filtered out mid-edit, taking
    // the focused input with it, and staff cannot correct a count at all.
    const user = userEvent.setup()
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))

    const count = screen.getByLabelText('Queen count')
    await user.clear(count)

    expect(screen.getByLabelText('Queen count')).toBeInTheDocument()
  })

  it('still removes a bed through the X button', async () => {
    const user = userEvent.setup()
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))
    await user.click(screen.getByRole('button', { name: 'Remove Queen' }))

    expect(screen.queryByLabelText('Queen count')).not.toBeInTheDocument()
  })
})

/**
 * The flag has to be assembled from three pieces of state the capacity section
 * does not own — `beds` is its own, but `is_confirmed` lives in the amenity
 * object and `is_container` and `max_beds` on the unit. These render through
 * the whole form on purpose: the rule is unit-tested in capacityFlag.test.ts,
 * and what is left to get wrong is the plumbing.
 */
describe('LodgingUnitForm — capacity flag', () => {
  /** derived 4. */
  const BUNKED: LodgingUnitRecord = { ...UNIT, beds: [{ type: 'twin_bunk', count: 2 }] }
  const CONFLICTED: LodgingUnitRecord = { ...BUNKED, sleeps: 8 }

  const renderUnit = (unit: LodgingUnitRecord) =>
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[unit]}
        unit={unit}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

  it('states both numbers when staff claim more than the beds account for', () => {
    renderUnit(CONFLICTED)

    // Worded as a question, not an accusation: half the real conflicts are +1,
    // which usually means a family doubled up rather than a data error.
    expect(screen.getByText(/beds account for 4/i)).toBeInTheDocument()
    expect(screen.getByText(/sleeps says 8/i)).toBeInTheDocument()
  })

  it('offers no one-click fix for a conflict', () => {
    // Adjudicating one means knowing whether there is a mattress on the floor.
    // That is not a click, and a button would invite resolving it as if it were.
    renderUnit(CONFLICTED)

    expect(screen.queryByRole('button', { name: 'Use suggested' })).not.toBeInTheDocument()
  })

  it('never writes sleeps for a conflict, leaving the staff number in the field', () => {
    renderUnit(CONFLICTED)

    expect(screen.getByLabelText('Sleeps')).toHaveValue(8)
  })

  it('says nothing about a unit staff have already confirmed', () => {
    renderUnit({ ...CONFLICTED, is_confirmed: true })

    expect(screen.queryByText(/beds account for/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Suggested: sleeps/i)).not.toBeInTheDocument()
  })

  it('says nothing about a container, whose beds are not the building’s', () => {
    renderUnit({ ...CONFLICTED, is_container: true })

    expect(screen.queryByText(/beds account for/i)).not.toBeInTheDocument()
  })

  it('says nothing when staff sleep fewer people than the beds allow', () => {
    renderUnit({ ...BUNKED, sleeps: 3 })

    expect(screen.queryByText(/beds account for/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/Suggested: sleeps/i)).not.toBeInTheDocument()
  })

  it('offers the suggestion when no staff number exists yet', () => {
    renderUnit({ ...BUNKED, sleeps: 0 })

    expect(screen.getByText(/Suggested: sleeps 4/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Use suggested' })).toBeInTheDocument()
  })

  it('shows the sheet capacity as its own labelled fact', () => {
    // max_beds is the Master Housing `Capacity` column and is NOT a function
    // of the bed list — identical bed text maps to 12, 14, 16 and 20. It is
    // evidence for the person adjudicating, never an input to the rule, so it
    // is rendered outside the flag rather than folded into it.
    renderUnit({ ...CONFLICTED, max_beds: 4 })

    expect(screen.getByText(/sheet capacity: 4/i)).toBeInTheDocument()
  })

  it('shows the sheet capacity on a unit carrying no flag at all', () => {
    // Gating it on the flag would make it read as corroboration for the rule.
    renderUnit({ ...BUNKED, sleeps: 4, max_beds: 6 })

    expect(screen.queryByText(/beds account for/i)).not.toBeInTheDocument()
    expect(screen.getByText(/sheet capacity: 6/i)).toBeInTheDocument()
  })

  it('shows no sheet capacity for a unit the sheet never gave one', () => {
    renderUnit({ ...CONFLICTED, max_beds: null })

    expect(screen.queryByText(/sheet capacity/i)).not.toBeInTheDocument()
  })

  it('shows no sheet capacity for a stored 0, which is how PocketBase spells unknown', () => {
    // The registry FILE carries null for the 15 units the sheet gave no
    // capacity, but PocketBase cannot store NULL in a number column, so they
    // come back over the wire as 0 — see apply_lodging_inventory.py, which
    // says so where it guards max_beds. A `!== null` check alone therefore
    // renders "Sheet capacity: 0" on every one of them: a room for nobody,
    // asserted by a screen that was only ever told nothing.
    renderUnit({ ...CONFLICTED, max_beds: 0 })

    expect(screen.queryByText(/sheet capacity/i)).not.toBeInTheDocument()
  })
})

describe('LodgingUnitForm — clearing capacity on an existing unit', () => {
  // On CREATE a blank field must omit `sleeps`, so PocketBase writes its own 0.
  // On EDIT omitting it leaves the previous number in place, so clearing the
  // field is a silent no-op: the form reopens showing the old value and the
  // staffer believes they cleared it. 0 IS the stored representation of
  // UNKNOWN, so writing it explicitly is the correct expression of "clear
  // this", not a destructive one.
  const SIX: LodgingUnitRecord = { ...UNIT, sleeps: 6 }

  it('writes an explicit 0 when the capacity field is cleared', async () => {
    updateLodgingUnit.mockResolvedValue({ ...SIX })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[SIX]}
        unit={SIX}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Sleeps')).toHaveValue(6)
    await user.clear(screen.getByLabelText('Sleeps'))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.sleeps).toBe(0)
  })

  it('still omits sleeps entirely on create, so PocketBase supplies the default', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u9' })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.sleeps).toBeUndefined()
  })

  it('leaves a real capacity untouched when the field is not cleared', async () => {
    updateLodgingUnit.mockResolvedValue({ ...SIX })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[SIX]}
        unit={SIX}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.sleeps).toBe(6)
  })
})

describe('LodgingUnitForm — an undeliverable code', () => {
  // `code` is the join key `bathroom_group` membership and the roster's
  // `unit_code` both match on. slugify strips everything outside [a-z0-9], so
  // a name with no ASCII alphanumerics collapses to '' — worse than a rejected
  // save, because an empty join key silently matches nothing.
  it('refuses to submit when the name yields no usable code', async () => {
    const user = userEvent.setup()
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), '北棟')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(createLodgingUnit).not.toHaveBeenCalled()
  })

  it('leaves the form usable after refusing', async () => {
    const user = userEvent.setup()
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), '北棟')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(screen.getByRole('button', { name: 'Create unit' })).toBeEnabled()
  })

  it('accepts an explicit code that rescues an otherwise unslugifiable name', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u9' })
    const user = userEvent.setup()
    render(<LodgingUnitForm areas={AREAS} units={[]} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), '北棟')
    await user.click(screen.getByRole('button', { name: /set it manually/i }))
    await user.type(screen.getByLabelText('Code'), 'north-wing')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.code).toBe('north-wing')
  })
})
