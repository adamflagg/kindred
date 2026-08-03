/**
 * The map surface. Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { LodgingMap } from './LodgingMap'

// Opening a family opens FamilyDetailsPanel, which reaches AccessibilityFlagList
// -> usePermissions -> useAuth and throws without a provider. Mocked exactly as
// LodgingBoard.test.tsx and FamilyDetailsPanel.test.tsx do, because the same
// panel is being opened here.
vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
}))

// One client per TEST, built outside the render path. Constructing it inside the
// wrapper body rebuilds it on every render, discarding the cache and starting a
// fresh loading pass underneath assertions that already resolved.
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

// jsdom implements no Pointer Capture API. Without these the drag path throws an
// uncaught TypeError at `setPointerCapture`, which vitest reports as an
// unhandled error and — worse — aborts the handler BEFORE it pans, so a test
// meaning to exercise a drag silently exercises nothing and still goes green.
// Plain functions, not vi.fn(), so the global `clearAllMocks` in
// `src/test/setup.ts` cannot interact with them.
beforeAll(() => {
  Element.prototype.setPointerCapture = () => {}
  Element.prototype.releasePointerCapture = () => {}
  Element.prototype.hasPointerCapture = () => false
})

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 4,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    allocation_default: 'family_pool',
    reservation_state: null,
    is_family_available: true,
    map_x: 0.4,
    map_y: 0.5,
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 9001,
    person_cm_id: 0,
    display_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
      needs_resolution: false,
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
      has_medical_narrative: false,
    },
    ...overrides,
  }
}

const UNITS = [
  unit(),
  unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2', map_x: 0.7, map_y: 0.2 }),
]

/** One party in cedar-1, so a mark has an occupant to open. */
const PLACED = party({ display_name: 'Johnson', unit_code: 'cedar-1', unit_name: 'Cedar 1' })

