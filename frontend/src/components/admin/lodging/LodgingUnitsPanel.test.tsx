/** Units list: deactivate, never delete; containers labelled; 0 is unknown. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const deactivateLodgingUnit = vi.fn()

vi.mock('../../../services/lodgingCrud', () => ({
  listLodgingUnits: () =>
    Promise.resolve([
      {
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
      },
      {
        id: 'u2',
        area: 'area_1',
        name: 'North Lodge',
        code: 'north-lodge',
        parent_unit: '',
        map_x: 0.4,
        map_y: 0.5,
        sleeps: 7,
        bathroom: 'shared',
        bathroom_group: 'north-lodge',
        near_bathhouse: false,
        has_power: true,
        has_ac: false,
        has_fridge: false,
        is_accessible: false,
        allocation_default: 'family_pool',
        is_confirmed: true,
        is_active: true,
        is_container: true,
        notes: '',
      },
    ]),
  listLodgingAreas: () =>
    Promise.resolve([
      { id: 'area_1', name: 'North Zone', code: 'NORTH', map_x: 0.3, map_y: 0.2, sort_order: 1 },
    ]),
  deactivateLodgingUnit: (...args: unknown[]) => deactivateLodgingUnit(...args),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))
vi.mock('./LodgingUnitForm', () => ({ LodgingUnitForm: () => <div>UNIT FORM</div> }))

import { LodgingUnitsPanel } from './LodgingUnitsPanel'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('LodgingUnitsPanel', () => {
  it('renders unknown capacity as an em dash', async () => {
    render(<LodgingUnitsPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('Cabin A')).toBeInTheDocument()
    })
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('labels container rows as buildings', async () => {
    render(<LodgingUnitsPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('North Lodge')).toBeInTheDocument()
    })
    expect(screen.getByText('Building')).toBeInTheDocument()
  })

  it('flags an unconfirmed unit, because the roster cannot judge fit against it', async () => {
    render(<LodgingUnitsPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('Cabin A')).toBeInTheDocument()
    })
    // Exactly one of the two fixtures is unconfirmed.
    expect(screen.getAllByText('Unconfirmed')).toHaveLength(1)
  })

  it('offers deactivate, never delete', async () => {
    render(<LodgingUnitsPanel />, { wrapper })
    await waitFor(() => {
      expect(screen.getByText('Cabin A')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: /^delete/i })).not.toBeInTheDocument()

    const user = userEvent.setup()
    const [firstDeactivate] = screen.getAllByRole('button', { name: 'Deactivate' })
    await user.click(firstDeactivate as HTMLElement)
    await waitFor(() => {
      expect(deactivateLodgingUnit).toHaveBeenCalledWith('u1')
    })
  })
})
