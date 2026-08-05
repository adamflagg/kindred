/** Units list: sortable, grouped by area, confirm in one click, never delete. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentYearContext, type CurrentYearContextType } from '../../../hooks/useCurrentYear'

const deactivateLodgingUnit = vi.fn()
const confirmLodgingUnits = vi.fn()
const createLodgingUnit = vi.fn()
const updateLodgingUnit = vi.fn()
const listLodgingAreas = vi.fn()
const listLodgingUnits = vi.fn()

const AREAS = [
  { id: 'area_2', name: 'South Zone', code: 'SOUTH', map_x: 0, map_y: 0, sort_order: 2 },
  { id: 'area_1', name: 'North Zone', code: 'NORTH', map_x: 0, map_y: 0, sort_order: 1 },
]

// These handles are module-scoped so `vi.mock` can close over them, which
// means call records and resolved values outlive the test that set them.
// Without this reset a `toHaveBeenCalledWith` can match a call an earlier
// test made.
const UNITS = [
  { id: 'u1', name: 'Cabin A', code: 'cabin-a', area: 'area_1', sleeps: 0 },
  {
    id: 'u2',
    name: 'North Lodge',
    code: 'north-lodge',
    area: 'area_2',
    sleeps: 7,
    is_confirmed: true,
    is_container: true,
  },
  { id: 'u3', name: 'Cabin B', code: 'cabin-b', area: 'area_1', sleeps: 4 },
]

beforeEach(() => {
  deactivateLodgingUnit.mockReset()
  confirmLodgingUnits.mockReset()
  createLodgingUnit.mockReset()
  updateLodgingUnit.mockReset()
  listLodgingAreas.mockReset().mockResolvedValue(AREAS)
  listLodgingUnits.mockReset().mockResolvedValue(UNITS.map((u) => fixtureUnit(u)))
})

function fixtureUnit(over: Record<string, unknown>) {
  return {
    area: 'area_1',
    name: 'Cabin A',
    code: 'cabin-a',
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
    notes: '',
    ...over,
  }
}

vi.mock('../../../services/lodgingCrud', () => ({
  listLodgingUnits: (...args: unknown[]) => listLodgingUnits(...args),
  listLodgingAreas: (...args: unknown[]) => listLodgingAreas(...args),
  deactivateLodgingUnit: (...args: unknown[]) => deactivateLodgingUnit(...args),
  confirmLodgingUnits: (...args: unknown[]) => confirmLodgingUnits(...args),
  createLodgingUnit: (...args: unknown[]) => createLodgingUnit(...args),
  updateLodgingUnit: (...args: unknown[]) => updateLodgingUnit(...args),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./LodgingAreasDrawer', () => ({ LodgingAreasDrawer: () => <div>AREAS DRAWER</div> }))

// jsdom has no layout engine and does not implement scrollIntoView; the
// editor's open effect calls it, so it needs a stand-in rather than an
// assertion on what it does.
Element.prototype.scrollIntoView = vi.fn()

import { LodgingUnitsPanel } from './LodgingUnitsPanel'

// One client per TEST, built outside the render path. Constructing it inside
// the wrapper body rebuilds it on every render of the wrapper, discarding the
// cache and starting a fresh loading pass underneath assertions that already
// resolved. (A `useState` initialiser would also fix that, but the hooks lint
// rule rejects a hook in a helper this rule cannot see as a component.)
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

const YEAR_CONTEXT: CurrentYearContextType = {
  currentYear: 2026,
  setCurrentYear: vi.fn(),
  availableYears: [2026],
  isTransitioning: false,
  isYearReady: true,
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <CurrentYearContext.Provider value={YEAR_CONTEXT}>{children}</CurrentYearContext.Provider>
    </QueryClientProvider>
  )
}

// `CurrentYearContext` returns the literal 0 until the backend supplies the
// configured year (`useCurrentYear.ts`). The units/areas queries must not
// fire against `year = 0` in that window — PocketBase answers with a
// successful `200 []`, not an error, so an ungated query renders a false
// "no lodging units" empty state on every cold load.
const ZERO_YEAR_CONTEXT: CurrentYearContextType = {
  ...YEAR_CONTEXT,
  currentYear: 0,
  isYearReady: false,
}

function zeroYearWrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <CurrentYearContext.Provider value={ZERO_YEAR_CONTEXT}>
        {children}
      </CurrentYearContext.Provider>
    </QueryClientProvider>
  )
}

async function renderPanel() {
  render(<LodgingUnitsPanel />, { wrapper })
  await waitFor(() => {
    expect(screen.getByText('Cabin A')).toBeInTheDocument()
  })
}

describe('LodgingUnitsPanel', () => {
  it('asks for the current season only', async () => {
    // Units are year-scoped since 1500000140: an unfiltered read would show
    // every season's rows stacked in one table, since `code` is unique only
    // per (code, year).
    await renderPanel()

    expect(listLodgingUnits).toHaveBeenCalledWith(2026)
    expect(listLodgingAreas).toHaveBeenCalledWith(2026)
  })

  it('does not fetch until the year resolves', () => {
    render(<LodgingUnitsPanel />, { wrapper: zeroYearWrapper })
    expect(listLodgingUnits).not.toHaveBeenCalled()
    expect(listLodgingAreas).not.toHaveBeenCalled()
  })

  it('groups units under their area, ordered by the area sort_order', async () => {
    await renderPanel()
    const headings = screen.getAllByRole('button', { name: /Zone/ }).map((el) => el.textContent)
    expect(headings[0]).toContain('North Zone')
    expect(headings[1]).toContain('South Zone')
  })

  it('renders unknown capacity as an em dash', async () => {
    await renderPanel()
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('labels container rows as buildings', async () => {
    await renderPanel()
    expect(screen.getByText('Building')).toBeInTheDocument()
  })

  it('flags an unconfirmed unit, because the roster cannot judge fit against it', async () => {
    await renderPanel()
    expect(screen.getAllByText('Unconfirmed')).toHaveLength(2)
  })

  it('sorts within an area when a column header is activated', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('columnheader', { name: /Sleeps/ }))

    const north = screen.getByTestId('area-group-area_1')
    const names = within(north)
      .getAllByTestId('unit-name')
      .map((el) => el.textContent)
    // Cabin B sleeps 4; Cabin A is unknown and must sort last, not first.
    expect(names).toEqual(['Cabin B', 'Cabin A'])
  })

  it('marks the active column with aria-sort', async () => {
    const user = userEvent.setup()
    await renderPanel()

    const header = screen.getByRole('columnheader', { name: /Sleeps/ })
    await user.click(header)
    expect(header).toHaveAttribute('aria-sort', 'ascending')
    await user.click(header)
    expect(header).toHaveAttribute('aria-sort', 'descending')
  })

  it('confirms a single unit in one click, with no form round-trip', async () => {
    confirmLodgingUnits.mockResolvedValue(1)
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Confirm Cabin A' }))

    await waitFor(() => {
      expect(confirmLodgingUnits).toHaveBeenCalledWith(['u1'])
    })
  })

  it('offers no confirm action on an already-confirmed unit', async () => {
    await renderPanel()
    expect(screen.queryByRole('button', { name: 'Confirm North Lodge' })).not.toBeInTheDocument()
  })

  it('bulk-confirms a selection', async () => {
    confirmLodgingUnits.mockResolvedValue(2)
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('checkbox', { name: 'Select Cabin A' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Cabin B' }))
    await user.click(screen.getByRole('button', { name: /Confirm 2 selected/ }))

    await waitFor(() => {
      expect(confirmLodgingUnits).toHaveBeenCalledWith(['u1', 'u3'])
    })
  })

  it('hides the bulk bar when nothing is selected', async () => {
    await renderPanel()
    expect(screen.queryByRole('button', { name: /Confirm \d+ selected/ })).not.toBeInTheDocument()
  })

  it('offers deactivate, never delete', async () => {
    const user = userEvent.setup()
    await renderPanel()

    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Deactivate Cabin A' }))
    await waitFor(() => {
      expect(deactivateLodgingUnit).toHaveBeenCalledWith('u1')
    })
  })

  it('collapses an area group', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: /North Zone/ }))
    expect(screen.queryByText('Cabin A')).not.toBeInTheDocument()
    // The other area is unaffected.
    expect(screen.getByText('North Lodge')).toBeInTheDocument()
  })

  it('reports the group toggle state to assistive tech, not just the chevron', async () => {
    // The chevron is aria-hidden, so without aria-expanded a screen-reader
    // user gets no signal that the zone collapsed and its rows left the table.
    const user = userEvent.setup()
    await renderPanel()

    const toggle = screen.getByRole('button', { name: /North Zone/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    await user.click(toggle)
    expect(screen.getByRole('button', { name: /North Zone/ })).toHaveAttribute(
      'aria-expanded',
      'false'
    )
  })

  it('drops units from the selection when their area collapses', async () => {
    // Otherwise the bulk bar offers "Confirm 2 selected" over rows the user
    // can no longer see — a bulk mutation with no visible subject.
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('checkbox', { name: 'Select Cabin A' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Cabin B' }))
    expect(screen.getByRole('button', { name: /Confirm 2 selected/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /North Zone/ }))
    expect(screen.queryByRole('button', { name: /Confirm \d+ selected/ })).not.toBeInTheDocument()
  })

  it('keeps a selection in an area that stays open', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('checkbox', { name: 'Select Cabin A' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select North Lodge' }))
    await user.click(screen.getByRole('button', { name: /North Zone/ }))

    expect(screen.getByRole('button', { name: /Confirm 1 selected/ })).toBeInTheDocument()
  })

  it('does not re-select a group when it expands again', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('checkbox', { name: 'Select Cabin A' }))
    await user.click(screen.getByRole('button', { name: /North Zone/ }))
    await user.click(screen.getByRole('button', { name: /North Zone/ }))

    expect(screen.getByRole('checkbox', { name: 'Select Cabin A' })).not.toBeChecked()
    expect(screen.queryByRole('button', { name: /Confirm \d+ selected/ })).not.toBeInTheDocument()
  })
})

describe('LodgingUnitsPanel — edit form does not leak between records', () => {
  it('does not leak a previous edit into a freshly opened create form', async () => {
    // Regression for the silent-corruption bug: editing Cabin A, ticking
    // "confirmed", and then opening "New unit" without a `key` on the form
    // left React reusing the same component instance — a create would have
    // silently submitted `is_confirmed: true`, switching the roster's fit
    // check on for a cabin nobody has verified.
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Cabin A')
    await user.click(screen.getByLabelText('Amenities confirmed by staff'))
    expect(screen.getByLabelText('Amenities confirmed by staff')).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'New unit' }))
    expect(screen.getByLabelText('Name')).toHaveValue('')
    expect(screen.getByLabelText('Amenities confirmed by staff')).not.toBeChecked()
  })

  it('does not leak one edited unit into the next when switching records directly', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))
    expect(screen.getByLabelText('Name')).toHaveValue('Cabin A')

    await user.click(screen.getByRole('button', { name: 'Edit North Lodge' }))
    expect(screen.getByLabelText('Name')).toHaveValue('North Lodge')
  })

  it('moves focus into the form when the editor opens', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'New unit' }))
    expect(screen.getByLabelText('Name')).toHaveFocus()
  })
})

describe('LodgingUnitsPanel — areas query state', () => {
  // groupUnitsByArea handles a missing area gracefully BY DESIGN, bucketing
  // orphans under "No area" so a unit whose area was deleted stays visible.
  // That is exactly what makes a failed areas fetch dangerous: every unit
  // collapses into one unnamed group and it reads as data loss, not as a
  // fetch that failed.
  it('surfaces a failed areas fetch instead of silently ungrouping every unit', async () => {
    listLodgingAreas.mockRejectedValue(new Error('network'))
    render(<LodgingUnitsPanel />, { wrapper })

    await waitFor(() => {
      expect(screen.getByText(/areas could not be loaded/i)).toBeInTheDocument()
    })
    // The units themselves still render — the roster is readable, only the
    // grouping is untrustworthy, and hiding the rows would be the worse call.
    expect(screen.getByText('Cabin A')).toBeInTheDocument()
  })

  it('does not open the editor when there are no areas to assign a unit to', async () => {
    // The Area select is a required relation with no blank option. Opening the
    // form against an empty list offers a create whose only outcome is a
    // server rejection the staffer reads as their own mistake.
    listLodgingAreas.mockRejectedValue(new Error('network'))
    const user = userEvent.setup()
    render(<LodgingUnitsPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('Cabin A')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /New unit/ }))

    expect(screen.queryByRole('button', { name: 'Create unit' })).not.toBeInTheDocument()
  })
})

describe('LodgingUnitsPanel — the editor opens in a modal', () => {
  it('opens the editor as a dialog rather than a panel above the table', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Cabin A')
  })

  it('names the unit being edited in the dialog header', async () => {
    // Opened from a 93-row table, "which unit is this?" is the first question
    // the staffer has, and the row it came from is now behind a backdrop.
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByRole('heading', { name: 'Cabin A' })).toBeInTheDocument()
    // The area, since the row it came from is behind the backdrop now. Scoped
    // to the heading's own block: the Area <select> lists every area as an
    // option, so the name appears more than once inside the dialog.
    expect(
      within(dialog).getByRole('heading', { name: 'Cabin A' }).parentElement
    ).toHaveTextContent('North Zone')
  })

  it('heads a create differently, since there is no unit to name yet', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'New unit' }))

    expect(screen.getByRole('heading', { name: 'Add a unit' })).toBeInTheDocument()
  })

  it('leaves the list where it was instead of scrolling the staffer to the editor', async () => {
    // THE POINT OF THE CHANGE. The old editor mounted ABOVE a 93-row table, so
    // it had to scroll there to be noticed at all — taking the staffer away
    // from the row they were working and losing their place in the list. A
    // dialog is unmissable without moving anything.
    const user = userEvent.setup()
    await renderPanel()
    vi.mocked(Element.prototype.scrollIntoView).mockClear()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))

    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled()
  })

  it('closes on Cancel, returning to the list', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('Cabin A')).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })
})

describe('LodgingUnitsPanel — the dialog is named for assistive tech', () => {
  it('gives the dialog the unit name as its accessible name', async () => {
    // Modal falls back to its own `modal-title` id only in SIMPLE TITLE mode.
    // With a custom header and no ariaLabelledBy, aria-labelledby and
    // aria-label both come out undefined, and the dialog is announced as an
    // unnamed one — a screen-reader user is told a dialog opened but not which
    // unit it is for.
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'Edit Cabin A' }))

    expect(screen.getByRole('dialog', { name: 'Cabin A' })).toBeInTheDocument()
  })

  it('names the create dialog too', async () => {
    const user = userEvent.setup()
    await renderPanel()

    await user.click(screen.getByRole('button', { name: 'New unit' }))

    expect(screen.getByRole('dialog', { name: 'Add a unit' })).toBeInTheDocument()
  })
})
