/** Areas serve Units, so they live in a drawer rather than a tab. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CurrentYearContext, type CurrentYearContextType } from '../../../hooks/useCurrentYear'

const reorderLodgingAreas = vi.fn()
const updateLodgingArea = vi.fn()
const createLodgingArea = vi.fn()
const deleteLodgingArea = vi.fn()
const listLodgingAreas = vi.fn()

const AREAS = [
  { id: 'a1', name: 'North Zone', code: 'NORTH', map_x: 0.2, map_y: 0.3, sort_order: 1 },
  { id: 'a2', name: 'South Zone', code: 'SOUTH', map_x: 0.6, map_y: 0.7, sort_order: 3 },
]

// PocketBase stores an unset centroid as 0, never null (see mapModel.ts's
// hasCoordinates). This is the shape #2397's "must stay unset" guarantee is
// about. Kept out of the shared AREAS fixture — several tests above assert
// on exact sort_order arithmetic derived from AREAS, and a third row would
// shift every one of them.
const UNSET_CENTROID_AREA = {
  id: 'a3',
  name: 'Unset Zone',
  code: 'UNSET',
  map_x: 0,
  map_y: 0,
  sort_order: 5,
}

// Module-scoped so `vi.mock` can close over them, so call records and resolved
// values outlive the test that set them unless cleared here.
beforeEach(() => {
  reorderLodgingAreas.mockReset()
  updateLodgingArea.mockReset()
  createLodgingArea.mockReset()
  deleteLodgingArea.mockReset().mockResolvedValue(undefined)
  listLodgingAreas.mockReset().mockResolvedValue(AREAS)
  // jsdom has no confirm(); default to "the staffer clicked OK" so only the
  // tests that care about cancelling have to say so.
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

// South Zone sits at 3, not 2: sort_order carries gaps as soon as anything is
// deleted, and deriving the next value from the list LENGTH silently reissues
// a value already in use.
vi.mock('../../../services/lodgingCrud', () => ({
  listLodgingAreas: (...args: unknown[]) => listLodgingAreas(...args),
  createLodgingArea: (...args: unknown[]) => createLodgingArea(...args),
  updateLodgingArea: (...args: unknown[]) => updateLodgingArea(...args),
  deleteLodgingArea: (...args: unknown[]) => deleteLodgingArea(...args),
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
// configured year (`useCurrentYear.ts`). The areas query must not fire
// against `year = 0` in that window — PocketBase answers with a successful
// `200 []`, not an error, so an ungated query renders a false empty state.
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

describe('LodgingAreasDrawer', () => {
  it('asks for the current season only', async () => {
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })
    expect(listLodgingAreas).toHaveBeenCalledWith(2026)
  })

  it('does not fetch until the year resolves, even while open', () => {
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper: zeroYearWrapper })
    expect(listLodgingAreas).not.toHaveBeenCalled()
  })

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

  it('renders no Map centre inputs — there is no map to place them against (#2397)', async () => {
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    expect(screen.queryByLabelText('North Zone map X')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('North Zone map Y')).not.toBeInTheDocument()
    expect(screen.queryByText('Map centre')).not.toBeInTheDocument()
  })

  it('leaves an unset centroid unset when a different field is edited', async () => {
    // The centroid inputs are gone, so nothing in this drawer should ever
    // put map_x/map_y on a write again. An area whose centroid is unset
    // (map_x: 0, map_y: 0 — PocketBase's convention, not null) must stay
    // that way rather than getting overwritten as a side effect of editing
    // its name.
    listLodgingAreas.mockResolvedValue([...AREAS, UNSET_CENTROID_AREA])
    updateLodgingArea.mockResolvedValue({})
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('Unset Zone')).toBeInTheDocument()
    })

    const name = screen.getByLabelText('Unset Zone name')
    await user.clear(name)
    await user.type(name, 'Renamed Zone')
    await user.tab()

    await waitFor(() => {
      expect(updateLodgingArea).toHaveBeenCalledWith('a3', { name: 'Renamed Zone' })
    })
    const [, payload] = updateLodgingArea.mock.calls[0] as [string, Record<string, unknown>]
    expect(payload).not.toHaveProperty('map_x')
    expect(payload).not.toHaveProperty('map_y')
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

  it('stamps a new area with the current season', async () => {
    // Areas are year-scoped since 1500000141; an omitted year fails the
    // schema's min:2010 the moment the create reaches PocketBase.
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
    const [payload] = createLodgingArea.mock.calls[0] as [{ year: number }]
    expect(payload.year).toBe(2026)
  })
})

describe('LodgingAreasDrawer — a rejected edit', () => {
  // The inputs are uncontrolled (defaultValue), which React reads once on
  // mount, and refresh() only runs on success. So a rejected rename left the
  // value PocketBase refused sitting in the field, indistinguishable from a
  // saved one, and it survived every later refetch.
  it('restores the stored name when the rename is rejected', async () => {
    updateLodgingArea.mockRejectedValue(new Error('nope'))
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    const field = screen.getByLabelText('North Zone name')
    await user.clear(field)
    await user.type(field, 'Northern Zone')
    await user.tab()

    await waitFor(() => {
      expect(updateLodgingArea).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(screen.getByLabelText('North Zone name')).toHaveValue('North Zone')
    })
  })
})

describe('LodgingAreasDrawer — deleting an area', () => {
  // The units table deliberately never offers delete (spec §3.8). Areas do,
  // and an area with no units deletes silently and unrecoverably.
  it('asks before deleting', async () => {
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Delete North Zone' }))

    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() => {
      expect(deleteLodgingArea).toHaveBeenCalledWith('a1')
    })
  })

  it('deletes nothing when the staffer cancels', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })
    await waitFor(() => {
      expect(screen.getByDisplayValue('North Zone')).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: 'Delete North Zone' }))

    expect(deleteLodgingArea).not.toHaveBeenCalled()
  })
})

describe('LodgingAreasDrawer — areas query states', () => {
  // `areas` fell back to [] for both pending and failed. The drawer then
  // rendered an empty list with a live Add button, and the next sort_order
  // computed off nothing — landing on 1, a rank an existing area already holds.
  it('does not offer Add while the areas are still loading', async () => {
    listLodgingAreas.mockReturnValue(new Promise(() => undefined))
    const user = userEvent.setup()
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })

    // Type a name first: Add is disabled on an empty name regardless, so
    // asserting on the pristine form would pass without the query guard.
    await user.type(screen.getByLabelText('New area'), 'West Zone')
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('reports a failed areas fetch rather than showing an empty list', async () => {
    listLodgingAreas.mockRejectedValue(new Error('network'))
    render(<LodgingAreasDrawer open onClose={vi.fn()} />, { wrapper })

    // Wait on the error text, not the disabled button: Add is disabled while
    // the query is merely pending too, so that assertion settles too early.
    await waitFor(() => {
      expect(screen.getByText(/could not be loaded/i)).toBeInTheDocument()
    })
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
})
