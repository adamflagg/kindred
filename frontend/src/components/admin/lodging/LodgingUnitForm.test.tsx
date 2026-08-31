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
const toastSuccess = vi.fn()

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
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
  has_crib: false,
  has_changing_table: false,
  has_shared_fridge: false,
  inventory_class: 'family_pool',
  shareability: '',
  is_confirmed: false,
  is_active: true,
  is_container: false,
  default_combined: false,
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
    // Units are year-scoped since 1500000141; an omitted year fails the
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

  it('sends an explicit shareability on create, and it is UNCLASSIFIED', async () => {
    // kindred#2026. A new unit must not be born claiming to be one-family-only
    // — that is a ruling nobody made. '' is the honest state and is what the
    // read path renders as `unknown`.
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalledTimes(1)
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.shareability).toBe('')
  })

  it.each(['shareable', 'single_party', ''] as const)(
    'carries shareability %j through to the save payload unchanged',
    async (value) => {
      createLodgingUnit.mockResolvedValue({ id: 'u1' })
      const user = userEvent.setup()

      render(
        <LodgingUnitForm
          areas={AREAS}
          units={[]}
          year={2026}
          onSaved={vi.fn()}
          onCancel={vi.fn()}
        />
      )

      await user.type(screen.getByLabelText('Name'), 'Cabin N')
      await user.selectOptions(screen.getByLabelText('Sharing'), value)
      await user.click(screen.getByRole('button', { name: 'Create unit' }))

      await waitFor(() => {
        expect(createLodgingUnit).toHaveBeenCalledTimes(1)
      })
      const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
      expect(payload.shareability).toBe(value)
    }
  )

  it('stays quiet on a leaf regardless of sleeps — the comparison is retired (kindred#2331)', async () => {
    // Before owner ruling D17 (2026-08-14) this warned at sleeps: 8, because
    // the advisory re-derived `sleeps >= 12` here. It no longer does: a
    // LEAF's shareability is now a curated registry fact this form has no
    // formula for, so there is nothing left to compare `Sharing` against.
    // The retired threshold never matched the owner's real enumeration
    // anyway — no leaf in the inventory ever reached 12.
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Sharing'), 'shareable')
    await user.type(screen.getByLabelText('Sleeps'), '8')

    expect(screen.queryByText(/but the unit as edited reads/)).not.toBeInTheDocument()
  })

  it('stays quiet on a leaf in the OTHER direction too — one-family at a large capacity', async () => {
    // The mirror of the test above, and the half that actually distinguishes
    // the two rules: under the retired `sleeps >= 12` derivation a leaf stored
    // `single_party` at sleeps 15 derived `shareable` and warned. A leaf
    // curated one-family is now the registry's answer at any capacity, so
    // nothing here has an opinion about it.
    const user = userEvent.setup()
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    await user.selectOptions(screen.getByLabelText('Sharing'), 'single_party')
    await user.type(screen.getByLabelText('Sleeps'), '15')

    expect(screen.queryByText(/but the unit as edited reads/)).not.toBeInTheDocument()
  })

  it('offers a real blank option for sharing, unlike allocation', () => {
    // The contrast is the point. An empty inventory_class matches neither
    // branch of the availability rules, so Allocation offers no blank. An
    // empty shareability is a STATE — nobody has classified this — and the
    // migration deliberately leaves rows in it, so the staffer must be able
    // to both see it and return to it.
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    const select = screen.getByLabelText<HTMLSelectElement>('Sharing')
    expect([...select.options].map((o) => o.value)).toEqual(['', 'shareable', 'single_party'])
  })

  it('offers no blank option for the allocation default', () => {
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    const select = screen.getByLabelText<HTMLSelectElement>('Allocation')
    const values = [...select.options].map((option) => option.value)
    expect(values).toEqual(['family_pool', 'staff_default'])
  })

  it('calls staff allocation "Staff housing", not "Held for staff" (kindred#2078)', () => {
    // THREE things shared one word until this. `inventory_class` is a
    // PERMANENT role — a cabin that houses full-time staff and was never
    // weekend inventory — while the board's per-weekend control is now a
    // write-in, and the stats bar counts the two separately for exactly that
    // reason. Leaving the registry saying "Held for staff" beside a board
    // badge saying "Write-in" would keep the collision alive in the one place
    // staff go to set the role.
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )
    const select = screen.getByLabelText<HTMLSelectElement>('Allocation')
    const labels = [...select.options].map((option) => option.textContent)
    expect(labels).toEqual(['Available to guests', 'Staff housing'])
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

/**
 * `UnitIdentityFields` takes `inventoryClass` as a prop, live off the
 * Allocation select, rather than reading `unit.inventory_class` off the
 * record — see that prop's own docstring. The only reason to thread it live
 * is so the Parent unit picker re-narrows the instant a staffer flips
 * Allocation, without a save and a reopen. `unitTree.test.ts` covers
 * `parentCandidates` itself against both allocation values, but nothing
 * before this rendered the form and drove the select — so the wiring that is
 * the entire justification for the prop was untested.
 */
describe('LodgingUnitForm — the parent picker reflects a live allocation change', () => {
  it('re-narrows the Parent unit options the moment Allocation changes, with no save and no remount', async () => {
    const room: LodgingUnitRecord = {
      ...UNIT,
      id: 'room1',
      name: 'Alpine Room',
      code: 'alpine-room',
      parent_unit: '',
      inventory_class: 'family_pool',
      is_container: false,
    }
    const guestBuilding: LodgingUnitRecord = {
      ...UNIT,
      id: 'guest_building',
      name: 'Guest Lodge',
      code: 'guest-lodge',
      is_container: true,
      inventory_class: 'family_pool',
    }
    const staffBuilding: LodgingUnitRecord = {
      ...UNIT,
      id: 'staff_building',
      name: 'Staff Quarters',
      code: 'staff-quarters',
      is_container: true,
      inventory_class: 'staff_default',
    }
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[room, guestBuilding, staffBuilding]}
        year={2026}
        unit={room}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    // Held onto across the change below, not re-queried — a remount would
    // detach this reference rather than update it.
    const parentSelect = screen.getByLabelText<HTMLSelectElement>('Parent unit')
    // A room still marked for guests is not offered the staff building.
    expect([...parentSelect.options].map((o) => o.value)).toEqual(['', 'guest_building'])

    await user.selectOptions(screen.getByLabelText('Allocation'), 'staff_default')

    // Same render, no save, no remount — the picker widens to include the
    // staff building the instant Allocation flips to "Staff housing".
    expect([...parentSelect.options].map((o) => o.value)).toEqual([
      '',
      'guest_building',
      'staff_building',
    ])
  })

  // #2065: the mirror of the test above. #2051 pinned only the widening
  // direction (guest → staff, options grow); the narrowing direction — staff
  // → guest, options shrink — is where the bug actually lived.
  it('keeps the just-picked parent visible and selected after Allocation flips back to guest, rather than blanking the select while the stale value still saves', async () => {
    const room: LodgingUnitRecord = {
      ...UNIT,
      id: 'room1',
      name: 'Alpine Room',
      code: 'alpine-room',
      parent_unit: '',
      inventory_class: 'family_pool',
      is_container: false,
    }
    const guestBuilding: LodgingUnitRecord = {
      ...UNIT,
      id: 'guest_building',
      name: 'Guest Lodge',
      code: 'guest-lodge',
      is_container: true,
      inventory_class: 'family_pool',
    }
    const staffBuilding: LodgingUnitRecord = {
      ...UNIT,
      id: 'staff_building',
      name: 'Staff Quarters',
      code: 'staff-quarters',
      is_container: true,
      inventory_class: 'staff_default',
    }
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[room, guestBuilding, staffBuilding]}
        year={2026}
        unit={room}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    const parentSelect = screen.getByLabelText<HTMLSelectElement>('Parent unit')

    // Flip to staff, pick the staff building as parent, then flip back to
    // guest — all in the same render, no save, no remount.
    await user.selectOptions(screen.getByLabelText('Allocation'), 'staff_default')
    await user.selectOptions(parentSelect, 'staff_building')
    await user.selectOptions(screen.getByLabelText('Allocation'), 'family_pool')

    // `parentCandidates` used to spare the STORED parent
    // (`units.find(...)?.parent_unit`, still '' for this room) rather than
    // the live selection, so the staff building dropped out of the options
    // while `identity.parent_unit` still held it. A `<select>` whose value
    // is not among its options renders blank while quietly keeping the
    // stale value, which is what saved a guest room under a staff building.
    expect([...parentSelect.options].map((o) => o.value)).toContain('staff_building')
    expect(parentSelect.value).toBe('staff_building')
  })
})

