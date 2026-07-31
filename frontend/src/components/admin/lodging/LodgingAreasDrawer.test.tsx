/** Areas serve Units, so they live in a drawer rather than a tab. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const reorderLodgingAreas = vi.fn()
const updateLodgingArea = vi.fn()
const createLodgingArea = vi.fn()

// Module-scoped so `vi.mock` can close over them, so call records and resolved
// values outlive the test that set them unless cleared here.
beforeEach(() => {
  reorderLodgingAreas.mockReset()
  updateLodgingArea.mockReset()
  createLodgingArea.mockReset()
})

vi.mock('../../../services/lodgingCrud', () => ({
  // South Zone sits at 3, not 2: sort_order carries gaps as soon as anything
  // is deleted, and deriving the next value from the list LENGTH silently
  // reissues a value already in use.
  listLodgingAreas: () =>
    Promise.resolve([
      { id: 'a1', name: 'North Zone', code: 'NORTH', map_x: 0.2, map_y: 0.3, sort_order: 1 },
      { id: 'a2', name: 'South Zone', code: 'SOUTH', map_x: 0.6, map_y: 0.7, sort_order: 3 },
    ]),
  createLodgingArea: (...args: unknown[]) => createLodgingArea(...args),
  updateLodgingArea: (...args: unknown[]) => updateLodgingArea(...args),
  deleteLodgingArea: vi.fn(),
  reorderLodgingAreas: (...args: unknown[]) => reorderLodgingAreas(...args),
}))

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }))

import { LodgingAreasDrawer } from './LodgingAreasDrawer'

// One client per TEST, built outside the render path. Constructing it inside
// the wrapper body rebuilds it on every render of the wrapper, discarding the
// cache and starting a fresh loading pass underneath assertions that already
// resolved. (A `useState` initialiser would also fix that, but the hooks lint
// rule rejects a hook in a helper this rule cannot see as a component.)
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function wrapper({ children }: { children: ReactNode }) {
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

  it('derives a new area sort_order from the highest in use, not the list length', async () => {
    // Areas are 1 and 3 here. `length + 1` yields 3 — South Zone's own rank —
    // and groupUnitsByArea breaks that tie on insertion order, so the units
    // table would stack two zones at the same position non-deterministically.
    createLodgingArea.mockResolvedValue({ id: 'a3' })
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('New area'), 'West Zone')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(createLodgingArea).toHaveBeenCalled()
    })
    const [payload] = createLodgingArea.mock.calls[0] as [{ sort_order: number; code: string }]
    expect(payload.sort_order).toBe(4)
  })

  it('keeps area codes uppercase, matching every seeded area', async () => {
    // RIDGE, YURT, GT, HC… — the seed writes uppercase, and `code` is a join
    // key, so a lowercase code here would not match its own family.
    createLodgingArea.mockResolvedValue({ id: 'a3' })
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    await user.type(screen.getByLabelText('New area'), 'West Zone')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(createLodgingArea).toHaveBeenCalled()
    })
    const [payload] = createLodgingArea.mock.calls[0] as [{ sort_order: number; code: string }]
    expect(payload.code).toBe('WEST-ZONE')
  })
})
