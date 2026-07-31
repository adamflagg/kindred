/** Areas serve Units, so they live in a drawer rather than a tab. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'

const reorderLodgingAreas = vi.fn()
const updateLodgingArea = vi.fn()

vi.mock('../../../services/lodgingCrud', () => ({
  listLodgingAreas: () =>
    Promise.resolve([
      { id: 'a1', name: 'North Zone', code: 'NORTH', map_x: 0.2, map_y: 0.3, sort_order: 1 },
      { id: 'a2', name: 'South Zone', code: 'SOUTH', map_x: 0.6, map_y: 0.7, sort_order: 2 },
    ]),
  createLodgingArea: vi.fn(),
  updateLodgingArea: (...args: unknown[]) => updateLodgingArea(...args),
  deleteLodgingArea: vi.fn(),
  reorderLodgingAreas: (...args: unknown[]) => reorderLodgingAreas(...args),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import { LodgingAreasDrawer } from './LodgingAreasDrawer'

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

describe('LodgingAreasDrawer', () => {
  it('renders nothing when closed', () => {
    render(<LodgingAreasDrawer open={false} onClose={vi.fn()} />, { wrapper })
    expect(screen.queryByText('North Zone')).not.toBeInTheDocument()
  })

  it('lists areas in sort order when open', async () => {
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })
    expect(screen.getByDisplayValue('South Zone')).toBeInTheDocument()
  })

  it('hides area codes, which only the back end needs', async () => {
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })
    expect(screen.queryByDisplayValue('NORTH')).not.toBeInTheDocument()
  })

  it('moves an area down and persists the new order', async () => {
    reorderLodgingAreas.mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Move North Zone down' }))

    await waitFor(() => {
      expect(reorderLodgingAreas).toHaveBeenCalledWith(['a2', 'a1'])
    })
  })

  it('offers no move-up on the first area', async () => {
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Move North Zone up' })).not.toBeInTheDocument()
  })

  it('saves a map centroid, which the later map view renders from', async () => {
    updateLodgingArea.mockResolvedValue({})
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    const x = screen.getByLabelText('North Zone map X')
    await user.clear(x)
    await user.type(x, '0.45')
    await user.tab()

    await waitFor(() => {
      expect(updateLodgingArea).toHaveBeenCalledWith('a1', { map_x: 0.45 })
    })
  })
})
