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

describe('LodgingUnitForm — create', () => {
  it('submits is_active true and an explicit allocation_default', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const onSaved = vi.fn()
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} onSaved={onSaved} onCancel={vi.fn()} />)

    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.type(screen.getByLabelText('Code'), 'cabin-n')
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
    render(<LodgingUnitForm areas={AREAS} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const select = screen.getByLabelText<HTMLSelectElement>('Allocation')
    const values = [...select.options].map((option) => option.value)
    expect(values).toEqual(['family_pool', 'staff_default'])
  })

  it('sends no sleeps value when capacity is left blank', async () => {
    createLodgingUnit.mockResolvedValue({ id: 'u1' })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.type(screen.getByLabelText('Code'), 'cabin-n')
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

    render(<LodgingUnitForm areas={AREAS} onSaved={vi.fn()} onCancel={vi.fn()} />)
    const bathroom = screen.getByLabelText<HTMLSelectElement>('Bathroom')
    expect([...bathroom.options].map((o) => o.value)).toEqual(['', 'none', 'private', 'shared'])

    await user.type(screen.getByLabelText('Name'), 'Cabin N')
    await user.type(screen.getByLabelText('Code'), 'cabin-n')
    await user.click(screen.getByRole('button', { name: 'Create unit' }))

    await waitFor(() => {
      expect(createLodgingUnit).toHaveBeenCalled()
    })
    const [payload] = createLodgingUnit.mock.calls[0] as [LodgingUnitInput]
    expect(payload.bathroom).not.toBe('unknown')
  })
})

describe('LodgingUnitForm — edit', () => {
  const UNIT: LodgingUnitRecord = {
    id: 'u1',
    area: 'area_1',
    name: 'Cabin A',
    code: 'cabin-a',
    parent_unit: '',
    map_x: 0.3,
    map_y: 0.2,
    sleeps: 0,
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

  it('shows a blank capacity field for a stored 0, never "0"', () => {
    render(<LodgingUnitForm areas={AREAS} unit={UNIT} onSaved={vi.fn()} onCancel={vi.fn()} />)
    expect(screen.getByLabelText('Sleeps')).toHaveValue(null)
  })

  it('updates rather than creating', async () => {
    updateLodgingUnit.mockResolvedValue({ ...UNIT })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} unit={UNIT} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalledWith('u1', expect.anything())
    })
    expect(createLodgingUnit).not.toHaveBeenCalled()
  })

  it('offers confirming amenities, which is what switches the roster fit check on', async () => {
    updateLodgingUnit.mockResolvedValue({ ...UNIT })
    const user = userEvent.setup()

    render(<LodgingUnitForm areas={AREAS} unit={UNIT} onSaved={vi.fn()} onCancel={vi.fn()} />)
    await user.click(screen.getByLabelText('Amenities confirmed by staff'))
    await user.click(screen.getByRole('button', { name: 'Save unit' }))

    await waitFor(() => {
      expect(updateLodgingUnit).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingUnit.mock.calls[0] as [string, LodgingUnitInput]
    expect(payload.is_confirmed).toBe(true)
  })
})
