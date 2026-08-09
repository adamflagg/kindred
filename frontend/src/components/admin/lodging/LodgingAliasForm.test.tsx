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
    shareability: '',
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

  // After a roll-forward, the `units` prop is THIS season's units only
  // (LodgingAliasesPanel), but an alias authored last season still names a
  // unit whose id belongs to the prior year. That id is not in `units` at
  // all -- unlike the retired/container cases above, no amount of filtering
  // finds it, because the record itself is absent from the list. Before this
  // fix, eligibleAliasMembers could never re-admit it: the checkbox simply
  // did not exist, so the "Resolves to" fieldset rendered as if nothing were
  // selected while memberUnits still held the stale id, and Save silently
  // wrote a merge nobody chose.
  //
  // The prior-season fixture deliberately reuses the CURRENT season unit's
  // name ("Cabin A"), which is the realistic case, not an edge one --
  // roll-forward copies `name` verbatim (`notCarried` in rollforward.go
  // excludes only id/created/updated/year/area/parent_unit). Two checkboxes
  // sharing a visible name is not enough on its own: the ACCESSIBLE name has
  // to differ too, or a screen-reader user hears two identical options and
  // can recreate the exact merge this fix exists to prevent.
  it('gives a same-named prior-season member a distinguishable accessible name', () => {
    const priorSeasonUnit = fixtureUnit({ id: 'u_2026', name: 'Cabin A' })
    const alias = {
      id: 'a1',
      alias_string: 'Cabin A - Whole',
      member_units: ['u_2026'],
      valid_from_year: 0,
      valid_to_year: 0,
      source_field: '',
      notes: '',
      expand: { member_units: [priorSeasonUnit] },
    }
    // `units` is this season's list ONLY -- it does not contain u_2026, but
    // does contain u1, ALSO named "Cabin A".
    render(<LodgingAliasForm units={UNITS} alias={alias} onSaved={vi.fn()} onCancel={vi.fn()} />)

    const priorSeasonBox = screen.getByRole('checkbox', { name: 'Cabin A (different season)' })
    const currentSeasonBox = screen.getByRole('checkbox', { name: 'Cabin A' })
    expect(priorSeasonBox).toBeChecked()
    expect(currentSeasonBox).not.toBeChecked()
  })

  // Before this fix, the prior-season member had no checkbox at all, so a
  // staffer replacing it with the current season's room could only ADD --
  // there was nothing to uncheck, and Save wrote a two-member merge nobody
  // asked for. Surfacing it restores the choice: untick the stale member,
  // tick the current one, and the alias resolves to one room, as intended.
  it('lets staff replace a surfaced prior-season member instead of merging onto it', async () => {
    const user = userEvent.setup()
    const priorSeasonUnit = fixtureUnit({ id: 'u_2026', name: 'Cabin A' })
    const alias = {
      id: 'a1',
      alias_string: 'Cabin A - Whole',
      member_units: ['u_2026'],
      valid_from_year: 0,
      valid_to_year: 0,
      source_field: '',
      notes: '',
      expand: { member_units: [priorSeasonUnit] },
    }
    render(<LodgingAliasForm units={UNITS} alias={alias} onSaved={vi.fn()} onCancel={vi.fn()} />)

    await user.click(screen.getByRole('checkbox', { name: 'Cabin A (different season)' }))
    await user.click(screen.getByRole('checkbox', { name: 'Cabin A' }))
    await user.click(screen.getByRole('button', { name: 'Save alias' }))

    await waitFor(() => {
      expect(updateLodgingAlias).toHaveBeenCalled()
    })
    const [, payload] = updateLodgingAlias.mock.calls[0] as [string, { member_units: string[] }]
    expect(payload.member_units).toEqual(['u1'])
  })
})
