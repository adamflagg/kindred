/**
 * A unit created without an explicit is_active / allocation_default is
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

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
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
  allocation_default: 'family_pool',
  is_confirmed: false,
  is_active: true,
  is_container: false,
  notes: '',
}

describe('LodgingUnitForm — create', () => {
  it('submits is_active true and an explicit allocation_default', async () => {
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
    expect(payload.allocation_default).toBe('family_pool')
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
