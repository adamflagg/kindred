/** Units list: sortable, grouped by area, confirm in one click, never delete. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const deactivateLodgingUnit = vi.fn()
const confirmLodgingUnits = vi.fn()

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
    allocation_default: 'family_pool',
    is_confirmed: false,
    is_active: true,
    is_container: false,
    notes: '',
    ...over,
  }
}

vi.mock('../../../services/lodgingCrud', () => ({
  listLodgingUnits: () =>
    Promise.resolve([
      fixtureUnit({ id: 'u1', name: 'Cabin A', code: 'cabin-a', area: 'area_1', sleeps: 0 }),
      fixtureUnit({
        id: 'u2',
        name: 'North Lodge',
        code: 'north-lodge',
        area: 'area_2',
        sleeps: 7,
        is_confirmed: true,
        is_container: true,
      }),
      fixtureUnit({ id: 'u3', name: 'Cabin B', code: 'cabin-b', area: 'area_1', sleeps: 4 }),
    ]),
  listLodgingAreas: () =>
    Promise.resolve([
      { id: 'area_2', name: 'South Zone', code: 'SOUTH', map_x: 0, map_y: 0, sort_order: 2 },
      { id: 'area_1', name: 'North Zone', code: 'NORTH', map_x: 0, map_y: 0, sort_order: 1 },
    ]),
  deactivateLodgingUnit: (...args: unknown[]) => deactivateLodgingUnit(...args),
  confirmLodgingUnits: (...args: unknown[]) => confirmLodgingUnits(...args),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./LodgingUnitForm', () => ({ LodgingUnitForm: () => <div>UNIT FORM</div> }))
vi.mock('./LodgingAreasDrawer', () => ({ LodgingAreasDrawer: () => <div>AREAS DRAWER</div> }))

import { LodgingUnitsPanel } from './LodgingUnitsPanel'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

async function renderPanel() {
  render(<LodgingUnitsPanel />, { wrapper })
  await waitFor(() => {
    expect(screen.getByText('Cabin A')).toBeInTheDocument()
  })
}

describe('LodgingUnitsPanel', () => {
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
})
