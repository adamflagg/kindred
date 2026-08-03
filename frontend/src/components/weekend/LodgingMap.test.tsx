/**
 * The map surface. Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { LodgingMap } from './LodgingMap'
// The token lives with the popover, which `LodgingMap` imports — the reverse
// would close an import cycle.
import { CONSENT_AMBER } from './MapUnitPopover'

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
//
// STATEFUL, because a constant `hasPointerCapture: () => false` is not merely a
// simplification — it models the opposite of the browser. A real capture
// survives until the capturing pointer lifts, and the stray-second-touch test
// below turns entirely on whether the first finger still holds it.
let captured: number | null = null

beforeAll(() => {
  Element.prototype.setPointerCapture = function (pointerId: number) {
    captured = pointerId
  }
  Element.prototype.releasePointerCapture = function () {
    captured = null
  }
  Element.prototype.hasPointerCapture = function (pointerId: number) {
    return captured === pointerId
  }
})

beforeEach(() => {
  captured = null
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

  it('puts the unplaced rail on the same side as the board puts it', () => {
    // LodgingBoard renders `lg:grid-cols-[240px_minmax(0,1fr)]` with the rail
    // first. The map had it last, so switching tabs threw the rail across the
    // screen and the unplaced list moved out from under the cursor.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const rail = screen.getByTestId('map-unplaced-rail')
    const canvas = screen.getByTestId('map-canvas')
    // DOCUMENT_POSITION_FOLLOWING: the canvas comes after the rail.
    expect(rail.compareDocumentPosition(canvas) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
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

  it('keeps panning with the first finger after a stray second touch taps and lifts', () => {
    // The case the pointerId guard above does NOT cover: the second pointer
    // gets its own pointerdown. A thumb brushing the screen mid-pan is enough.
    // If that stray press is allowed to take the drag record, its pointerup
    // then clears the record belonging to the finger actually panning — which
    // is still down and still holds capture, so every subsequent move of it
    // falls through the `!drag` guard and the map freezes solid until the
    // finger lifts. Reproduced in a browser as a map that simply stops.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const canvas = screen.getByTestId('map-canvas')
    const transform = () => screen.getByTestId('map-backdrop').style.transform

    // Zoom first, and drag LEFT, for the same reason the test above does: at
    // k=1 the pan bounds collapse to [0,0] and any assertion here is vacuous.
    fireEvent.wheel(canvas, { deltaY: -600 })
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 240, clientY: 300 })
    const afterFirstMove = transform()

    // The stray thumb: down and up, never moving past the drag threshold.
    fireEvent.pointerDown(canvas, { pointerId: 2, clientX: 800, clientY: 800 })
    fireEvent.pointerUp(canvas, { pointerId: 2, clientX: 800, clientY: 800 })

    // Finger 1 is still down and still panning.
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 180, clientY: 300 })
    expect(transform()).not.toBe(afterFirstMove)
  })

  it('still adopts a fresh pointer when the previous gesture lost its pointerup', () => {
    // The other half of the guard, and the reason it cannot simply refuse
    // every pointerdown while `active`. If an up event is ever lost the map
    // must not be stranded forever — a gesture with no live capture is stale
    // and the next press has to be allowed to replace it.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const canvas = screen.getByTestId('map-canvas')
    const transform = () => screen.getByTestId('map-backdrop').style.transform

    fireEvent.wheel(canvas, { deltaY: -600 })
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 240, clientY: 300 })
    const afterLostGesture = transform()

    // The browser hands the gesture back without an up event.
    captured = null

    fireEvent.pointerDown(canvas, { pointerId: 3, clientX: 300, clientY: 300 })
    fireEvent.pointerMove(canvas, { pointerId: 3, clientX: 200, clientY: 300 })
    expect(transform()).not.toBe(afterLostGesture)
  })

  it('marks a room whose sharing was never consented to, as the board does', () => {
    // #1926 exists to stop a non-consenting shared placement passing
    // unnoticed; the board gives it an amber ring, a warning icon and the
    // reason in text. The map reads the same `consent` flag off the same
    // `buildBoard` slot, so a flagged room must not look like every other
    // shared room here either.
    const declined = party({
      display_name: 'Silva',
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
      share: {
        preference: 'no_share',
        preference_raw: '',
        proximity: [],
        request_text: '',
        needs_resolution: false,
        eligibility: 'declined',
        eligibility_source: 'form',
        answers_conflict: false,
      },
    })
    const sharing = party({
      household_cm_id: 9002,
      display_name: 'Garcia',
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
      share: {
        preference: 'yes_share',
        preference_raw: '',
        proximity: ['with'],
        request_text: '',
        needs_resolution: false,
        eligibility: 'open',
        eligibility_source: 'form',
        answers_conflict: false,
      },
    })
    render(<LodgingMap parties={[declined, sharing]} units={[unit()]} year={2026} />)
    const mark = screen.getByTestId('map-mark')
    // The tooltip says so in words — colour alone is not a signal (WCAG 1.4.1),
    // and the mark has no other text.
    expect(mark.title).toMatch(/sharing not consented/i)
    // And the ring is amber rather than the area hue, so it is findable
    // without hovering every pin.
    expect(mark.querySelector('span')?.style.boxShadow).toContain(CONSENT_AMBER)
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

  it('dots a room beside a bathhouse, rather than hiding it in the peek', () => {
    // Spec §1 names two questions this surface exists to answer, and this is
    // one of them verbatim. Answering it from the peek alone means clicking
    // all 82 pins one at a time, which is what a map is meant to replace.
    render(<LodgingMap parties={[]} units={[unit({ near_bathhouse: true })]} year={2026} />)
    expect(screen.getByTestId('map-mark-bathhouse')).toBeInTheDocument()
  })

  it('leaves a room with no bathhouse undotted', () => {
    render(<LodgingMap parties={[]} units={[unit({ near_bathhouse: false })]} year={2026} />)
    expect(screen.queryByTestId('map-mark-bathhouse')).not.toBeInTheDocument()
  })

  it('marks an unmeasured room with a ?, so it is findable without clicking', () => {
    render(<LodgingMap parties={[]} units={[unit({ sleeps: null })]} year={2026} />)
    expect(screen.getByTestId('map-mark')).toHaveTextContent('?')
  })

  it('does not put a ? on a room whose capacity is known', () => {
    render(<LodgingMap parties={[]} units={[unit({ sleeps: 4 })]} year={2026} />)
    expect(screen.getByTestId('map-mark')).not.toHaveTextContent('?')
  })

  it('fits the map when the bare canvas is double-clicked', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const canvas = screen.getByTestId('map-canvas')
    const transform = () => screen.getByTestId('map-backdrop').style.transform
    const atRest = transform()

    fireEvent.wheel(canvas, { deltaY: -600 })
    expect(transform()).not.toBe(atRest)

    fireEvent.doubleClick(canvas)
    expect(transform()).toBe(atRest)
  })

  it('does not fit when a MARK is double-clicked — a pin says what is in it', () => {
    // Spec §7: "No double-click-to-zoom on a node." The same guard keeps a
    // double-click on a pin from resetting the view out from under the user.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const canvas = screen.getByTestId('map-canvas')
    const transform = () => screen.getByTestId('map-backdrop').style.transform

    fireEvent.wheel(canvas, { deltaY: -600 })
    const zoomed = transform()
    fireEvent.doubleClick(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(transform()).toBe(zoomed)
  })

  it('closes the popover on Escape', async () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
  })

  describe('hover-dwell', () => {
    // Spec §7: the peek opens transiently on a 400ms dwell, tuned in the
    // mockup. §6.2 is why it earns its place — clusters have a long tail, and
    // clicking every pin to read it is the interaction the map replaces.
    // Fake timers are scoped to this block so the click-driven tests above
    // keep running on real ones.
    beforeEach(() => {
      vi.useFakeTimers()
    })
    afterEach(() => {
      vi.useRealTimers()
    })

    function dwellOver(mark: HTMLElement, ms: number) {
      fireEvent.pointerEnter(mark, { pointerType: 'mouse' })
      act(() => {
        vi.advanceTimersByTime(ms)
      })
    }

    it('opens the peek once the pointer has dwelt', () => {
      render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
      dwellOver(screen.getAllByTestId('map-mark')[0] as HTMLElement, 400)
      expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    })

    it('stays shut while the pointer is merely passing over', () => {
      // Without this the peek fires on every pin the cursor crosses on its
      // way somewhere else, which is the behaviour the dwell exists to avoid.
      render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
      dwellOver(screen.getAllByTestId('map-mark')[0] as HTMLElement, 200)
      expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
    })

    it('closes again when the pointer leaves', () => {
      render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
      const mark = screen.getAllByTestId('map-mark')[0] as HTMLElement
      dwellOver(mark, 400)
      expect(screen.getByText('Cedar 1')).toBeInTheDocument()
      fireEvent.pointerLeave(mark, { pointerType: 'mouse' })
      expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
    })

    it('leaves a CLICK-pinned peek open after the pointer leaves', () => {
      // Dwell is transient, click PINS. A pinned peek that evaporated when the
      // cursor moved to read it would be unusable.
      render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
      const mark = screen.getAllByTestId('map-mark')[0] as HTMLElement
      fireEvent.click(mark)
      fireEvent.pointerLeave(mark, { pointerType: 'mouse' })
      expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    })

    it('ignores a touch "hover", which fires alongside the tap', () => {
      // A touch pointerenter arrives with the tap itself, so honouring it
      // would open on dwell and immediately toggle shut on the click.
      render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
      fireEvent.pointerEnter(screen.getAllByTestId('map-mark')[0] as HTMLElement, {
        pointerType: 'touch',
      })
      act(() => {
        vi.advanceTimersByTime(400)
      })
      expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
    })
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

/**
 * The legend and the highlight controls, as approved in the mockup.
 *
 * The mark carries seven encoding channels and no text. Without a key, the blue
 * dot answering "is this family beside a bathhouse" — one of the two questions
 * the surface exists for — is an unexplained dot.
 */