describe('LodgingUnitForm — beds', () => {
  it('names the bed-type picker with aria-label alone, no separate sr-only label (kindred#2379)', () => {
    const { container } = render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    expect(container.querySelector('label[for="bed-type-picker"]')).toBeNull()
    expect(screen.getByLabelText('Add a bed type')).toBeInTheDocument()
  })

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

  it('has no live region on the capacity advisory (kindred#2379)', () => {
    // Nobody here uses AT (frontend/CLAUDE.md "Accessibility — deliberately
    // minimal"), so an aria-live announcement never reaches anyone. The
    // visible text is the whole story now — asserted directly below.
    const { container } = renderUnit(CONFLICTED)

    expect(container.querySelector('[role="status"]')).toBeNull()
    expect(container.querySelector('[aria-live]')).toBeNull()
  })

  it('shows the conflict as soon as the form renders, not only after an edit', () => {
    // Previously guaranteed by a live region announcing on mount; with no AT
    // users (frontend/CLAUDE.md "Accessibility — deliberately minimal") the
    // requirement is just that the visible text is there from the start.
    renderUnit(CONFLICTED)

    expect(screen.getByText('Beds account for 4, but sleeps says 8.')).toBeInTheDocument()
  })

  it('carries the conflict once, not as a second hidden copy', () => {
    renderUnit(CONFLICTED)

    expect(screen.getAllByText(/beds account for 4/i)).toHaveLength(1)
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

  /** The same, with the unit's building in the payload so the parent resolves. */
  const PARENT: LodgingUnitRecord = {
    ...UNIT,
    id: 'u0',
    code: 'cedar-house',
    name: 'Cedar House',
    is_container: true,
  }
  const renderWithParent = (unit: LodgingUnitRecord) =>
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[PARENT, unit]}
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

  it('offers the pin, not two number fields', () => {
    // kindred#2013. Typing 0.4389 into a number field is not how a pin gets
    // placed; dragging it onto the cabin is. The coordinate is edited on the
    // map itself and saved there — it is NOT a field of this form's payload,
    // which is what keeps the (0,0) guarantee below true by construction.
    renderUnit(UNIT)

    expect(screen.queryByLabelText('Map X')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Map Y')).not.toBeInTheDocument()
    expect(screen.getByText('Map position')).toBeInTheDocument()
    expect(screen.getByLabelText(/edit position/i)).not.toBeChecked()
  })

  it('offers no pin on create, since there is no record to write one to', () => {
    render(
      <LodgingUnitForm areas={AREAS} units={[]} year={2026} onSaved={vi.fn()} onCancel={vi.fn()} />
    )

    expect(screen.queryByText('Map position')).not.toBeInTheDocument()
  })

  /**
   * kindred#2440 REVERSED THIS PAIR. They used to assert that a container gets
   * no pin, on the model that "a building carries its rooms' positions through
   * its children". The owner ruled the opposite on 2026-08-21 — the map is a
   * view of BUILDINGS and a room draws at its building's point — so the
   * container is now the only thing whose coordinate the map reads, and the
   * room's own is inert. Leaving the old gate would have left the pin editable
   * NOWHERE for the twelve buildings that carry a room's pin, while still
   * offering each of those rooms a control that saves and moves nothing.
   */
  it('offers the pin for a container, which now carries its whole building`s mark', () => {
    renderUnit({ ...UNIT, is_container: true })

    // The GATE CHECKBOX, not the heading: an inheriting room keeps the "Map
    // position" heading to say where its pin lives, so the heading no longer
    // distinguishes the editor from the note that replaces it.
    expect(screen.getByLabelText(/edit position/i)).toBeInTheDocument()
  })

  it('hands the pin to a room the moment it is declared a building itself', async () => {
    // Read LIVE off the checkbox, not off the stored record — the invariant the
    // superseded version of this test protected, kept and pointed the other
    // way. A room inside a building has no pin of its own; ticking "this is a
    // building" makes it its own pin site, and the control must follow.
    const user = userEvent.setup()
    renderWithParent({ ...UNIT, parent_unit: 'u0' })
    expect(screen.queryByLabelText(/edit position/i)).not.toBeInTheDocument()

    await user.click(
      screen.getByLabelText('This is a building or building area with multiple bedrooms.')
    )

    expect(screen.getByLabelText(/edit position/i)).toBeInTheDocument()
  })

  it('offers no pin for a room inside a building — the building`s pin is its pin', () => {
    renderWithParent({ ...UNIT, parent_unit: 'u0' })

    expect(screen.queryByLabelText(/edit position/i)).not.toBeInTheDocument()
  })

  it('names the building that carries the pin, so the control has not merely vanished', () => {
    // The #2327 lesson: a capability that disappears without saying where it
    // went is a capability loss, whatever the data model says.
    renderWithParent({ ...UNIT, parent_unit: 'u0' })

    // The parent picker names it too, so match the note's own wording.
    expect(screen.getByText(/Drawn at Cedar House/)).toBeInTheDocument()
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
    // it, so a single mistyped character silently makes a group of one and
    // the roster stops matching that family on a shared bathroom — with no
    // error anywhere. Suggesting the existing ids makes the common case a
    // choice, not a spelling test, while leaving a new group typeable.
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

/**
 * The registry-default combined control (spec task 8). Combined means "draw
 * the card HERE and stop descending", so it is offered only on containers —
 * a leaf has nothing to stop descending past — and disabled once an ancestor
 * already carries it, since at most one node per root-to-leaf path may hold
 * the flag meaningfully. Same shape as "is a building" disabling once a unit
 * has children, tested above at 'disables "is a building" once a unit has
 * children'.
 */
describe('LodgingUnitForm — the default-combined control', () => {
  // A full LodgingUnitRecord built off the module's own UNIT fixture, keyed
  // by hand-picked ids ('house', 'wing', 'room') so ancestor chains read
  // naturally, rather than UNIT's 'u1'/'u2'.
  const unitRecord = (over: Partial<LodgingUnitRecord> & { id: string }): LodgingUnitRecord => ({
    ...UNIT,
    name: over.id,
    code: over.id,
    default_combined: false,
    ...over,
  })

  const renderForm = ({ unit, units }: { unit: LodgingUnitRecord; units?: LodgingUnitRecord[] }) =>
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={units ?? [unit]}
        year={2026}
        unit={unit}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

  it('offers the combined control only on a container', () => {
    // The flag means "draw the card here and stop descending". A leaf has
    // nothing to stop descending past.
    renderForm({ unit: unitRecord({ id: 'room', is_container: false }) })
    expect(screen.queryByLabelText(/assign it as a whole building/i)).not.toBeInTheDocument()
  })

  it('offers the combined control on a container with no combined ancestor', () => {
    renderForm({ unit: unitRecord({ id: 'house', is_container: true }) })
    expect(screen.getByLabelText(/assign it as a whole building/i)).not.toBeDisabled()
  })

  it('disables the combined control when an ancestor is already combined', () => {
    // At most one node per root-to-leaf path may hold it: an ancestor already
    // owns the card. Same shape as disabling "is a building" once a unit has
    // children, which this form already does.
    renderForm({
      unit: unitRecord({ id: 'wing', is_container: true, parent_unit: 'house' }),
      units: [unitRecord({ id: 'house', is_container: true, default_combined: true })],
    })
    expect(screen.getByLabelText(/assign it as a whole building/i)).toBeDisabled()
  })

  it('disables the control through a multi-level ancestor, not only a direct parent, and names the grandparent that actually owns it', () => {
    // Grandparent combined, direct parent not. A check that only looks one
    // hop up is the obvious wrong implementation, so this pins it: 'house' is
    // combined, 'wing' is not, and 'room' hangs off 'wing'.
    //
    // Distinct names on purpose: `toBeDisabled()` alone would still pass if
    // the reason named 'wing' (the immediate parent) instead of 'house' (the
    // node that actually owns the card) — a check that named "the parent"
    // rather than "the combined ancestor" would disable correctly here but
    // mislead a staffer about which building to go edit instead. Scoped to
    // "already combined" for the same reason as the single-level naming test
    // above: both names are also valid options in the "Parent unit" <select>
    // this same render produces.
    renderForm({
      unit: unitRecord({ id: 'room', is_container: true, parent_unit: 'wing' }),
      units: [
        unitRecord({
          id: 'wing',
          is_container: true,
          parent_unit: 'house',
          name: 'Uncombined Wing',
        }),
        unitRecord({
          id: 'house',
          is_container: true,
          default_combined: true,
          name: 'Combined House',
        }),
      ],
    })
    expect(screen.getByLabelText(/assign it as a whole building/i)).toBeDisabled()
    expect(screen.getByText(/already combined.*combined house/i)).toBeInTheDocument()
    expect(screen.queryByText(/already combined.*uncombined wing/i)).not.toBeInTheDocument()
  })

  it('names the combined ancestor beside the disabled control', () => {
    // Scoped to "already combined" so this cannot pass merely because
    // 'North Lodge' also appears as an option text in the parent-unit
    // <select> above — a real risk here, since 'house' is a valid parent
    // candidate for 'wing' and would render there regardless of this
    // control's own reason text.
    renderForm({
      unit: unitRecord({ id: 'wing', is_container: true, parent_unit: 'house' }),
      units: [
        unitRecord({
          id: 'house',
          is_container: true,
          name: 'North Lodge',
          default_combined: true,
        }),
      ],
    })
    expect(screen.getByText(/already combined.*north lodge/i)).toBeInTheDocument()
  })

  it('submits default_combined on the write payload', async () => {
    updateLodgingUnit.mockResolvedValue({})
    const user = userEvent.setup()

    renderForm({ unit: unitRecord({ id: 'house', is_container: true }) })
    await user.click(screen.getByLabelText(/assign it as a whole building/i))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.default_combined).toBe(true)
  })

  it('renders the combined pair directly beneath "This is a building…", not off in the identity fields', () => {
    // The two checkboxes are one thought — what this building is, and whether
    // it draws as one card — so the combined control has to sit right after
    // "is a building" rather than wherever UnitIdentityFields happens to put
    // it. children.length is 0 here, so nothing else can land between them.
    renderForm({ unit: unitRecord({ id: 'house', is_container: true }) })

    const isContainerLabel = screen
      .getByLabelText('This is a building or building area with multiple bedrooms.')
      .closest('label')
    const combinedCheckbox = screen.getByLabelText(/assign it as a whole building/i)

    expect(isContainerLabel?.nextElementSibling).toContainElement(combinedCheckbox)
  })

  it('clears default_combined once "is a building" is unticked, so the two never contradict on save', async () => {
    // The control disappears the moment isContainer goes false — it is
    // rendered `isContainer && ...` in UnitIdentityFields — but state is not
    // UI: unless the form clears `combined` itself, the payload still saves
    // default_combined: true beside is_container: false. That contradiction
    // is exactly what verify-slot-merge-seed.sh's `leaked` check asserts
    // never exists in the registry.
    updateLodgingUnit.mockResolvedValue({})
    const user = userEvent.setup()

    renderForm({ unit: unitRecord({ id: 'house', is_container: true }) })
    await user.click(screen.getByLabelText(/assign it as a whole building/i))
    await user.click(
      screen.getByLabelText('This is a building or building area with multiple bedrooms.')
    )
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.default_combined).toBe(false)
    expect(payload.is_container).toBe(false)
  })
})

/**
 * The bathroom share, said as ROOMS rather than as the opaque group id staff
 * had no reason to know existed (kindred#2023).
 *
 * Sharing is symmetric and `bathroom_group` is one string per unit, so the
 * owner's ruling is that every assertion made from one room's form lands on
 * the peers' records too — REMOVAL INCLUDED. The peer writes are N+1 and
 * non-atomic, which is why the partial-failure case below is the most
 * important test in this group: a half-written group must never be reported
 * as a completed save.
 */
describe('LodgingUnitForm — a bathroom share is named in rooms', () => {
  const room = (over: Partial<LodgingUnitRecord> & { id: string }): LodgingUnitRecord => ({
    ...UNIT,
    name: over.id,
    code: over.id,
    ...over,
  })

  const HOUSE = room({ id: 'house', name: 'Hall House', code: 'hh', is_container: true })
  const ROOM_ONE = room({ id: 'r1', name: 'Room One', parent_unit: 'house' })
  const ROOM_TWO = room({ id: 'r2', name: 'Room Two', parent_unit: 'house' })
  const ROOM_THREE = room({ id: 'r3', name: 'Room Three', parent_unit: 'house' })

  const grouped = (unit: LodgingUnitRecord, group: string) => ({ ...unit, bathroom_group: group })

  const renderRoom = (unit: LodgingUnitRecord, units: LodgingUnitRecord[], onSaved = vi.fn()) => {
    render(
      <LodgingUnitForm
        areas={AREAS}
        units={units}
        year={2026}
        unit={unit}
        onSaved={onSaved}
        onCancel={vi.fn()}
      />
    )
    return onSaved
  }

  it('names the peer room and never shows the group id', () => {
    const one = grouped(ROOM_ONE, 'hh-hall')
    renderRoom(one, [HOUSE, one, grouped(ROOM_TWO, 'hh-hall'), ROOM_THREE])

    expect(screen.getByText('Room Two')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove Room Two' })).toBeInTheDocument()
    // The id is storage, not vocabulary. Nothing on screen may carry it.
    expect(screen.queryByDisplayValue('hh-hall')).not.toBeInTheDocument()
  })

  it('writes the group onto the added room as well as this one', async () => {
    updateLodgingUnit.mockResolvedValue({})
    const user = userEvent.setup()
    const one = grouped(ROOM_ONE, 'hh-hall')
    renderRoom(one, [HOUSE, one, grouped(ROOM_TWO, 'hh-hall'), ROOM_THREE])

    await user.selectOptions(screen.getByLabelText('Add a room that shares this bathroom'), 'r3')
    await user.click(screen.getByRole('button', { name: 'Add room' }))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledWith('r3', { bathroom_group: 'hh-hall' })
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.bathroom_group).toBe('hh-hall')
  })

  it('CLEARS the peer too when the last listed room is removed', async () => {
    // The dangerous direction. Clearing only this room would leave Room Two
    // alone in the group — the group-of-one this feature exists to eliminate,
    // recreated by the act of dissolving it.
    updateLodgingUnit.mockResolvedValue({})
    const user = userEvent.setup()
    const one = grouped(ROOM_ONE, 'hh-hall')
    renderRoom(one, [HOUSE, one, grouped(ROOM_TWO, 'hh-hall')])

    await user.click(screen.getByRole('button', { name: 'Remove Room Two' }))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledWith('r2', { bathroom_group: '' })
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.bathroom_group).toBe('')
  })

  it('refuses to report a partial peer write as a saved unit', async () => {
    // N+1 non-atomic writes are the accepted cost of symmetric peers. What is
    // NOT acceptable is a green toast over a half-written group: the staffer
    // has to be told which rooms landed and which did not, and the form must
    // stay open so the retry is one click away.
    updateLodgingUnit.mockImplementation((id: string) =>
      id === 'r3' ? Promise.reject(new Error('network')) : Promise.resolve({})
    )
    const user = userEvent.setup()
    const one = grouped(ROOM_ONE, 'hh-hall')
    const onSaved = renderRoom(one, [
      HOUSE,
      one,
      grouped(ROOM_TWO, 'hh-hall'),
      grouped(ROOM_THREE, 'hh-hall'),
    ])

    await user.click(screen.getByRole('button', { name: 'Remove Room Two' }))
    await user.click(screen.getByRole('button', { name: 'Remove Room Three' }))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    const message = String((toastError.mock.calls[0] as [string])[0])
    expect(message).toContain('Room Two')
    expect(message).toContain('Room Three')
    // Both halves named, and named as different halves.
    expect(message.indexOf('Room Two')).toBeLessThan(message.indexOf('Room Three'))
    expect(message).toMatch(/not updated/i)
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
    // Still editable — the modal has not been dismissed out from under a
    // half-finished write.
    expect(screen.getByRole('button', { name: 'Save unit' })).toBeEnabled()
  })

  it('disables the add picker when every other room is already listed', () => {
    // Nine of the ten production groups are in exactly this state, so it is
    // the ordinary rendering of this control, not an edge case.
    const one = grouped(ROOM_ONE, 'hh-hall')
    renderRoom(one, [HOUSE, one, grouped(ROOM_TWO, 'hh-hall')])

    expect(screen.getByLabelText('Add a room that shares this bathroom')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add room' })).toBeDisabled()
    expect(screen.getByText(/already listed/i)).toBeInTheDocument()
  })

  it('leaves a room with no parent on the raw id field', () => {
    // Zero parentless units carry a group in production, so the "same area"
    // fallback the proposal sketched is unexercised by any real row. Rather
    // than ship an untested branch, a parentless room keeps the field it has.
    const orphan = { ...UNIT, id: 'solo', name: 'Solo Room', parent_unit: '' }
    renderRoom(orphan, [orphan])

    expect(screen.getByLabelText('Shares a bathroom with')).toHaveAttribute('list')
    expect(screen.queryByLabelText('Add a room that shares this bathroom')).not.toBeInTheDocument()
  })

  it('writes no peer from the raw id field, which never named one', async () => {
    // The symmetric peer writes are the CHIPS' semantics, and a parentless
    // room has no chips. Driving them off the raw field would rewrite a
    // record the staffer cannot see on screen and never mentioned — and the
    // failure toast would then name a room they have no idea they touched.
    // A parentless room's save is the one-record edit it has always been.
    updateLodgingUnit.mockResolvedValue({})
    const user = userEvent.setup()
    const orphan = { ...UNIT, id: 'solo', name: 'Solo Room', parent_unit: '', bathroom_group: 'g1' }
    const stranger = { ...UNIT, id: 'far', name: 'Far Room', parent_unit: '', bathroom_group: 'g1' }
    renderRoom(orphan, [orphan, stranger])

    const raw = screen.getByLabelText('Shares a bathroom with')
    await user.clear(raw)
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledWith('solo', expect.anything())
    })
    expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    expect(updateLodgingUnit).not.toHaveBeenCalledWith('far', expect.anything())
  })

  it('warns about a stored group of one and can still empty it', async () => {
    // The chips have no other way to clear a stale id — the raw text field
    // they replace always could, and losing that would be a regression that
    // strands exactly the mistyped group this feature exists to eliminate.
    updateLodgingUnit.mockResolvedValue({})
    const user = userEvent.setup()
    const one = grouped(ROOM_ONE, 'hh-hall')
    renderRoom(one, [HOUSE, one, ROOM_TWO])

    expect(screen.getByText(/no other room shares this bathroom/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Clear it' }))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.bathroom_group).toBe('')
    // Nobody else was in it, so nobody else is written.
    expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
  })

  it('keeps writing the remaining peers after one of them fails', async () => {
    // THE POINT OF THE WHOLE LOOP, and the one thing the partial-failure test
    // above cannot show: there the FIRST peer succeeded, so a loop that broke
    // at the first failure produced a byte-identical toast. Here the first
    // peer fails. Membership is a SET — a prefix is worth no more than any
    // other subset — so the second write must still be attempted, and it must
    // be reported on the "updated" side, not silently dropped.
    updateLodgingUnit.mockImplementation((id: string) =>
      id === 'r2' ? Promise.reject(new Error('network')) : Promise.resolve({})
    )
    const user = userEvent.setup()
    const one = grouped(ROOM_ONE, 'hh-hall')
    renderRoom(one, [HOUSE, one, grouped(ROOM_TWO, 'hh-hall'), grouped(ROOM_THREE, 'hh-hall')])

    await user.click(screen.getByRole('button', { name: 'Remove Room Two' }))
    await user.click(screen.getByRole('button', { name: 'Remove Room Three' }))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    // Room Two failed first; Room Three was still attempted.
    expect(updateLodgingUnit).toHaveBeenCalledWith('r3', { bathroom_group: '' })
    const message = String((toastError.mock.calls[0] as [string])[0])
    expect(message).toMatch(/updated: Room Three/i)
    expect(message).toMatch(/not updated: Room Two/i)
  })

  it('attempts no peer write when this room’s own save fails', async () => {
    // Peers pointing at a group the edited room never joined is the one
    // partial state with no honest way to describe it, so the unit's own
    // write gates the rest.
    updateLodgingUnit.mockImplementation((id: string) =>
      id === 'r1' ? Promise.reject(new Error('network')) : Promise.resolve({})
    )
    const user = userEvent.setup()
    const one = grouped(ROOM_ONE, 'hh-hall')
    const onSaved = renderRoom(one, [HOUSE, one, grouped(ROOM_TWO, 'hh-hall'), ROOM_THREE])

    await user.selectOptions(screen.getByLabelText('Add a room that shares this bathroom'), 'r3')
    await user.click(screen.getByRole('button', { name: 'Add room' }))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(updateLodgingUnit).toHaveBeenCalledTimes(1)
    expect(updateLodgingUnit).not.toHaveBeenCalledWith('r3', expect.anything())
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(onSaved).not.toHaveBeenCalled()
  })

  it('retries a created room as an UPDATE, so the half-written group can be finished', async () => {
    // The create path's version of "the editor stays open". A create that
    // LANDED cannot be replayed as a create: `code` is unique per (code,
    // year), so the second submit is rejected by PocketBase and the staffer
    // is stranded with a peer that never got the group — the exact silent
    // partial write the ruling forbids. The retry has to target the record
    // that already exists.
    createLodgingUnit.mockResolvedValue({ ...ROOM_TWO, id: 'fresh', name: 'Room Four' })
    updateLodgingUnit.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[HOUSE, ROOM_ONE]}
        year={2026}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('Name'), 'Room Four')
    await user.selectOptions(screen.getByLabelText('Parent unit'), 'house')
    await user.selectOptions(screen.getByLabelText('Add a room that shares this bathroom'), 'r1')
    await user.click(screen.getByRole('button', { name: 'Add room' }))
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledTimes(1)
    })
    expect(createLodgingUnit).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledTimes(2)
    })
    // Not a second row with a colliding code — the same record, updated.
    expect(createLodgingUnit).toHaveBeenCalledTimes(1)
    expect(updateLodgingUnit).toHaveBeenCalledWith(
      'fresh',
      expect.objectContaining({ name: 'Room Four' })
    )
  })

  it('sends an explicit sleeps 0 once the row exists, even on the create form', async () => {
    // The header's rule — omit on CREATE so PocketBase writes its own 0, send
    // an explicit 0 on EDIT so clearing the field is not a silent no-op —
    // turns on whether the ROW exists, not on which button was pressed. After
    // a create landed and only the peer write failed, the second submit is an
    // edit, so clearing a number the first attempt stored has to stick.
    createLodgingUnit.mockResolvedValue({ ...ROOM_TWO, id: 'fresh', name: 'Room Four' })
    updateLodgingUnit.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()

    render(
      <LodgingUnitForm
        areas={AREAS}
        units={[HOUSE, ROOM_ONE]}
        year={2026}
        onSaved={vi.fn()}
        onCancel={vi.fn()}
      />
    )

    await user.type(screen.getByLabelText('Name'), 'Room Four')
    await user.selectOptions(screen.getByLabelText('Parent unit'), 'house')
    await user.type(screen.getByLabelText('Sleeps'), '4')
    await user.selectOptions(screen.getByLabelText('Add a room that shares this bathroom'), 'r1')
    await user.click(screen.getByRole('button', { name: 'Add room' }))
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalledTimes(1)
    })
    await user.clear(screen.getByLabelText('Sleeps'))
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledWith('fresh', expect.anything())
    })
    const [, payload] = updateLodgingUnit.mock.calls.find(
      (call) => (call as [string, LodgingUnitInput])[0] === 'fresh'
    ) as [string, LodgingUnitInput]
    expect(payload.sleeps).toBe(0)
  })
})
