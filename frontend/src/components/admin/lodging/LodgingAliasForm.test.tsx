/**
 * The alias editor's own tests.
 *
 * The year window is the one field here that fails SILENTLY. A wrong string or
 * a wrong unit is visible in the panel's own table; an inverted window matches
 * no year at all, so the alias simply stops resolving and the cabin string
 * lands back in the unresolved queue with nothing pointing at why.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const createLodgingAlias = vi.fn()
const updateLodgingAlias = vi.fn()
const toastError = vi.fn()

vi.mock('../../../services/lodgingCrud', () => ({
  createLodgingAlias: (...args: unknown[]) => createLodgingAlias(...args),
  updateLodgingAlias: (...args: unknown[]) => updateLodgingAlias(...args),
}))

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) },
}))

import type { LodgingUnitRecord } from '../../../types/lodging'
import { LodgingAliasForm } from './LodgingAliasForm'

function fixtureUnit(over: Partial<LodgingUnitRecord> & { id: string }): LodgingUnitRecord {
  return {
    area: 'area_1',
    name: over.id,
    code: over.id,
    parent_unit: '',
    map_x: 0,
    map_y: 0,
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
    default_combined: false,
    notes: '',
    ...over,
  }
}

const UNITS = [
  fixtureUnit({ id: 'u1', name: 'Cabin A' }),
  fixtureUnit({ id: 'u2', name: 'Cabin B' }),
]

beforeEach(() => {
  createLodgingAlias.mockReset().mockResolvedValue({ id: 'a1' })
  updateLodgingAlias.mockReset().mockResolvedValue({ id: 'a1' })
  toastError.mockReset()
})

async function fillMinimalAlias(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Cabin string'), 'Cabin A - Whole')
  await user.click(screen.getByRole('checkbox', { name: 'Cabin A' }))
  await user.click(screen.getByRole('button', { name: /Set a year window/ }))
}

describe('LodgingAliasForm — year window', () => {
  it('refuses a window whose first year is after its last', async () => {
    const user = userEvent.setup()
    render(<LodgingAliasForm units={UNITS} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await fillMinimalAlias(user)
    await user.type(screen.getByLabelText('Valid from year'), '2026')
    await user.type(screen.getByLabelText('Valid to year'), '2024')
    await user.click(screen.getByRole('button', { name: 'Create alias' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(createLodgingAlias).not.toHaveBeenCalled()
  })

  it('leaves the form usable after rejecting the window', async () => {
    // A guard that returns without clearing isSaving would disable the submit
    // button permanently and strand the staffer on a form they cannot fix.
    const user = userEvent.setup()
    render(<LodgingAliasForm units={UNITS} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await fillMinimalAlias(user)
    await user.type(screen.getByLabelText('Valid from year'), '2026')
    await user.type(screen.getByLabelText('Valid to year'), '2024')
    await user.click(screen.getByRole('button', { name: 'Create alias' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalled()
    })
    expect(screen.getByRole('button', { name: 'Create alias' })).toBeEnabled()
  })

  it('accepts a single-year window, where first and last are the same', async () => {
    const user = userEvent.setup()
    render(<LodgingAliasForm units={UNITS} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await fillMinimalAlias(user)
    await user.type(screen.getByLabelText('Valid from year'), '2025')
    await user.type(screen.getByLabelText('Valid to year'), '2025')
    await user.click(screen.getByRole('button', { name: 'Create alias' }))

    await waitFor(() => {
      expect(createLodgingAlias).toHaveBeenCalled()
    })
    const [payload] = createLodgingAlias.mock.calls[0] as [
      { valid_from_year: number; valid_to_year: number },
    ]
    expect(payload.valid_from_year).toBe(2025)
    expect(payload.valid_to_year).toBe(2025)
  })

  it('accepts an open-ended window, since 0 is how unbounded is stored', async () => {
    const user = userEvent.setup()
    render(<LodgingAliasForm units={UNITS} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await fillMinimalAlias(user)
    await user.type(screen.getByLabelText('Valid from year'), '2025')
    await user.click(screen.getByRole('button', { name: 'Create alias' }))

    await waitFor(() => {
      expect(createLodgingAlias).toHaveBeenCalled()
    })
    const [payload] = createLodgingAlias.mock.calls[0] as [
      { valid_from_year: number; valid_to_year: number },
    ]
    expect(payload.valid_from_year).toBe(2025)
    expect(payload.valid_to_year).toBe(0)
  })
})

describe('LodgingAliasForm — which units may be members', () => {
  const MIXED = [
    fixtureUnit({ id: 'u1', name: 'Cabin A' }),
    fixtureUnit({ id: 'u2', name: 'North Lodge', is_container: true }),
    fixtureUnit({ id: 'u3', name: 'Old Hall', is_active: false }),
  ]

  // The header states one member is an atomic room and two or more denote a
  // merge. A container is not a room, and an inactive unit is one staff
  // retired — an alias pointing at either resolves history onto a place that
  // is not bookable.
  it('offers only active, non-container units', () => {
    render(<LodgingAliasForm units={MIXED} onSaved={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'Cabin A' })).toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'North Lodge' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Old Hall' })).not.toBeInTheDocument()
  })

  // An alias edited years later may already name a unit that has since been
  // retired or turned into a container. Hiding it would silently drop that
  // member on the next save, which is a worse outcome than showing it.
  it('still shows an existing member that has since been retired', () => {
    const alias = {
      id: 'a1',
      alias_string: 'Old Hall - Whole',
      member_units: ['u3'],
      valid_from_year: 0,
      valid_to_year: 0,
      source_field: '',
      notes: '',
    }
    render(<LodgingAliasForm units={MIXED} alias={alias} onSaved={vi.fn()} onCancel={vi.fn()} />)

    expect(screen.getByRole('checkbox', { name: 'Old Hall' })).toBeChecked()
  })
})