describe('LodgingMap legend', () => {
  it('says what each mark channel means', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const legend = screen.getByTestId('map-legend')
    expect(legend).toHaveTextContent(/empty/i)
    expect(legend).toHaveTextContent(/one party/i)
    expect(legend).toHaveTextContent(/shared/i)
    expect(legend).toHaveTextContent(/staff-default/i)
    expect(legend).toHaveTextContent(/near bathhouse/i)
    expect(legend).toHaveTextContent(/capacity unknown/i)
  })

  it('counts the containers it deliberately did not draw', () => {
    // The 408-vs-389 double count lives in the PR body and nowhere the user can
    // see it. A room count alone reads as "19 rooms are missing".
    const withContainer = [
      ...UNITS,
      unit({ unit_id: 'u3', code: 'cedar-house', name: 'Cedar House', is_container: true }),
    ]
    render(<LodgingMap parties={[]} units={withContainer} year={2026} />)
    const legend = screen.getByTestId('map-legend')
    expect(legend).toHaveTextContent(/2 rooms/)
    expect(legend).toHaveTextContent(/1 container not drawn/)
  })

  it('counts only the multi-room blobs as clusters, not every lone mark', () => {
    // Two rooms on the same coordinate are one blob until you zoom in, and the
    // count is the only thing that says the other room is under there.
    // THE THIRD ROOM IS THE TEST: with only the stacked pair, "clusters" and
    // "clusters with more than one member" are both 1 and the assertion cannot
    // tell a correct count from a count of every mark on the map.
    const stacked = [
      unit({ unit_id: 'u1', code: 'a', name: 'A', map_x: 0.5, map_y: 0.5 }),
      unit({ unit_id: 'u2', code: 'b', name: 'B', map_x: 0.5, map_y: 0.5 }),
      unit({ unit_id: 'u3', code: 'c', name: 'C', map_x: 0.1, map_y: 0.9 }),
    ]
    render(<LodgingMap parties={[]} units={stacked} year={2026} />)
    expect(screen.getByTestId('map-legend')).toHaveTextContent(/1 cluster at this zoom/)
  })
})

