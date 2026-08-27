/**
 * The map surface. Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'fs'
import { resolve } from 'path'
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

// `medicalFetchMode.real` toggles this file's ONE `useHouseholdMedical` mock
// between the fast canned value every other suite in this file wants and the
// REAL hook, wired through the mocked `fetchHouseholdMedical` service call
// below -- so "the actual medical fetch" describe block near the bottom of this
// file can drive the genuine fetch path without touching the rest of this
// file's tests, which never flip it. `vi.hoisted` is required: `vi.mock`
// factories run before any other module-level code, so a plain `const`
// referenced inside one would be a use-before-initialization error.
const { medicalFetchMode, mockFetchHouseholdMedical } = vi.hoisted(() => ({
  medicalFetchMode: { real: false },
  mockFetchHouseholdMedical: vi.fn(),
}))

vi.mock('../../services/lodgingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/lodgingApi')>()
  return {
    ...actual,
    fetchHouseholdMedical: (...args: unknown[]) =>
      (mockFetchHouseholdMedical as (...a: unknown[]) => unknown)(...args),
  }
})

vi.mock('../../hooks/useWeekendRoster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useWeekendRoster')>()
  return {
    ...actual,
    useHouseholdMedical: (year: number, householdCmId: number | null, enabled: boolean) =>
      medicalFetchMode.real
        ? actual.useHouseholdMedical(year, householdCmId, enabled)
        : { data: undefined, isLoading: false, error: null },
  }
})

// Only reached when `medicalFetchMode.real` is true — `useHouseholdMedical`
// itself is mocked away for every other test in this file, so it never
// invokes `useApiWithAuth` for them.
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
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
    inventory_class: 'family_pool',
    family_available_override: null,
    reason: '',
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
    sort_name: 'Johnson',
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

  it('leaves the mode to the header badge, as the board does', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.queryByText(/CampMinder mirror/i)).not.toBeInTheDocument()
  })

  it('opens a popover when a mark is clicked', async () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
  })

  it('has no unplaced rail beside the canvas', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.queryByTestId('map-unplaced-rail')).not.toBeInTheDocument()
  })

  it('grades the need glyphs of a party placed off the map, against its real cabin', () => {
    /*
     * ⚠️ THIS PINS A PROP THAT WAS LOAD-BEARING AND UNDEFENDED (post-merge
     * review of #2505, P1-3). The `unit={resolvePartyUnit(...)}` on this
     * section's `FamilyCard` could be DELETED with the whole weekend suite
     * green — 43 files, 1415 tests — and `FamilyCardProps.unit` is optional,
     * so `tsc` said nothing either.
     *
     * What deleting it does: `resolveNeedGlyphs(party, undefined)` returns
     * every asked need at `fits`, so this section would draw a family's power
     * glyph in its full hue — a positive claim that a cabin meets a need,
     * about a cabin this surface never resolved. The card used to print "Fit
     * not verified" in that situation and that chip is struck (vocabulary §3),
     * so the glyph is now the only carrier.
     *
     * `no-coordinates` is the reachable shape: the cabin is REAL and in the
     * payload — it simply has no pin on the map — so `resolvePartyUnit`
     * resolves it and the grading is available if the prop asks for it.
     */
    // `power_coverage` has to be set explicitly: this file's `unit()` helper
    // carries none of the resolved coverage columns, which is a large part of
    // why nothing here exercised the glyph grading in the first place.
    const unpinned = unit({
      unit_id: 'u9',
      code: 'attic-1',
      name: 'Attic 1',
      map_x: null,
      map_y: null,
      power_coverage: 'none',
    })
    render(
      <LodgingMap
        parties={[
          party({
            display_name: 'Garcia',
            unit_code: 'attic-1',
            unit_name: 'Attic 1',
            flags: { needs_power: true },
          }),
        ]}
        units={[...UNITS, unpinned]}
        year={2026}
      />
    )
    expect(screen.getByText(/Placed, off the map/i)).toBeInTheDocument()
    // The cabin resolves `power_coverage: 'none'`, so the need is UNMET and
    // the glyph takes the warn fill. Passing no unit would make this `fits`
    // and drop the fill entirely.
    expect(screen.getByTestId('need-glyph-power').className).toContain('bg-red-100')
  })

  it('puts an unplaced party in the corner queue', async () => {
    render(
      <LodgingMap
        parties={[
          party({
            display_name: 'Silva',
            sort_name: 'Silva',
            // kindred#2074: the card leads with the children now, and the
            // fixture's default `children: []` renders no accessible name at
            // all for a household party -- a real one always has at least
            // one child (see `_build_household_parties`), so give it one.
            children: [{ person_cm_id: 9101, display_name: 'Mia Silva', age: 7, grade: 1 }],
          }),
        ]}
        units={UNITS}
        year={2026}
      />
    )
    await userEvent.click(screen.getByRole('button', { name: /1 unplaced parties/i }))
    expect(screen.getByTestId('family-card-name')).toHaveTextContent('Mia Silva')
  })

  it('lists a merged party below the map, never as unplaced', async () => {
    const merged = party({
      display_name: 'Nguyen',
      sort_name: 'Nguyen',
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      is_merged_slot: true,
      // kindred#2074: same reason as 'Silva' above -- a household party
      // needs a child to have any accessible name on the card.
      children: [{ person_cm_id: 9102, display_name: 'Leo Nguyen', age: 9, grade: 3 }],
    })
    render(<LodgingMap parties={[merged]} units={UNITS} year={2026} />)

    const section = screen.getByTestId('map-offmap-section')
    expect(section).toHaveTextContent('Nguyen')

    // DOCUMENT_POSITION_FOLLOWING: the section comes after the canvas.
    const canvas = screen.getByTestId('map-canvas')
    expect(canvas.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    // And it is placed, so it is not in the queue.
    expect(screen.getByRole('button', { name: /0 unplaced parties/i })).toBeInTheDocument()
  })

  it('opens the family panel as the board does — a slide-in overlay, not a sidebar', async () => {
    // FamilyDetailsPanel exists in one copy for both surfaces — the board and
    // the map both open the same slide-in overlay summer opens.
    render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />, { wrapper })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
    expect(screen.getByTestId('family-panel-backdrop')).toBeInTheDocument()
  })

  describe('panning does not fight the panel dismissal', () => {
    // `useDismissOnDeadSpace` listens for `click` on the document, and the
    // canvas is a bare div that matches none of `shouldKeepPanelsOpen`'s
    // exemptions (panel, badge, button, card). A pan gesture ends in a click
    // on that same div — without the guard below, every pan closes an open
    // panel out from under the user, which is the opposite of what the
    // canvas's own `onClick` already protects the peek from for the same
    // reason.
    async function openPanel() {
      render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />, { wrapper })
      await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
      await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
      // The dismissal listener attaches a macrotask after `isOpen` flips
      // true (see useDismissOnDeadSpace's own docstring); let it, or the
      // assertions below would pass for the wrong reason — nothing
      // listening yet, rather than the guard actually working.
      await new Promise((resolve) => setTimeout(resolve, 0))
      return screen.getByTestId('map-canvas')
    }

    it('does not dismiss the panel when a click concludes a pan', async () => {
      const canvas = await openPanel()
      // The same pan the drag tests below drive: past DRAG_THRESHOLD_PX so
      // `drag.active` flips true, exactly like a real pan. A real browser
      // follows a drag like this with a click on the same element.
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 300, clientY: 300 })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 240, clientY: 300 })
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 240, clientY: 300 })
      fireEvent.click(canvas)
      expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-in-right')
    })

    it('still dismisses the panel on a click that never moved', async () => {
      // A click that never crossed the threshold is genuine dead space, and
      // must still close the panel — the fix above must not swallow every
      // canvas click, only the ones that concluded a real pan.
      const canvas = await openPanel()
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 300, clientY: 300 })
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 300, clientY: 300 })
      fireEvent.click(canvas)
      expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
    })

    it('does not let a pan taken with no panel open swallow a later dead-space click', async () => {
      // The ordering the two tests above cannot reach: the pan happens while
      // NOTHING is open, so whatever the pan records has no consumer at the
      // time it is recorded. The panel is then opened from the floating
      // badge, which is a DOM sibling of the canvas — that path runs none of
      // the canvas's pointer handlers, so it cannot overwrite the record on
      // its way past. (Opening from a mark would: the mark lives inside the
      // canvas, so its own click's pointerup goes through the canvas.)
      //
      // If anything survives that far, the first genuine dead-space click is
      // spent clearing it instead of closing the panel, and the user has to
      // click twice.
      render(
        <LodgingMap
          parties={[
            party({
              display_name: 'Garcia',
              sort_name: 'Garcia',
              // kindred#2074: same reason as 'Silva' above -- a household
              // party needs a child to have any accessible name on the card.
              children: [{ person_cm_id: 9103, display_name: 'Ivy Garcia', age: 5, grade: 0 }],
            }),
          ]}
          units={UNITS}
          year={2026}
        />,
        { wrapper }
      )
      const canvas = screen.getByTestId('map-canvas')

      // A complete pan gesture, trailing click included, with no panel open.
      fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 300, clientY: 300 })
      fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 240, clientY: 300 })
      fireEvent.pointerUp(canvas, { pointerId: 1, clientX: 240, clientY: 300 })
      fireEvent.click(canvas)

      await userEvent.click(screen.getByRole('button', { name: /1 unplaced parties/i }))
      await userEvent.click(screen.getByRole('button', { name: /Garcia/ }))
      expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-in-right')
      await new Promise((resolve) => setTimeout(resolve, 0))

      // The page background is dead space by every measure — it matches none
      // of `shouldKeepPanelsOpen`'s exemptions and it is nowhere near the
      // canvas. The FIRST such click must close the panel.
      fireEvent.click(document.body)
      expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
    })
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

  it('draws NO halo on a consented shared room — the mark is struck (kindred#2179)', () => {
    // The board's shared-space ring was struck on 2026-08-09 because it fired
    // on the units DESIGNED to hold several families, so it was on almost all
    // the time. #2193 made the precedence rule shared via `ringPrecedence.ts`,
    // which is exactly why this test exists on the map too: striking the ring
    // on the board and leaving the halo here is the half-fix, and it would
    // leave the two surfaces disagreeing about what a shared space looks like.
    const consenting = {
      preference: 'yes_share' as const,
      preference_raw: '',
      proximity: [],
      request_text: '',
      needs_resolution: false,
      eligibility: 'open' as const,
      eligibility_source: 'form' as const,
    }
    render(
      <LodgingMap
        parties={[
          party({
            display_name: 'Johnson',
            unit_code: 'cedar-1',
            unit_name: 'Cedar 1',
            share: consenting,
          }),
          party({
            household_cm_id: 9002,
            display_name: 'Garcia',
            unit_code: 'cedar-1',
            unit_name: 'Cedar 1',
            share: consenting,
          }),
        ]}
        units={[unit()]}
        year={2026}
      />
    )
    const halo = screen.getByTestId('map-mark').querySelector('span')?.style.boxShadow
    // The plain white outline every other mark wears, and nothing beyond it.
    expect(halo).not.toMatch(/4\.5px/)
    expect(halo).toMatch(/rgba\(255, ?255, ?255/)
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
    // into one mark. Mixing inventory_class is the case that flips with
    // whichever row the database happens to return first if the mark reads
    // its shape off `members[0]` instead of the whole cluster.
    const staffMix = [
      unit({ unit_id: 'sm1', code: 'family-a', map_x: 0.5, map_y: 0.5 }),
      unit({
        unit_id: 'sm2',
        code: 'staff-a',
        map_x: 0.502,
        map_y: 0.5,
        inventory_class: 'staff_default',
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
    // staff-default and near-bathhouse moved to the shared Visual Guide
    // (kindred#1997) — the map's own legend keeps only what still has no
    // control of its own to explain it.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const legend = screen.getByTestId('map-legend')
    expect(legend).toHaveTextContent(/empty/i)
    expect(legend).toHaveTextContent(/one party/i)
    expect(legend).toHaveTextContent(/capacity unknown/i)
  })

  it('carries no sr-only <dt> terms — the visible text beside each mark already says everything (kindred#2348)', () => {
    // Regression: five `<dt className="sr-only">` terms duplicated what
    // their sibling `<dd>` already showed on screen. Invisible-but-rendered
    // text that only a screen reader this app does not support would read —
    // deleted along with the `<dl>` that existed only to pair them, since an
    // orphaned `<dd>` with no `<dt>` is an invalid list either way
    // (`frontend/CLAUDE.md` §Accessibility).
    const { container } = render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const legend = screen.getByTestId('map-legend')
    expect(legend.tagName).not.toBe('DL')
    expect(container.querySelectorAll('dt')).toHaveLength(0)
    expect(container.querySelectorAll('dd')).toHaveLength(0)
  })

  it('no longer keys a ringed mark as "shared" — that mark is gone (kindred#2179)', () => {
    // A legend row for a channel the surface no longer draws is worse than no
    // row: it sends staff looking for a ring that cannot appear.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByTestId('map-legend')).not.toHaveTextContent(/shared/i)
  })

  it('no longer explains staff-default or near-bathhouse here — the Guide does', () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const legend = screen.getByTestId('map-legend')
    expect(legend).not.toHaveTextContent(/staff-default/i)
    expect(legend).not.toHaveTextContent(/near bathhouse/i)
  })

  it('says what mark size encodes; area colour moved to the shared Visual Guide', () => {
    // Shape and the blue dot were keyed; hue and size were not. Hue drives the
    // fill and the border — it drove the struck shared ring too, until
    // kindred#2179 — and a cluster's mark grows with what is under it. Hue's OWN key moved out (kindred#1997) since it is no
    // longer a map-only channel — the board's cards wear it too.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    const legend = screen.getByTestId('map-legend')
    expect(legend).not.toHaveTextContent(/area colour/i)
    expect(legend).toHaveTextContent(/bigger mark, more rooms/i)
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

describe('LodgingMap controls', () => {
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

  it("demotes Empty rooms into the legend strip — the map's last keyboard-reachable control", () => {
    // kindred#1997: the control bar is gone entirely. `Empty rooms` survives
    // as a real, labelled checkbox, next to the legend strip. kindred#2157:
    // it lives in a sibling `role="group"`, not inside the legend `<dl>` —
    // a description list has no defined semantics for a live form control
    // as a child, so the checkbox must NOT be a descendant of `map-legend`.
    render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />)
    const controls = screen.getByRole('group', { name: 'Map controls' })
    expect(within(controls).getByLabelText('Empty rooms')).toBeInTheDocument()
    const legend = screen.getByTestId('map-legend')
    expect(within(legend).queryByLabelText('Empty rooms')).not.toBeInTheDocument()
  })

  it('removes the control bar entirely — no zoom buttons, fade slider, highlights or area tint', () => {
    // kindred#1997. Reset moves to double-click (tested below); the fade
    // slider, the highlight radios and the area-tint checkbox are deleted
    // outright, with nothing replacing them.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.queryByRole('button', { name: /fit all/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /zoom in/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /zoom out/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/fade map/i)).not.toBeInTheDocument()
    expect(screen.queryByTestId('map-fade-value')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Area tint')).not.toBeInTheDocument()
    expect(screen.queryByText(/\d+(\.\d+)?×/)).not.toBeInTheDocument()
  })

  it('never draws an area tint box — the control and the boxes both went', async () => {
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.queryAllByTestId('map-area-tint')).toHaveLength(0)
  })

  it('keeps a fixed scrim over the map for mark readability, with no control for it', () => {
    // "Fade map"'s STATE goes; the scrim itself stays pinned at DEFAULT_FADE
    // so marks stay readable against the illustration without the user being
    // asked (kindred#1997).
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByTestId('map-scrim')).toHaveStyle({ opacity: '0.25' })
  })

  it('says how to zoom, pan, reset and open a pin', () => {
    // Wheel-zoom and drag-pan have no affordance of their own. Reset moved to
    // double-click and used to go entirely unmentioned in this hint.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.getByText(/scroll to zoom/i)).toBeInTheDocument()
    expect(screen.getByText(/double-click to reset/i)).toBeInTheDocument()
  })
})

describe('LodgingMap — clears a stale selection (kindred#2062)', () => {
  // A weekend switch re-renders the map with a different `parties` prop
  // without unmounting it, so the previously-open family's panel — including
  // its medical narrative — stayed open over the new weekend's roster.
  it('closes the panel when the selected party is no longer in parties', async () => {
    const { rerender } = render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />, {
      wrapper,
    })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    const other = party({
      display_name: 'Chen',
      sort_name: 'Chen',
      household_cm_id: 9002,
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
    })
    rerender(<LodgingMap parties={[other]} units={UNITS} year={2026} />)
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()
  })

  // The trap: a refetch that returns the SAME parties (new array identity,
  // same content) must not close a panel out from under whoever has it open.
  it('keeps the panel open when parties refetches with the same content', async () => {
    const makeParties = () => [
      party({ display_name: 'Johnson', unit_code: 'cedar-1', unit_name: 'Cedar 1' }),
    ]
    const { rerender } = render(<LodgingMap parties={makeParties()} units={UNITS} year={2026} />, {
      wrapper,
    })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    rerender(<LodgingMap parties={makeParties()} units={UNITS} year={2026} />)
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
  })
})

describe('LodgingMap — closes the panel all the way to the ORIGINAL parties (kindred#2137 bug 1)', () => {
  // Every #2062-era test above stops at ONE rerender — B replaces A and the
  // panel closes, full stop. That passes against the broken implementation
  // just as well as the fixed one. The actual #2137 bug only shows up on a
  // THIRD rerender that returns to the roster the panel was originally
  // opened against: without clearing the stored selection, `partyKey`
  // matches again and the panel silently reopens with no click, re-issuing
  // a real medical fetch for a household nobody asked to see.
  it('does not resurrect the panel when the party reappears (A -> B -> A)', async () => {
    const { rerender } = render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />, {
      wrapper,
    })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    const other = party({
      display_name: 'Chen',
      sort_name: 'Chen',
      household_cm_id: 9002,
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
    })
    // B: Johnson drops out of the roster (a weekend switch).
    rerender(<LodgingMap parties={[other]} units={UNITS} year={2026} />)
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()

    // A: back to a roster that once again contains Johnson (switching back
    // to the first weekend, already cached this session). This is the bug.
    rerender(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />)
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()
  })
})

describe('LodgingMap — reflects the live party, not the one captured at click time (kindred#2137 bug 3)', () => {
  it('shows the post-drag cabin after the selected party is placed elsewhere', async () => {
    const { rerender } = render(<LodgingMap parties={[PLACED]} units={UNITS} year={2026} />, {
      wrapper,
    })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    // Scoped to the panel: the mark's own popover is still pinned open behind
    // it and repeats "Cedar 1" as its own heading.
    const panel = screen.getByTestId('family-details-panel')
    expect(within(panel).getByText('Cedar 1')).toBeInTheDocument()

    // An optimistic drag placement (`dragPlacement.ts`'s `applyPlacement`)
    // returns a NEW party object with a changed `unit_code`/`unit_name`, kept
    // at the same `partyKey`. The panel must show the post-drag cabin, not
    // the object captured when the row was clicked.
    const draggedJohnson = { ...PLACED, unit_code: 'cedar-2', unit_name: 'Cedar 2' }
    rerender(<LodgingMap parties={[draggedJohnson]} units={UNITS} year={2026} />)

    expect(within(panel).getByText('Cedar 2')).toBeInTheDocument()
    expect(within(panel).queryByText('No cabin yet')).not.toBeInTheDocument()
  })
})

describe('LodgingMap — isPanelOpen and useDismissOnDeadSpace track panelParty, not raw selection (kindred#2137)', () => {
  // Nothing in this file asserted on either prop before — reverting them to
  // `selected !== null` would still pass the whole suite. The floating badge
  // shifts left (`translateX(-28.5rem)`) only while `isPanelOpen` is true,
  // which is what makes it an observable proxy for the prop.
  function badgeTransform(container: HTMLElement): string | undefined {
    const badge = container.querySelector('[data-floating-badge]')
    return badge instanceof HTMLElement ? badge.style.transform : undefined
  }

  it('shifts the unplaced badge while the panel is open and un-shifts once the party departs', async () => {
    const { container, rerender } = render(
      <LodgingMap parties={[PLACED]} units={UNITS} year={2026} />,
      { wrapper }
    )
    expect(badgeTransform(container)).toBe('none')

    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(badgeTransform(container)).toBe('translateX(-28.5rem)')

    // Johnson drops out of the roster -- `panelParty` resolves null, and
    // `isPanelOpen` must follow it back to false rather than staying pinned
    // on a `selected` that never got cleared.
    rerender(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(badgeTransform(container)).toBe('none')
  })
})

describe('LodgingMap — clears a stale pin/dwell when its cluster dissolves (kindred#2137 bug 4)', () => {
  // `openCluster` itself already derives correctly (a fresh `.find` against
  // the current `clusters` every render) -- what was missing is resetting
  // `pinnedKey`/`dwellKey` when their cluster stops existing. A `units` prop
  // change that drops the pinned mark's unit dissolves the cluster; a LATER
  // prop change that re-adds the identical unit re-mints the same
  // `clusterKey` (sorted unit ids) and, without a fix, reopens the popover
  // with no click.
  it('does not reopen a pinned popover when its unit reappears', async () => {
    const { rerender } = render(<LodgingMap parties={[]} units={UNITS} year={2026} />, {
      wrapper,
    })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()

    const withoutCedar1 = UNITS.filter((u) => u.unit_id !== 'u1')
    rerender(<LodgingMap parties={[]} units={withoutCedar1} year={2026} />)
    expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()

    rerender(<LodgingMap parties={[]} units={UNITS} year={2026} />)
    expect(screen.queryByText('Cedar 1')).not.toBeInTheDocument()
  })
})

describe('LodgingMap — clears the selection on a SESSION change (kindred#2138)', () => {
  // #2062's guard only clears `selected` when the household stops matching
  // `partyKey` — and `partyKey` carries no session dimension (partyKey.ts).
  // A household enrolled in BOTH weekends still matches after the switch,
  // so the #2062 tests above (which use a party that disappears) pass
  // without ever exercising this path. This one keeps the same household in
  // `parties` across the rerender and changes only `sessionCmId`.
  it('closes the panel on a session change even though the same household is still in parties', async () => {
    const johnsonInBothWeekends = () => [PLACED]
    const { rerender } = render(
      <LodgingMap parties={johnsonInBothWeekends()} units={UNITS} year={2026} sessionCmId={101} />,
      { wrapper }
    )
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    // Same household, same partyKey — a different weekend's roster.
    rerender(
      <LodgingMap parties={johnsonInBothWeekends()} units={UNITS} year={2026} sessionCmId={202} />
    )
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()
  })

  // The companion trap to #2062's own: a rerender that keeps the SAME
  // session must not close a panel out from under whoever has it open, even
  // when `parties` is a fresh array identity from a refetch.
  it('keeps the panel open when the session is unchanged, even across a parties refetch', async () => {
    const makeParties = () => [
      party({ display_name: 'Johnson', unit_code: 'cedar-1', unit_name: 'Cedar 1' }),
    ]
    const { rerender } = render(
      <LodgingMap parties={makeParties()} units={UNITS} year={2026} sessionCmId={101} />,
      { wrapper }
    )
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    rerender(<LodgingMap parties={makeParties()} units={UNITS} year={2026} sessionCmId={101} />)
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
  })
})

describe('LodgingMap — the actual medical fetch (kindred#2139)', () => {
  // Every other test in this file mocks `useHouseholdMedical` to a constant,
  // so `HousingNeedDetails`'s fetch -- the exact harm #2062 named -- is never
  // exercised by any assertion in the whole suite. This block flips
  // `medicalFetchMode.real` to drive the GENUINE `useHouseholdMedical` hook,
  // through the same mocked-service-plus-`useApiWithAuth` harness
  // `useWeekendRoster.test.tsx` already uses to drive its own hooks for
  // real.
  beforeEach(() => {
    medicalFetchMode.real = true
    mockFetchHouseholdMedical.mockReset().mockResolvedValue({
      household_cm_id: 9001,
      year: 2026,
      bathroom_explain: 'Grandmother cannot manage the walk at night.',
    })
  })

  afterEach(() => {
    medicalFetchMode.real = false
  })

  it('fetches the real medical narrative when the panel opens', async () => {
    const placedWithBathroomNeed = party({
      display_name: 'Johnson',
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
      flags: { needs_private_bathroom: true },
    })
    render(<LodgingMap parties={[placedWithBathroomNeed]} units={UNITS} year={2026} />, {
      wrapper,
    })
    expect(mockFetchHouseholdMedical).not.toHaveBeenCalled()

    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))

    await waitFor(() => {
      expect(mockFetchHouseholdMedical).toHaveBeenCalledWith(expect.anything(), 2026, 9001)
    })
    expect(
      await screen.findByText('Grandmother cannot manage the walk at night.')
    ).toBeInTheDocument()
  })

  it('never fetches for a party with no household to look up', async () => {
    const adultGuest = party({
      grain: 'person',
      household_cm_id: 0,
      person_cm_id: 5001,
      display_name: 'Priya Patel',
      sort_name: 'Priya Patel',
      adults: [],
      children: [],
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
    })
    render(<LodgingMap parties={[adultGuest]} units={UNITS} year={2026} />, { wrapper })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    await userEvent.click(screen.getByRole('button', { name: /Priya Patel/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
    expect(mockFetchHouseholdMedical).not.toHaveBeenCalled()
  })
})

/**
 * kindred#2183 — the owner ruled the map a REFERENCE surface: "staff have
 * informed me they will only be looking at the map as a data point and not
 * bunking on it." Placement was specified for it and never built, but the
 * scaffolding survived — a `dropTarget` threaded into the ring resolver only
 * to be hard-set `false`, under a comment saying it could only ever be false.
 *
 * A source read, deliberately: the ring these lines produced was already
 * correct, so removing them changes no rendered output and no behavioural
 * test can catch them coming back. What must not come back is the SCAFFOLDING
 * — the next person to add a placement affordance here should have to argue
 * with this test and the ruling behind it, not find the wiring half-done and
 * assume it was meant to be finished.
 */
describe('LodgingMap — no placement scaffolding (kindred#2183)', () => {
  const source = readFileSync(resolve(__dirname, 'LodgingMap.tsx'), 'utf-8')

  // ANCHORED ON THE SYNTAX OF PASSING THEM — an object key (`dropTarget:`) and
  // a JSX prop (`canPlace=`) — not on the bare identifiers. The file's own
  // header has to be able to NAME what was removed and why, and a guard that
  // fired on the prose would force the explanation out of the file it explains.
  it('imports no drag-and-drop machinery', () => {
    expect(source).not.toMatch(/@dnd-kit/)
  })

  it('does not thread a drop target through the ring resolver', () => {
    expect(source).not.toMatch(/dropTarget\s*:/)
  })

  it('does not thread a placement permission into the unplaced queue', () => {
    expect(source).not.toMatch(/canPlace\s*=/)
  })

  it('still keeps the empty-rooms checkbox, the surface’s last keyboard control', () => {
    // Paired with the removals above on purpose. "Strip what placement left
    // behind" is one edit away from "strip the controls", and this one is not
    // a placement affordance — it is the only thing on the map a keyboard can
    // reach at all.
    render(<LodgingMap parties={[]} units={UNITS} year={2026} />, { wrapper })
    expect(screen.getByRole('checkbox', { name: /Empty rooms/i })).toBeInTheDocument()
  })
})

describe('LodgingMap — extends the whole-building marker to the popover (kindred#2174)', () => {
  // A halved house, same shape as `LodgingUnitCard.test.tsx`'s own fixture:
  // `up-r1`/`up-r2` share the `upstairs` parent, so together they ARE a
  // building under the immediate-parent grain ruled on #2008. Positioned far
  // apart so each keeps its OWN mark rather than proximity-clustering into
  // one — this is testing that `LodgingMap` computes `wholeBuildingHolders`
  // over the FULL registry and threads it down, not the cluster-summary
  // rendering itself (that is `MapUnitPopover.test.tsx`'s job).
  const halvedHouseUnits = [
    unit({ unit_id: 'up', code: 'upstairs', name: 'Upstairs', is_container: true }),
    unit({
      unit_id: 'r1',
      code: 'up-r1',
      name: 'Up Back',
      parent_code: 'upstairs',
      map_x: 0.1,
      map_y: 0.1,
    }),
    unit({
      unit_id: 'r2',
      code: 'up-r2',
      name: 'Up Front',
      parent_code: 'upstairs',
      map_x: 0.9,
      map_y: 0.9,
    }),
  ]
  const holder = party({
    display_name: 'Johnson',
    unit_code: 'up-r1',
    unit_name: 'Up Back',
    unit_codes: ['up-r1', 'up-r2'],
  })

  it('badges the room of a party whose placement covers the whole building', async () => {
    // Which mark is `up-r1` vs `up-r2` is not asserted — `holder` occupies
    // BOTH, so whichever the click opens shows the same party and the same
    // badge. What this pins is that `LodgingMap` computed
    // `wholeBuildingHolders` over the FULL registry and threaded it down;
    // `MapUnitPopover.test.tsx` already pins the badge's own render rules.
    render(<LodgingMap parties={[holder]} units={halvedHouseUnits} year={2026} />, { wrapper })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.getByText('Whole building')).toBeInTheDocument()
  })

  it('does not badge a party holding only one room of the pair', async () => {
    const oneRoom = party({
      display_name: 'Garcia',
      household_cm_id: 9002,
      unit_code: 'up-r1',
      unit_name: 'Up Back',
      unit_codes: ['up-r1'],
    })
    render(<LodgingMap parties={[oneRoom]} units={halvedHouseUnits} year={2026} />, { wrapper })
    await userEvent.click(screen.getAllByTestId('map-mark')[0] as HTMLElement)
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
    await userEvent.click(screen.getAllByTestId('map-mark')[1] as HTMLElement)
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
  })
})