describe('LodgingMap', () => {
  it('draws a mark for every positioned room', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getAllByTestId('map-mark')).toHaveLength(2)
  })

  it('still draws the marks when the camp map image fails to load', () => {
    // A fresh clone without the private repo, and CI, have no asset. An empty
    // box reads as "no cabins" rather than "the picture is missing".
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    fireEvent.error(screen.getByTestId('map-backdrop'))
    expect(screen.getAllByTestId('map-mark')).toHaveLength(2)
    expect(screen.getByText(/map image unavailable/i)).toBeInTheDocument()
  })

  it('says it is a read-only CampMinder mirror, as the board does', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByText(/CampMinder mirror, read-only/i)).toBeInTheDocument()
  })

  it('opens a popover when a mark is clicked', async () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
  })

  it('lists an unplaced party on the unplaced rail', () => {
    render(<LodgingMap parties={[party({ display_name: 'Silva' })]} units={UNITS} year={2026} />)
    // Scoped to the rail, matching the off-map assertion below. An unscoped
    // getByText would pass if the party were rendered anywhere at all —
    // including the rail it must NOT be on.
    expect(screen.getByTestId('map-unplaced-rail')).toHaveTextContent('Silva')
  })

  it('lists a merged party as placed but off the map, never as unplaced', () => {
    const merged = party({
      display_name: 'Nguyen',
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      is_merged_slot: true,
    })
    render(<LodgingMap parties={[merged]} units={UNITS} year={2026} />)
    const rail = screen.getByTestId('map-offmap-rail')
    expect(rail).toHaveTextContent('Nguyen')
  })

  it('opens the family panel embedded in the sidebar, not as an overlay', async () => {
    // FamilyDetailsPanel exists in one copy for both surfaces; `embedded` is the
    // mode it provides for this one. Its embedded branch renders the
    // family-details-panel testid without the overlay's click-outside layer.
    render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />, { wrapper })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
  })

  it('ignores a second pointer so a two-finger gesture cannot steer the pan', () => {
    // touch-none disables native panning, so a second touch point is a real
    // input path. Before the pointerId guard, the second pointer's moves were
    // applied against the first pointer's baseline and the map jittered.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const canvas = screen.getByTestId('map-canvas')
    const transform = () => screen.getByTestId('map-backdrop').style.transform

    // ZOOM IN FIRST, and this is load-bearing rather than incidental setup.
    // At k=1 clampView's pan bounds are [width - width*1, 0] = [0, 0], so EVERY
    // drag clamps straight back to identity — correct no-gutter behaviour, and
    // it makes a pan assertion at rest vacuous whether or not the guard works.
    fireEvent.wheel(canvas, { deltaY: -600 })
    const zoomed = transform()

    // Drag LEFT. A rightward drag wants a positive tx, which clamps to 0 at any
    // zoom, so it would be equally vacuous.
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 240, clientY: 300 })
    const afterFirst = transform()
    // Both halves matter. Asserting only that the second pointer changes nothing
    // would also pass if the FIRST pointer had done nothing either.
    expect(afterFirst).not.toBe(zoomed)

    fireEvent.pointerMove(canvas, { pointerId: 2, clientX: 900, clientY: 900 })
    expect(transform()).toBe(afterFirst)
  })

  it('reports rooms nobody has positioned rather than dropping them silently', () => {
    render(
      <LodgingMap
        parties={[]}
        units={[...UNITS, unit({ unit_id: 'u3', code: 'cedar-3', map_x: 0, map_y: 0 })]}
        year={2026}
      />
    )
    expect(screen.getByText(/1 room has no position/i)).toBeInTheDocument()
  })

  it('prevents the page from scrolling under a wheel-zoom', () => {
    // React 19 registers wheel listeners as PASSIVE at the root, so
    // `event.preventDefault()` inside a JSX `onWheel` handler is silently
    // ignored — wheeling the map zooms it AND scrolls the page beneath it.
    // A `{ passive: false }` native listener is the only way to prove this.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const canvas = screen.getByTestId('map-canvas')
    const wheelEvent = new WheelEvent('wheel', { deltaY: -100, cancelable: true, bubbles: true })
    canvas.dispatchEvent(wheelEvent)
    expect(wheelEvent.defaultPrevented).toBe(true)
  })

  it('renders a mixed staff/family cluster the same shape regardless of member order', () => {
    // Close enough (2px apart on the 1000px jsdom fallback canvas) to cluster
    // into one mark. Mixing allocation_default is the case that flips with
    // whichever row the database happens to return first if the mark reads
    // its shape off `members[0]` instead of the whole cluster.
    const staffMix = [
      unit({ unit_id: 'sm1', code: 'family-a', map_x: 0.5, map_y: 0.5 }),
      unit({
        unit_id: 'sm2',
        code: 'staff-a',
        map_x: 0.502,
        map_y: 0.5,
        allocation_default: 'staff_default',
      }),
    ]
    const shapeOf = (units: LodgingUnitRow[]) => {
      const { unmount } = render(<LodgingMap parties={[]} units={units} year={2026} />)
      const mark = screen.getByTestId('map-mark').querySelector('span')
      const shape = { borderRadius: mark?.style.borderRadius, borderStyle: mark?.style.borderStyle }
      unmount()
      return shape
    }
    const forward = shapeOf(staffMix)
    const reversed = shapeOf([...staffMix].reverse())
    expect(forward).toEqual(reversed)
    // Mixed, not ALL staff: SHAPE (radius) must read as an ordinary round
    // mark — a cluster is only "a staff building" if every member is one —
    // but the mix still HIGHLIGHTS (dashed border) rather than reading as an
    // ordinary building with nothing staff-related about it.
    expect(forward).toEqual({ borderRadius: '50%', borderStyle: 'dashed' })
  })

  it('closes the popover when the canvas background is clicked', async () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    await userEvent.click(screen.getByTestId('map-canvas'))
    expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
  })

  it('closes the popover on Escape', async () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
  })

  it('keeps the popover inside the canvas when the mark sits near an edge', async () => {
    // Fallback canvas in jsdom is 1000 x (1000 / MAP_ASPECT). A mark at
    // (0.98, 0.98) sits at roughly (980, 980) unclamped — hard against the
    // corner, with most of a ~260px-wide popover run off both edges.
    render(<LodgingMap parties={[]} units={[unit({ map_x: 0.98, map_y: 0.98 })]} year={2026} />)
    await userEvent.click(screen.getByTestId('map-mark'))
    const popoverBox = screen.getByText('Cedar 1').closest('[data-map-popover]')
    const container = popoverBox?.parentElement as HTMLElement
    const left = Number.parseFloat(container.style.left)
    const top = Number.parseFloat(container.style.top)
    expect(left).toBeLessThan(980)
    expect(top).toBeLessThan(980)
  })
})