describe('LodgingMap highlight controls', () => {
  const BATH = unit({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1', near_bathhouse: true })
  const STAFF = unit({
    unit_id: 'u2',
    code: 'cedar-2',
    name: 'Cedar 2',
    map_x: 0.7,
    map_y: 0.2,
    allocation_default: 'staff_default',
  })

  it('draws empty rooms by default', () => {
    render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />)
    expect(screen.getAllByTestId('map-mark')).toHaveLength(2)
  })

  it('hides empty rooms when the empty-rooms toggle is cleared', async () => {
    render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getByLabelText('Empty rooms'))
    const marks = screen.getAllByTestId('map-mark')
    expect(marks).toHaveLength(1)
    expect(marks[0]).toHaveAttribute('title', expect.stringContaining('Cedar 1'))
  })

  it('dims the rooms with no bathhouse when near-bathhouse highlighting is on', async () => {
    render(<LodgingMap parties={[]} units={[BATH, STAFF]} year={2026} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Near bathhouse' }))
    expect(screen.getByTitle(/Cedar 1/)).toHaveStyle({ opacity: '1' })
    expect(screen.getByTitle(/Cedar 2/)).toHaveStyle({ opacity: '0.22' })
  })

  it('dims the rooms with no staff cabin when staff highlighting is on', async () => {
    render(<LodgingMap parties={[]} units={[BATH, STAFF]} year={2026} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Staff cabins' }))
    expect(screen.getByTitle(/Cedar 2/)).toHaveStyle({ opacity: '1' })
    expect(screen.getByTitle(/Cedar 1/)).toHaveStyle({ opacity: '0.22' })
  })

  it('leaves every mark at full strength when no highlight is on', () => {
    render(<LodgingMap parties={[]} units={[BATH, STAFF]} year={2026} />)
    expect(screen.getByTitle(/Cedar 1/)).toHaveStyle({ opacity: '1' })
    expect(screen.getByTitle(/Cedar 2/)).toHaveStyle({ opacity: '1' })
  })

  it('lets one highlight replace the other rather than competing with it', async () => {
    // As two checkboxes these ANDed, so ticking both dimmed nearly everything
    // and read as a filter that had eaten the map. They answer two different
    // questions about the same marks; only one can be asked at a time.
    render(<LodgingMap parties={[]} units={[BATH, STAFF]} year={2026} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Near bathhouse' }))
    await userEvent.click(screen.getByRole('radio', { name: 'Staff cabins' }))

    expect(screen.getByRole('radio', { name: 'Near bathhouse' })).not.toBeChecked()
    // The staff answer, whole — not the empty intersection of both questions.
    expect(screen.getByTitle(/Cedar 2/)).toHaveStyle({ opacity: '1' })
  })

  it('turns every highlight off again', async () => {
    render(<LodgingMap parties={[]} units={[BATH, STAFF]} year={2026} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Staff cabins' }))
    await userEvent.click(screen.getByRole('radio', { name: 'No highlight' }))
    expect(screen.getByTitle(/Cedar 1/)).toHaveStyle({ opacity: '1' })
    expect(screen.getByTitle(/Cedar 2/)).toHaveStyle({ opacity: '1' })
  })

  it('keeps area tint and empty rooms independent of the highlight', async () => {
    // These two do not compete with anything: one is a backdrop, the other
    // changes which rooms exist on the map at all.
    render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getByRole('radio', { name: 'Near bathhouse' }))
    await userEvent.click(screen.getByLabelText('Area tint'))
    await userEvent.click(screen.getByLabelText('Empty rooms'))

    expect(screen.getByRole('radio', { name: 'Near bathhouse' })).toBeChecked()
    expect(screen.getByLabelText('Area tint')).toBeChecked()
    expect(screen.getAllByTestId('map-mark')).toHaveLength(1)
  })

  it('tints areas only once the area tint is switched on', async () => {
    // Off by default: the background labels its own areas, and a tint over an
    // illustration fights it. On demand it answers "where does this area end".
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.queryAllByTestId('map-area-tint')).toHaveLength(0)
    await userEvent.click(screen.getByLabelText('Area tint'))
    expect(screen.getAllByTestId('map-area-tint')).toHaveLength(1)
  })

  it('shows the fade percentage and follows the slider', () => {
    // Asserting only the initial 25% would pass against a hardcoded string.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByTestId('map-fade-value')).toHaveTextContent('25%')
    fireEvent.change(screen.getByLabelText(/fade map/i), { target: { value: '60' } })
    expect(screen.getByTestId('map-fade-value')).toHaveTextContent('60%')
  })

  it('says how to zoom, pan and open a pin', () => {
    // Wheel-zoom and drag-pan have no affordance of their own. Without this
    // line the map reads as a static picture.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByText(/scroll to zoom/i)).toBeInTheDocument()
  })

  it('labels the fit control in words, not only for screen readers', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByRole('button', { name: /fit all/i })).toBeInTheDocument()
  })
})
