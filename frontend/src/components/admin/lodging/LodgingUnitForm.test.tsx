/**
 * A unit created without an explicit is_active / inventory_class is
 * invisible AND unclassifiable — PocketBase has no per-field default for
 * bool or select. The form must never let that happen.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={onSaved} onCancel={vi.fn()} />
    )

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

  it('stamps a new unit with the current season', async () => {
    // Units are year-scoped since 1500000140; an omitted year fails the
    // schema's min:2010 the moment the create reaches PocketBase.
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2027} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.year).toBe(2027)
  })

  it('offers no blank option for the allocation default', () => {
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    const select = screen.getByLabelText<HTMLSelectElement>('Allocation')
    const values = [...select.options].map((option) => option.value)
    expect(values).toEqual(['family_pool', 'staff_default'])
  })

  it('sends no sleeps value when capacity is left blank', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
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

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
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
        year={2026}
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
        year={2026}
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
        year={2026}
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

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    await user.type(screen.getByLabelText('Name'), 'Cabin North 2')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.code).toBe('cabin-north-2')
  })

  it('does not show the code field by default on create', () => {
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
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
        year={2026}
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
        year={2026}
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
        year={2026}
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
        year={2026}
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
        year={2026}
        unit={container}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(
      screen.getByLabelText('This is a building or building area with multiple bedrooms.')
    ).toBeDisabled()
    expect(screen.getByText(/list this as their parent/i)).toBeInTheDocument()
  })

  it('leaves "is a building" editable for a unit with no children', () => {
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        year={2026}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    expect(
      screen.getByLabelText('This is a building or building area with multiple bedrooms.')
    ).not.toBeDisabled()
  })
})

describe('LodgingUnitForm — beds', () => {
  it('shows the suggested occupancy from the bed inventory', async () => {
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))

    expect(screen.getByText(/Suggested: sleeps 2/i)).toBeInTheDocument()
  })

  it('adopts the suggestion into sleeps only when asked, never silently', async () => {
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))
    expect(screen.getByLabelText('Sleeps')).toHaveValue(null)

    await user.click(screen.getByRole('button', { name: 'Use suggested' }))
    expect(screen.getByLabelText('Sleeps')).toHaveValue(2)
  })

  it('submits the bed inventory alongside sleeps', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
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
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))

    const count = screen.getByLabelText('Queen count')
    await user.clear(count)

    expect(screen.getByLabelText('Queen count')).toBeInTheDocument()
  })

  it('still removes a bed through the X button', async () => {
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))
    await user.click(screen.getByRole('button', { name: 'Remove Queen' }))

    expect(screen.queryByLabelText('Queen count')).not.toBeInTheDocument()
  })
})

/**
 * The flag has to be assembled from three pieces of state the capacity section
 * does not own — `beds` is its own, but `is_confirmed` lives in the amenity
 * object and `is_container` lives on the unit. These render through
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
        year={2026}
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

  it('keeps the live region mounted even with nothing to announce', () => {
    // THE LOAD-BEARING ONE. A live region is only announced when its contents
    // change while it is ALREADY in the document. Rendering the region and its
    // text together — the obvious one-liner — is missed by several screen
    // readers, so the region has to outlive the advisory it carries. A unit
    // with nothing to say is exactly the state a staffer is in just BEFORE
    // typing the number that creates the conflict.
    renderUnit({ ...BUNKED, sleeps: 3 })

    const region = screen.getByRole('status')
    expect(region).toBeInTheDocument()
    expect(region).toHaveAttribute('aria-live', 'polite')
    expect(region).toHaveTextContent('')
  })

  it('announces the conflict rather than only drawing it', () => {
    // Focus stays in the Sleeps field when this appears, so without a live
    // region a screen-reader user is never told. The flag's whole job is to be
    // noticed; drawing it in amber does that for one class of user only.
    renderUnit(CONFLICTED)

    expect(screen.getByRole('status')).toHaveTextContent('Beds account for 4, but sleeps says 8.')
  })

  it('announces the suggestion too', () => {
    renderUnit({ ...BUNKED, sleeps: 0 })

    expect(screen.getByRole('status')).toHaveTextContent(/Suggested: sleeps 4/i)
  })

  it('carries the conflict once, not as a second hidden copy', () => {
    // The other obvious implementation is an sr-only duplicate beside the
    // visible text. It makes anyone navigating the form linearly meet the same
    // sentence twice, so the region WRAPS the visible text instead.
    renderUnit(CONFLICTED)

    expect(screen.getAllByText(/beds account for 4/i)).toHaveLength(1)
  })

  it('leaves the conflict readable on mount, not only when it changes', () => {
    // A live region announces on CHANGE and never on mount. Hiding the visible
    // text in favour of an sr-only announcement therefore reports an ALREADY
    // conflicting unit to nobody — the staffer who opens the form rather than
    // creating the conflict by typing gets silence and an invisible warning.
    renderUnit(CONFLICTED)

    const text = screen.getByText(/beds account for 4, but sleeps says 8/i)
    expect(text).not.toHaveAttribute('aria-hidden')
    expect(screen.getByRole('status')).toContainElement(text)
  })

  it('never shows the sheet capacity, which is not a corroborating number', () => {
    // The Master Housing `Capacity` column agrees with the bed count on only
    // 42 of the 88 units carrying both, and sits BELOW the physical bed count
    // on 33 — thirty at exactly -1, with no cause derivable from the beds.
    // Half the conflicts this flag raises are themselves ±1, so showing a
    // column with ±1 systematic noise beside them would lend a confidence it
    // has not earned.
    renderUnit(CONFLICTED)

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
        year={2026}
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

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
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
        year={2026}
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
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.type(screen.getByLabelText('Name'), '北棟')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(createLodgingUnit).not.toHaveBeenCalled()
  })

  it('leaves the form usable after refusing', async () => {
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

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
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

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

describe('LodgingUnitForm — fields staff have no use for', () => {
  const renderUnit = (unit: LodgingUnitRecord) =>
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[unit]}
        year={2026}
        unit={unit}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

  it('never offers the code when editing an existing unit', () => {
    // The code is a JOIN KEY, not a name. apply_lodging_inventory.py matches
    // units by it, so changing one orphans the unit from the registry and the
    // next --apply creates a second copy of it. Nothing in the admin UI
    // displays a code either — it is not a column in UNIT_SORT_COLUMNS — so
    // there is no context in which a staffer needs to read one, let alone
    // retype it.
    renderUnit(UNIT)

    expect(screen.queryByLabelText('Code')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /set it manually/i })).not.toBeInTheDocument()
  })

  it('still offers the code on create, which is the one place it is needed', () => {
    // slugify keeps only [a-z0-9], so a name with no ASCII alphanumerics
    // derives to '' and the form refuses the save outright. The manual escape
    // is the only way past that, and it exists solely for create.
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    expect(screen.getByRole('button', { name: /set it manually/i })).toBeInTheDocument()
  })

  it('asks for no map coordinates, which mean nothing without the map', () => {
    // Typing 0.4389 into a number field is not how a pin gets placed; dragging
    // it on the map view is. Omitting the keys leaves any stored coordinate
    // untouched on update, exactly as a blank field did.
    renderUnit(UNIT)

    expect(screen.queryByLabelText('Map X')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Map Y')).not.toBeInTheDocument()
    expect(screen.queryByText(/map position/i)).not.toBeInTheDocument()
  })

  it('leaves a stored coordinate alone when saving a unit that has one', async () => {
    updateLodgingUnit.mockResolvedValue({ ...UNIT })
    const user = userEvent.setup()
    renderUnit({ ...UNIT, map_x: 0.4389, map_y: 0.3311 })

    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload).not.toHaveProperty('map_x')
    expect(payload).not.toHaveProperty('map_y')
  })
})

describe('LodgingUnitForm — wording staff can act on', () => {
  it('describes a container by what it is, not by what it is not', () => {
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    expect(
      screen.getByLabelText('This is a building or building area with multiple bedrooms.')
    ).toBeInTheDocument()
  })

  it('says what "in use" costs, since retiring is the alternative to deleting', () => {
    // A unit with placements CANNOT be deleted — guardUnitDelete refuses it —
    // and deactivating is the documented way out. "Active" never said that, so
    // the only route a staffer had was the one the server rejects.
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    expect(screen.getByLabelText('In use')).toBeInTheDocument()
    expect(screen.getByText(/past housing records are kept/i)).toBeInTheDocument()
  })
})

describe('LodgingUnitForm — a rejected save says what to change', () => {
  it('names the field PocketBase rejected, instead of "Failed to create record."', async () => {
    // `code` carries a UNIQUE index, so a collision is refused — correctly.
    // But the SDK's top-level message is generic and the useful part sits in
    // `response.data.<field>.message`, so the staffer got a red toast with no
    // reason and a form they could not submit. A correct rejection that does
    // not say what to change is the same dead end as no validation at all.
    const rejection = Object.assign(new Error('Failed to create record.'), {
      response: {
        data: { code: { code: 'validation_not_unique', message: 'Value must be unique.' } },
      },
    })
    createLodgingUnit.mockRejectedValue(rejection)
    const user = userEvent.setup()

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/code/i)
    expect(String(toastError.mock.calls[0]?.[0])).toMatch(/unique/i)
  })

  it('falls back to the plain message when the error carries no field detail', async () => {
    createLodgingUnit.mockRejectedValue(new Error('Network request failed'))
    const user = userEvent.setup()

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Network request failed')
    })
  })
})

describe('LodgingUnitForm — the bathroom group is an exact-match id', () => {
  it('offers the groups already in use, so one is picked rather than retyped', async () => {
    // Units share a bathroom by carrying the SAME string. Nothing validates
    // it, so `hc-upstairs-hal` silently makes a group of one and the roster
    // stops matching that family on a shared bathroom — with no error anywhere.
    // Suggesting the existing ids makes the common case a choice, not a
    // spelling test, while leaving a new group typeable.
    const peers = [
      { ...UNIT, id: 'u2', code: 'b', bathroom_group: 'hc-upstairs-hall' },
      { ...UNIT, id: 'u3', code: 'c', bathroom_group: 'hc-upstairs-hall' },
      { ...UNIT, id: 'u4', code: 'd', bathroom_group: 'gt-clouds-rest' },
    ]
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={peers}
        year={2026}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const field = screen.getByLabelText('Shares a bathroom with')
    const listId = field.getAttribute('list')
    expect(listId).toBeTruthy()

    const options = [...document.querySelectorAll(`#${listId ?? ''} option`)].map((o) =>
      o.getAttribute('value')
    )
    // Deduplicated — two units in one group is one suggestion, not two.
    expect(options).toEqual(['gt-clouds-rest', 'hc-upstairs-hall'])
  })
})

describe('LodgingUnitForm — only the X removes a bed', () => {
  it('keeps the chip when the count is typed down to 0', async () => {
    // setCount treats <= 0 as a removal, which is what the X button uses. The
    // count input reaching it means a staffer clearing the field to retype
    // loses the chip and the focus inside it — the same mid-edit removal the
    // blank guard was written to prevent, arriving through "0" instead.
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))

    // fireEvent.change, not clear()+type(): the input is CONTROLLED, so
    // clearing re-renders it back to the stored count and the typed 0 lands as
    // "10". Selecting all and typing 0 replaces the value atomically, which is
    // what this reproduces and what a staffer actually does.
    fireEvent.change(screen.getByLabelText('Queen count'), { target: { value: '0' } })

    expect(screen.getByLabelText('Queen count')).toBeInTheDocument()
  })

  it('ignores a fractional count rather than silently truncating it', async () => {
    // parseInt read "2.5" as 2 and committed it, so a stray keystroke wrote a
    // bed count nobody chose.
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Add a bed type'), 'queen')
    await user.click(screen.getByRole('button', { name: 'Add bed' }))
    // Atomic replacement for the same reason as the test above: typing into a
    // controlled input appends to the stored value rather than replacing it.
    const count = screen.getByLabelText('Queen count')
    fireEvent.change(count, { target: { value: '3' } })
    expect(count).toHaveValue(3)

    fireEvent.change(count, { target: { value: '3.5' } })
    expect(count).toHaveValue(3)
  })
  // The `year` prop's own JSDoc says this form "never changes which season a
  // unit belongs to", justified on the grounds that resending the current year
  // is a no-op because `unit` is already one of this year's rows. That holds
  // only while currentYear is stable. If the configured season flips while the
  // editor is open — another tab, a CurrentYearContext refetch — the next save
  // writes the NEW year onto a row belonging to the old one, silently moving a
  // cabin between seasons. Capturing the year at open makes the sentence true
  // instead of merely asserted.
  it('saves the season the editor opened against, not one that changed under it', async () => {
    updateLodgingUnit.mockResolvedValue({ ...UNIT })
    const user = userEvent.setup()

    const { rerender } = render(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        year={2026}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    // The season flips while the editor sits open.
    rerender(
      <LodgingUnitForm
        areas={AREAS}
        units={[UNIT]}
        year={2027}
        unit={UNIT}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.year).toBe(2026)
  })
})
