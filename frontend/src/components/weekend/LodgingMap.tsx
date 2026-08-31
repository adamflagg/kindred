/**
 * The weekend lodging MAP — a REFERENCE surface, and a projection of the board.
 *
 * Same roster payload, same `buildBoard`, plus position. It answers the two
 * questions a grid cannot: is this family near that one, and does this family
 * sit beside a bathhouse or a staff cabin. Since kindred#2183 it answers a
 * third, which is now its main job: WHO IS HOUSED WHERE — the peek lists every
 * person in a room or a building, grouped into family chips, and clicking one
 * opens the same family panel the board opens.
 *
 * READ-ONLY BY RULING, NOT BY NOT-YET (kindred#2183). Placement was specified
 * for this surface and never built, and the owner has since closed the door:
 * "staff have informed me they will only be looking at the map as a data point
 * and not bunking on it." What survived was scaffolding — a `dropTarget`
 * threaded into `resolveRingPrecedence` only to be hard-set false, and a
 * shared unplaced queue mounted without `canPlace` — and it is gone. Treat a
 * placement affordance appearing here as a decision to reopen with the owner,
 * not as finishing something half-wired. `LodgingMap.test.tsx` guards this
 * with a source read, because none of it changed a rendered pixel.
 *
 * SCENARIO AWARENESS MIRRORS THE BOARD AND NOTHING MORE — currently none. The
 * header's `ModeBadge` says which plan is on screen, for this tab and every
 * other; a chip here as well was a second claim to keep true, and it stopped
 * being true the moment #1967 let staff select a draft. Nothing on this
 * surface earns a scenario id back while it stays a reference view: a map that
 * knew about scenarios while the board did not would be a second system of
 * record, which is the one thing this must not be.
 *
 * ACCESSIBILITY, stated rather than implied: a pan/zoom map is not
 * keyboard-navigable. The accessible equivalent is Manage → Family Camp
 * Lodging, which lists every unit for this season in a table. It can only
 * discharge that promise since the registry became year-scoped: before, it
 * described no particular season. Nothing may be reachable ONLY here.
 *
 * The marks are therefore plain clickable divs and deliberately do NOT carry
 * `role="button"`. A role they cannot honour — 82 unreachable tab stops, or a
 * control with `tabIndex={-1}` that no keyboard can focus — is a worse lie than
 * an honest non-control. The popover is a SIBLING of the marks for a related
 * reason; see the comment at its render site.
 *
 * THE MARK CARRIES SPEC §6.3's ENCODING IN FULL, and the list is closed on
 * purpose — position, fill, area hue, dashed square for staff-default, a blue
 * dot for `near_bathhouse`, `?` for unmeasured capacity, and an amber ring
 * for a share nobody consented to. The list got SHORTER on 2026-08-09
 * (kindred#2179): there was also a ring in the area hue for any shared room,
 * struck for firing on the units built to hold several families. Everything
 * else the payload carries — reservation state,
 * inactive, unconfirmed, amenities, beds, and a cabin that does not answer
 * what a family asked for — lives in the peek. A 16px pin has room for about
 * seven channels before it stops being readable, which is the failure §6.2
 * spends its whole length avoiding.
 */
import { Info } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import { useDismissOnDeadSpace } from '../../hooks/useDismissOnDeadSpace'
import { usePanelParty } from '../../hooks/usePanelParty'
import { updateLodgingUnitPositions } from '../../services/lodgingCrud'
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { queryClient } from '../../utils/queryClient'
import { invalidateLodgingRegistryQueries } from '../../utils/queryKeys'
import { wholeBuildingHolders } from './boardLayout'
import { FamilyCard } from './FamilyCard'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { FloatingUnplacedBadge } from './FloatingUnplacedBadge'
import { indexUnitsByCode, resolvePartyUnit } from './rosterAttention'
import { MapBaseLayer } from './MapBaseLayer'
import { clusterByProximity, type Cluster } from './mapClustering'
import { BATHHOUSE_BLUE } from './mapColors'
import { buildMapModel, pinSite, type MapUnit } from './mapModel'
import { CONSENT_AMBER, CONSENT_PHRASE, MapUnitPopover } from './MapUnitPopover'
import { partyKey } from './partyKey'
import {
  basePosition,
  clampView,
  IDENTITY_VIEW,
  MAP_ASPECT,
  screenPosition,
  screenToNormalized,
  type Viewport,
  zoomAt,
} from './mapViewport'
import { resolveRingPrecedence } from './ringPrecedence'

/**
 * Four decimals for a stored pin — one part in 10,000 against a 3300px
 * render, so roughly a third of a pixel. Same precision `UnitMapPositionField`
 * uses for the admin editor's own pin, kept here as an independent constant
 * rather than a shared import: that field is not part of this PR's scope
 * (kindred#2396), and re-deriving four lines of rounding here is cheaper and
 * safer than reaching into a working, heavily-documented file to extract one.
 */
const PIN_PRECISION = 4

function roundPin(value: number): number {
  return Number(value.toFixed(PIN_PRECISION))
}

/**
 * (0,0) IS THE SENTINEL for "never placed" (`hasCoordinates`, `mapModel.ts`)
 * — the one pair a drag may never write, or the building would UNPLACE
 * itself through the very gesture meant to reposition it. Mirrors
 * `UnitMapPositionField`'s `offOrigin` for the same reason stated there: only
 * the exact corner is special-cased, and a ten-thousandth of the map is a
 * third of a pixel at full render, so nudging off it is invisible.
 */
function offOriginPin(point: { x: number; y: number }): { x: number; y: number } {
  if (point.x === 0 && point.y === 0) {
    return { x: 10 ** -PIN_PRECISION, y: 10 ** -PIN_PRECISION }
  }
  return point
}

/** One accumulated, not-yet-saved pin move — keyed by `buildingCode` so a
 *  second drag of the same building during one edit session overwrites the
 *  first rather than queuing a second write to the same row. */
interface PinDraft {
  targetUnitId: string
  x: number
  y: number
}

/** Below this a pointer gesture is a click, above it a pan. Capturing the
 *  pointer any earlier retargets the click away from the mark under it. */
const DRAG_THRESHOLD_PX = 4

/**
 * Dwell before the peek opens, per spec §7 and tuned in the mockup.
 *
 * Long enough that crossing a pin on the way somewhere else does not fire it,
 * short enough to feel like hover. The dwell peek is TRANSIENT — it closes
 * when the pointer leaves, and clicking is what pins it open. That is why
 * moving onto the popover to click an occupant needs a click first: a peek
 * that followed the cursor would need a hit-corridor between mark and popover,
 * which is a lot of machinery for something a click already solves.
 */
const DWELL_MS = 400

/** Half of the popover's `max-w-[15rem]` (240px), padded a bit. Clamping the
 *  anchor at least this far from each edge keeps the box on-screen. Height
 *  is content-dependent, so this is deliberately generous rather than exact —
 *  better a small unnecessary gap than a clipped popover.
 *
 *  RAISED for kindred#2183: a container's peek is now a summary card STACKED
 *  ON the footprint grid rather than the grid alone, so the tallest thing this
 *  has to keep on canvas grew by roughly the height of a detail card. The
 *  policy in the line above is what makes raising it the right response to
 *  that — jsdom performs no layout, so no test here can measure the real box.
 */
const POPOVER_HALF_WIDTH = 130
const POPOVER_HALF_HEIGHT = 150

export interface LodgingMapProps {
  parties: RosterPartyRow[]
  units: LodgingUnitRow[]
  year: number
  /**
   * The weekend this map belongs to, so a household enrolled in TWO
   * weekends (kindred#2138) can be told apart from one that merely
   * refetched. Optional and defaulting to 0 for the same reason
   * `LodgingBoard`'s prop of the same name does: most tests render one
   * weekend's map and never exercise a session change.
   */
  sessionCmId?: number
}

export function LodgingMap({ parties, units, year, sessionCmId = 0 }: LodgingMapProps) {
  // MEMOISED, and not as a micro-optimisation: panning updates `view` on every
  // pointermove, and an unmemoised call would re-run buildBoard — area bucketing,
  // sorting, hue assignment, the lot — on every frame of a drag.
  const model = useMemo(() => buildMapModel(parties, units), [parties, units])
  // kindred#2174: the board's own placement fact (kindred#2008), extended to
  // the map. Computed here rather than inside `buildMapModel` or the popover
  // itself — `MapUnitPopover` only ever sees a cluster's own members
  // (`MapUnit[]`), not the full registry `wholeBuildingHolders` needs, and
  // `LodgingMap` already holds both `parties` and `units` as props. Read
  // against each party's OWN occupied leaves, so a combined card split
  // between two disjoint-room households marks neither of them.
  const wholeBuildingKeys = useMemo(() => wholeBuildingHolders(parties, units), [parties, units])

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    x: number
    y: number
    tx: number
    ty: number
    id: number
    active: boolean
  } | null>(null)
  // Set from `drag.active` at pointerup, so the click that ends a pan can be
  // told apart from a genuine dead-space click on the same canvas div.
  //
  // WRITTEN in the canvas's `onPointerUp`; READ in the canvas's `onClick`, and
  // nowhere else. That pairing is what makes it unable to go stale: a `click`
  // on the canvas is always preceded by that same gesture's `pointerup` on the
  // canvas, so the value the click reads is always the one its own gesture
  // just wrote. A `true` left behind by a pan that no click followed has no
  // reader at all — the next canvas gesture overwrites it before the next
  // canvas click can see it.
  const wasDraggingRef = useRef(false)
  const [view, setView] = useState<Viewport>(IDENTITY_VIEW)
  const [size, setSize] = useState({ width: 0, height: 0 })
  // Empty rooms are DRAWN by default: the map's job when you arrive is the
  // whole site, and the toggle is a question you bring to it rather than one
  // the surface should ask for you.
  const [showEmpty, setShowEmpty] = useState(true)
  // TWO keys, not one. A click PINS the peek and a dwell only borrows it, so
  // the pointer leaving a mark must close a dwell-opened peek without
  // touching one the user deliberately pinned. Collapsing them into a single
  // `openKey` made a pinned peek evaporate the moment the cursor moved to
  // read it.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [dwellKey, setDwellKey] = useState<string | null>(null)
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { panelParty, requestClose, openParty, closePanel, requestPanelClose } =
    usePanelParty(parties)
  const unitsByCode = useMemo(() => indexUnitsByCode(units), [units])

  const openKey = pinnedKey ?? dwellKey

  const cancelDwell = useCallback(() => {
    if (dwellTimer.current !== null) {
      clearTimeout(dwellTimer.current)
      dwellTimer.current = null
    }
  }, [])

  /** Everything that moves the map underneath a peek dismisses it. */
  const closePeek = useCallback(() => {
    cancelDwell()
    setPinnedKey(null)
    setDwellKey(null)
  }, [cancelDwell])

  // A dwell timer outliving the component would call setState on an unmounted
  // tree the moment the user switches tabs mid-hover.
  useEffect(() => cancelDwell, [cancelDwell])

  // ── Pin dragging (kindred#2396) ──────────────────────────────────────────
  //
  // The gate. Off by default, same as `UnitMapPositionField`'s `editing` —
  // and for the same reason: with it off the canvas keeps ONLY its pan/zoom
  // handlers (spread conditionally below, not behind an early return inside
  // them), so a stray pointer gesture is structurally incapable of moving a
  // pin. Marks gain drag handlers, and lose their click-to-peek and
  // hover-dwell handlers, only while this is true.
  const [editingPins, setEditingPins] = useState(false)
  // Every move made during ONE edit session, keyed by `buildingCode` so a
  // second drag of the same building overwrites the first rather than
  // queuing a second write to the same row. NOT saved on pointer-up — see
  // the flush effect below for why exiting edit mode is the commit point
  // instead, which is the one place this surface deliberately departs from
  // `UnitMapPositionField`'s save-on-interaction shape.
  const [pinDrafts, setPinDrafts] = useState<Map<string, PinDraft>>(new Map())
  // THE POINTER THAT OWNS THE CURRENT DRAG, not a bare boolean — same
  // reasoning as `UnitMapPositionField`'s `draggingRef`: a second finger
  // landing mid-drag, or a stray pointerup from a pointer that never pressed
  // here, must not be able to move or end someone else's gesture.
  const pinDragRef = useRef<{ pointerId: number; buildingCode: string } | null>(null)

  // Mirrored into a ref so the flush effect's cleanup — which runs on the
  // NEXT render after a state change, or on unmount — reads the drafts as of
  // the moment editing actually stopped, not whatever was captured when the
  // effect was set up. Same technique `LodgingMap` already uses for `size`
  // below, and for the same reason: writing a ref during render is what
  // `react-hooks/refs` exists to catch.
  const pinDraftsRef = useRef(pinDrafts)
  useEffect(() => {
    pinDraftsRef.current = pinDrafts
  }, [pinDrafts])

  // THE FLUSH. Registered only while `editingPins` is true, so its cleanup —
  // which React runs the moment `editingPins` next changes, AND on unmount —
  // fires exactly once per edit session, on the transition OUT of it. This is
  // what the ruling's "an exit must flush" covers for a navigation away, a
  // tab change or an unmount while Edit pins is on: `WeekendRosterPage`
  // mounts this component inside a React 19 `<Activity>` that tears effects
  // down on going hidden, so leaving the Map tab runs this cleanup exactly
  // like flipping the checkbox off does.
  useEffect(() => {
    if (!editingPins) return
    return () => {
      const drafts = pinDraftsRef.current
      if (drafts.size === 0) return
      // ROUNDED AND OFF-ORIGIN ONLY HERE, at the write — never during the
      // live drag. The draft driving the mark's on-screen position stays at
      // full pointer precision so the pin tracks the cursor exactly; only
      // what actually reaches PocketBase is rounded to `PIN_PRECISION` and
      // nudged off the exact (0,0) sentinel, mirroring `UnitMapPositionField`.
      const updates = Array.from(drafts.values()).map((draft) => {
        const point = offOriginPin({ x: roundPin(draft.x), y: roundPin(draft.y) })
        return { id: draft.targetUnitId, map_x: point.x, map_y: point.y }
      })
      void updateLodgingUnitPositions(updates).then((landed) => {
        if (landed < updates.length) {
          toast.error(
            updates.length === 1
              ? 'Failed to save the map pin.'
              : `Saved ${String(landed)} of ${String(updates.length)} map pins.`
          )
        }
        // Invalidated REGARDLESS of a partial failure: a refetch is what
        // shows a failed pin back where the server actually left it, exactly
        // the "the stored position goes back" idiom `UnitMapPositionField`
        // documents for its own failed write.
        invalidateLodgingRegistryQueries(queryClient)
        setPinDrafts(new Map())
      })
    }
  }, [editingPins])

  // Measure the canvas so projection happens in real pixels. ResizeObserver
  // rather than a window listener: the tab can be revealed at any size.
  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const measure = () => {
      const width = node.clientWidth
      const height = node.clientHeight
      setSize({ width, height })
      // Re-clamp: tx/ty are absolute pixels against the OLD size, so a resize
      // or a sidebar collapse can open the gutter that clampView exists to
      // prevent. It would otherwise persist until the next pan.
      if (width > 0 && height > 0) setView((current) => clampView(current, width, height))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])

  // `openParty`/`closePanel`/`panelParty` come from `usePanelParty` above —
  // shared with `LodgingBoard` and `HouseholdRosterTable` (kindred#2139). See
  // its own docstring for the derivation and why it stores `selectedKey`
  // rather than the party object.

  // RESET, not filtered (kindred#2138) — the owner's ruling was explicit: a
  // session change closes the panel outright, it does not merely stop
  // rendering it while the selection quietly survives underneath.
  // `usePanelParty`'s own guard only catches a household that drops OUT of
  // `parties`; a household enrolled in two weekends never does that, since
  // `partyKey` (deliberately — see partyKey.ts) carries no session
  // dimension, so the same key still matches after the switch and the panel
  // would keep rendering the PREVIOUS weekend's placement data.
  //
  // This is React's own "storing information from previous renders"
  // pattern: compare this render's prop against the last one seen, and if
  // it moved, correct the state right here in the render body rather than
  // in an Effect. Calling `closePanel` conditionally during render does not
  // add a paint the way an Effect would — React discards this render's
  // output and re-renders synchronously with the corrected state before
  // anything commits, so nobody ever sees the stale mid-render frame.
  const [lastSessionCmId, setLastSessionCmId] = useState(sessionCmId)
  if (sessionCmId !== lastSessionCmId) {
    setLastSessionCmId(sessionCmId)
    closePanel()
  }

  // Same dead-space dismissal the summer board and the weekend board use, and
  // deliberately the same one line they use. The canvas is a bare div that a
  // pan gesture ends with a click on, and that click matches none of
  // `shouldKeepPanelsOpen`'s exemptions (not a panel, badge, button or card),
  // so a pan would otherwise close the panel out from under whoever is
  // dragging it. That is fixed where it happens — the canvas's own `onClick`
  // stops the pan-concluding click from ever reaching this document listener —
  // rather than by teaching this callback to second-guess the clicks it does
  // get. A callback that remembers things about earlier gestures is a callback
  // that can be wrong about the current one.
  useDismissOnDeadSpace(panelParty !== null, requestPanelClose)

  // jsdom performs no layout, so clientWidth/clientHeight are 0 there (verified).
  // Without this fallback every mark computes position (0,0), the clusterer
  // merges them into a single blob, and the per-room mark tests fail. It is
  // load-bearing in tests, and harmless in a browser where the observer fires.
  const width = size.width > 0 ? size.width : 1000
  const height = size.height > 0 ? size.height : 1000 / MAP_ASPECT

  // Mirrored into a ref so the native wheel listener below can read the
  // CURRENT size without needing `[width, height]` as an effect dependency —
  // which would tear the listener down and reattach it on every resize. The
  // write happens in its own effect, not inline during render: mutating a
  // ref while rendering is exactly what `react-hooks/refs` exists to catch.
  const sizeRef = useRef({ width, height })
  useEffect(() => {
    sizeRef.current = { width, height }
  }, [width, height])

  // React 19 registers wheel listeners as PASSIVE at the root, so
  // `event.preventDefault()` inside a JSX `onWheel` handler is silently
  // ignored — wheeling the map zooms it AND scrolls the page beneath it. A
  // native `{ passive: false }` listener is the only way to actually block
  // the scroll. Escape-to-dismiss rides along here too: both are ad hoc
  // canvas-level interactions with nothing else to share an effect with.
  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault()
      // EDIT MODE FREEZES THE CANVAS (kindred#2396 ruling): while Edit pins
      // is on, a drag moves pins only — no pan, no zoom. `preventDefault`
      // still runs unconditionally above so the page cannot scroll under a
      // frozen map; only the zoom itself is skipped.
      if (editingPins) return
      closePeek()
      const rect = node.getBoundingClientRect()
      const { width: currentWidth, height: currentHeight } = sizeRef.current
      setView((current) =>
        zoomAt(
          current,
          event.clientX - rect.left,
          event.clientY - rect.top,
          Math.exp(-event.deltaY * 0.0016),
          currentWidth,
          currentHeight
        )
      )
    }
    // CORRECT AS-IS, and deliberately so (kindred#2237): taking a token here
    // would REGRESS the panel beside it. `FamilyDetailsPanel` stands down for
    // any overlay in the stack via `hasOpenModal()`, which is a "is anything
    // else open" test, not a LIFO one. A peek can be open BEHIND that panel --
    // `MapUnitPopover` passes `onOpenParty` straight through and nothing on
    // that path calls `closePeek()` -- so a peek token would make the panel
    // yield Escape to a transient hover popover underneath it, and the family
    // the staff member was reading would stop closing on the key entirely.
    // Fixing this pair properly means converting `FamilyDetailsPanel` too,
    // which kindred#2237 pre-classifies as correct as-is and out of scope.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePeek()
    }
    node.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      node.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
    }
    // `closePeek` is a stable useCallback over a stable `cancelDwell`, so
    // that dependency alone would attach this listener exactly once.
    // `editingPins` is added on top of it: `handleWheel` closes over it by
    // value, and without the dependency this listener would keep testing
    // whatever `editingPins` was on the render that first attached it.
  }, [closePeek, editingPins])

  // FILTERED BEFORE CLUSTERING, and that ordering is the point: hiding empty
  // rooms also dissolves the clusters they were padding, so what is left is a
  // map of the occupied site rather than the same blobs with holes in them.
  const drawn = showEmpty
    ? model.units
    : model.units.filter((mapUnit) => mapUnit.parties.length > 0)
  const placed = drawn.map((mapUnit) => {
    // A PENDING DRAG WINS OVER THE MODEL'S OWN POSITION (kindred#2396). The
    // draft is normalized 0-1 map space, same as `mapUnit.x`/`y`, so it goes
    // through the identical `basePosition`/`screenPosition` pipeline below —
    // there is no second rendering path to keep in step with this one.
    // Applied whether or not `editingPins` is still true: a flush in flight
    // after the checkbox is switched off must keep showing where the pin was
    // dropped, not snap it back until the write actually resolves.
    const draft = pinDrafts.get(mapUnit.buildingCode)
    const base = basePosition(draft?.x ?? mapUnit.x, draft?.y ?? mapUnit.y, width, height)
    const screen = screenPosition(base, view)
    // GROUPED BY BUILDING (kindred#2440). Two different buildings a few pixels
    // apart must never draw as one mark — proximity alone merged four such
    // pairs on the production registry. `buildingCode` is resolved once in
    // `mapModel`, off `mapBuildingKey`'s ROOT grain — deliberately NOT the
    // immediate-parent grain kindred#2008 ruled for lettability; this never
    // re-derives it.
    return { item: mapUnit, x: screen.x, y: screen.y, group: mapUnit.buildingCode }
  })
  const clusters = clusterByProximity(placed)

  // Counted off what was actually drawn, never off a second predicate — a
  // legend that disagrees with the map is worse than no legend.
  const clusterCount = clusters.filter((cluster) => cluster.members.length > 1).length
  // Rooms the payload HAS, not rooms currently shown: a count that moved when
  // you hid the empties would stop accounting for the units at all.
  //
  // NOT the full registry's unit count, and deliberately so — `countMapUnits`'
  // docstring says why: the registry counts every unit, this counts the
  // POSITIONED bookable ones. The remainder is not silently dropped; containers
  // are the next figure along, and unpositioned rooms have their own line
  // above the map. Three numbers, because they answer three questions.
  const roomCount = model.units.length
  const containerCount = units.filter((unit) => unit.is_container).length

  // SORTED: cluster membership is order-invariant but the member ARRAY order is
  // not, and an unsorted key would change identity across renders, remounting
  // the popover under the user.
  const clusterKey = (cluster: Cluster<MapUnit>): string =>
    cluster.members
      .map((member) => member.item.unit.unit_id)
      .sort()
      .join('|')

  // MUST come after clusterKey. `.find` runs its callback synchronously, so
  // declaring this above a `const` arrow function puts that reference in the
  // temporal dead zone. It would not throw on first render — `openKey` starts
  // null and the ternary short-circuits — only once a mark has been clicked.
  const openCluster =
    openKey === null ? undefined : clusters.find((cluster) => clusterKey(cluster) === openKey)

  // Same latch as `usePanelParty`'s `selectedKey` above, applied to
  // `pinnedKey`/`dwellKey` (kindred#2137 bug 4). `openCluster` already
  // derives correctly — a fresh `.find` against the CURRENT `clusters` every
  // render — but nothing reset `pinnedKey`/`dwellKey` when their cluster
  // stopped existing. A `parties`/`units` prop change (a roster refetch or a
  // weekend switch) can dissolve a cluster and a LATER prop change can
  // re-mint the identical `clusterKey` (sorted unit ids), reopening a
  // popover with no click. `MapUnitPopover` renders no `HousingNeedDetails`,
  // so this is a correctness/UX defect, not a medical disclosure — but the fix
  // shape is identical: clear the stored key(s) right here, during render,
  // rather than in an Effect.
  if (openKey !== null && openCluster === undefined) {
    if (pinnedKey !== null) setPinnedKey(null)
    if (dwellKey !== null) setDwellKey(null)
  }

  // The only way left to reset the view — the control bar's `Fit all` button
  // is gone. Called from the canvas's own `onDoubleClick` below; a bare
  // pan/zoom map with no reset at all would strand a panned-away user with no
  // way back short of a reload.
  const resetView = () => {
    closePeek()
    setView(IDENTITY_VIEW)
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The mode chip that used to lead this row moved to the header badge,
          where summer keeps it. The row itself is now conditional: left
          unconditional it renders empty and still spends the parent's gap. */}
      {model.unpositionedUnits.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {model.unpositionedUnits.length === 1
              ? '1 room has no position yet'
              : `${String(model.unpositionedUnits.length)} rooms have no position yet`}
          </span>
        </div>
      )}

      <div className="card-lodge overflow-hidden">
        <div className="flex flex-col gap-2 p-3">
          {/* Pointer-driven pan/zoom canvas; per the ACCESSIBILITY note at the top of this file, this
              surface is deliberately not keyboard-navigable (the accessible equivalent is Manage →
              Family Camp Lodging). This click is background-dismiss only, and Escape already closes
              the same popover via the keydown listener registered above. */}
          <div
            ref={canvasRef}
            data-testid="map-canvas"
            style={{ aspectRatio: `${String(MAP_ASPECT)}` }}
            className="bg-muted/40 relative w-full touch-none overflow-hidden rounded-xl select-none"
            onClick={(event) => {
              // FIRST, before any early return: consume the pan flag. Every
              // canvas click clears it, which is the whole reason it cannot go
              // stale — see `wasDraggingRef`'s own note. Putting this below the
              // guards would give the flag a way to survive a click.
              const concludedPan = wasDraggingRef.current
              wasDraggingRef.current = false
              if (concludedPan) {
                // A pan is not a click on anything, and the browser's
                // synthesised trailing click says otherwise. Stopped HERE, in
                // the same dispatch, so it never reaches the document listener
                // `useDismissOnDeadSpace` attaches — the panel is not dismissed
                // because the event never arrives, not because something later
                // remembered a drag. Same technique the marks use below.
                event.stopPropagation()
                // No closePeek(): the pan already closed the peek the moment it
                // crossed the threshold.
                return
              }
              // Background dismiss. Marks already stopPropagation() on their
              // own click, so this never actually sees one — but a popover
              // occupant button does NOT, and clicking it must not close the
              // popover it lives inside.
              const target = event.target as HTMLElement
              if (
                target.closest('[data-testid="map-mark"]') ||
                target.closest('[data-map-popover]')
              ) {
                return
              }
              closePeek()
            }}
            // Spec §7: double-click on BARE canvas fits the whole map, and
            // there is deliberately no double-click-to-zoom on a node — a
            // pin's one job is to say what is in it. The same `closest` guard
            // as the background dismiss is what keeps the two apart, and
            // EDIT MODE FREEZES THE CANVAS (kindred#2396): a reset is a form
            // of pan/zoom, so it is suspended right alongside the drag
            // handlers below rather than left as a back door around the
            // freeze.
            onDoubleClick={(event) => {
              if (editingPins) return
              const target = event.target as HTMLElement
              if (
                target.closest('[data-testid="map-mark"]') ||
                target.closest('[data-map-popover]')
              ) {
                return
              }
              resetView()
            }}
            // PAN/ZOOM POINTER HANDLERS, SPREAD CONDITIONALLY — the same
            // technique `UnitMapPositionField` uses for its OWN gate, and for
            // the same reason stated there: an early return inside each
            // handler only checks a flag, but omitting the handlers entirely
            // means a pan gesture is structurally incapable of reaching this
            // canvas while Edit pins is on. Marks below grow the opposite
            // set of handlers under the same condition.
            {...(editingPins
              ? {}
              : {
                  // Replacing the record on a new press is what makes a DROPPED
                  // gesture self-heal: if an up event is ever lost, the next press
                  // must be able to take over rather than strand the map forever.
                  //
                  // But a press while a gesture is genuinely LIVE is the opposite
                  // case, and treating them alike was a real bug. A stray thumb
                  // landing mid-pan took the record, and its own pointerup then
                  // cleared the record belonging to the finger still panning — which
                  // still held capture and kept firing moves that now fell through
                  // the `!drag` guard below, freezing the map until it lifted.
                  //
                  // CAPTURE is the discriminator, not `active` alone: held means the
                  // gesture is live and the new pointer is a bystander; absent means
                  // the record is stale and replacing it is the self-heal.
                  onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
                    const live = dragRef.current
                    if (live?.active && event.currentTarget.hasPointerCapture(live.id)) return
                    dragRef.current = {
                      x: event.clientX,
                      y: event.clientY,
                      tx: view.tx,
                      ty: view.ty,
                      id: event.pointerId,
                      active: false,
                    }
                  },
                  onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                    const drag = dragRef.current
                    // Only the pointer that STARTED the gesture may drive it. Without
                    // this, a second touch point (the only touch path, since the
                    // canvas sets `touch-none`) moves the map against the other
                    // finger's baseline and the pan jitters.
                    if (!drag || event.pointerId !== drag.id) return
                    const dx = event.clientX - drag.x
                    const dy = event.clientY - drag.y
                    if (!drag.active) {
                      // Do NOT capture before this point: capturing on pointerdown
                      // retargets the following click to the canvas, so a mark's own
                      // handler never fires.
                      if (Math.abs(dx) + Math.abs(dy) <= DRAG_THRESHOLD_PX) return
                      drag.active = true
                      event.currentTarget.setPointerCapture(drag.id)
                      closePeek()
                    }
                    setView(
                      clampView({ k: view.k, tx: drag.tx + dx, ty: drag.ty + dy }, width, height)
                    )
                  },
                  onPointerCancel: () => {
                    // The browser took the gesture away (system gesture, tab switch).
                    // No capture to release — it is released for us — but the record
                    // must go or a stale baseline outlives the gesture.
                    dragRef.current = null
                  },
                  onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
                    const drag = dragRef.current
                    if (!drag || event.pointerId !== drag.id) return
                    if (drag.active && event.currentTarget.hasPointerCapture(drag.id)) {
                      event.currentTarget.releasePointerCapture(drag.id)
                    }
                    // The click that follows this pointerup must not read as dead
                    // space if this gesture actually panned — the canvas's `onClick`
                    // above reads this and stops that click there.
                    wasDraggingRef.current = drag.active
                    dragRef.current = null
                  },
                })}
          >
            {/* The illustration, its scrim and the art-missing notice, shared
                with the admin unit editor's pin canvas (kindred#2013). */}
            <MapBaseLayer view={view} width={width} height={height} />

            {clusters.map((cluster) => {
              const key = clusterKey(cluster)
              const first = cluster.members[0]?.item
              if (!first) return null
              const many = cluster.members.length > 1
              const occupied = cluster.members.filter((m) => m.item.parties.length > 0).length
              // ORDER-INVARIANT, mirroring MapUnitPopover's own semantics. A
              // cluster is only "a staff building" — SHAPE: a dashed square —
              // if EVERY member is one, but ANY staff member still HIGHLIGHTS
              // the mark with a dashed border, so a mixed cluster does not
              // silently read as an ordinary building with nothing
              // staff-related about it. Reading straight off `members[0]` —
              // the old code — meant the shape flipped with whichever row the
              // database happened to return first.
              const allStaff = cluster.members.every(
                (member) => member.item.unit.inventory_class === 'staff_default'
              )
              const anyStaff = cluster.members.some(
                (member) => member.item.unit.inventory_class === 'staff_default'
              )
              // Hue has the same order-dependence risk. Cross-area clusters
              // are 0 on the current registry, but the REASON changed with
              // kindred#2440 and the old one no longer holds: the partition is
              // not proximity any more, it is the registry's own building
              // tree, and 0 of the 8 multi-room buildings span two areas.
              // This must still not assume that stays true. `first.hue` is
              // kept as the fallback deliberately: there is no principled
              // "average" of two areas' colours.
              const hue = first.hue
              // #1926 added `slot.consent` so a non-consenting shared
              // placement could not pass unnoticed, and the board spends an
              // amber ring, a warning icon and a line of text on it. The map
              // reads the SAME flag off the SAME slot, so it gets an amber
              // ring here — a flagged room that looked like every other shared
              // room would make this surface the one place the signal is lost.
              // ANY flagged member rings the cluster; the popover's grid is
              // where it narrows to which room.
              const flagged = cluster.members.filter((m) => m.item.consent !== null).length
              // Spec §1 names TWO questions this surface exists to answer, and
              // "does this family sit beside a bathhouse" is one of them
              // verbatim. It has to be on the MARK: 31 rooms carry it, and
              // reading it out of the peek means opening all 82 one at a time,
              // which is the interaction a map exists to replace.
              const bathhouse = cluster.members.some(
                (member) => member.item.unit.near_bathhouse === true
              )
              // A room nobody has measured, findable at a glance. `sleeps: 0`
              // is treated as unknown alongside null — the API maps 0 to None
              // today, but a 0 arriving here must never render as a capacity.
              const unmeasured =
                first.unit.sleeps === null ||
                first.unit.sleeps === undefined ||
                first.unit.sleeps === 0
              // NAME THE BUILDING when the whole mark is one (kindred#2440).
              // `many` used to mean "these happen to overlap, zoom to
              // separate", so dropping the name cost nothing you could not
              // recover. It is structural now — the rooms of a building are
              // coincident at every zoom — so without this, 8 buildings on the
              // 2026 registry would show a bare count and no way to get a name
              // back. A cluster of several different buildings keeps the count
              // alone, because there is no one name to give it.
              const sharedBuilding =
                many && cluster.members.every((m) => m.item.buildingCode === first.buildingCode)
                  ? unitsByCode.get(first.buildingCode)?.name
                  : undefined
              const roomTally = `${String(cluster.members.length)} rooms · ${String(occupied)} occupied`
              let summary = many
                ? sharedBuilding === undefined
                  ? roomTally
                  : `${sharedBuilding} · ${roomTally}`
                : first.unit.name
              // Every glyph on the pin is also said in words here — colour and
              // shape alone are not signals (WCAG 1.4.1), and the mark carries
              // no other text.
              if (bathhouse) summary += ' · near bathhouse'
              if (!many && unmeasured) summary += ' · capacity unknown'
              // The ORDERING is `resolveRingPrecedence` (kindred#2136), shared
              // with `LodgingUnitCard.tsx`'s `ringState`. The drop-target state
              // is OMITTED, not passed as false: this surface has no placement
              // to have a target for (kindred#2183), so the resolver can only
              // land on `consentFlagged` or `plain`.
              //
              // ⚠️ THE SHARED HALO IS STRUCK (kindred#2179, owner ruling
              // 2026-08-09). It drew the area hue on any lone room holding two
              // families — the units built to hold several, so it was on almost
              // all the time, and a constant is not a signal. It went with the
              // board's matching ring, in the same change, because #2193 made
              // this one rule: striking it on the board and leaving it here
              // would be the two surfaces disagreeing about what a shared space
              // looks like. Amber is unaffected — it marks a share nobody
              // consented to, which is the rare fact worth a mark.
              const ringState = resolveRingPrecedence({ consentFlagged: flagged > 0 })
              const halo =
                ringState === 'consentFlagged'
                  ? `0 0 0 2px #fff, 0 0 0 4.5px ${CONSENT_AMBER}`
                  : '0 0 0 2px rgba(255,255,255,.95)'
              return (
                // Deliberately a plain clickable div, not role="button": see the ACCESSIBILITY note
                // at the top of this file. A role this mark cannot honour with real keyboard/focus
                // support (82 unreachable tab stops) is a worse lie than an honest non-control; the
                // accessible equivalent is Manage → Family Camp Lodging.
                <div
                  key={key}
                  data-testid="map-mark"
                  title={flagged > 0 ? `${summary} — ${CONSENT_PHRASE}` : summary}
                  // THE PEEK IS SUPPRESSED WHILE EDITING (kindred#2396
                  // ruling): a click no longer pins it and a dwell no longer
                  // opens it, so it cannot follow the drag and cover the
                  // very label the drag exists to uncover. `undefined`, not a
                  // no-op function — an absent handler is what keeps the mark
                  // honest about not being a control here, same reasoning as
                  // the canvas's own conditional pan handlers above.
                  onClick={
                    editingPins
                      ? undefined
                      : (event) => {
                          event.stopPropagation()
                          // A click PINS, and supersedes any dwell in flight —
                          // otherwise the timer fires later and reopens what the
                          // click just toggled shut.
                          cancelDwell()
                          setDwellKey(null)
                          setPinnedKey((current) => (current === key ? null : key))
                        }
                  }
                  // MOUSE ONLY. A touch pointerenter arrives with the tap
                  // itself, so honouring it would open on dwell and then
                  // immediately toggle shut on the click that follows.
                  onPointerEnter={
                    editingPins
                      ? undefined
                      : (event) => {
                          if (event.pointerType !== 'mouse') return
                          cancelDwell()
                          dwellTimer.current = setTimeout(() => {
                            setDwellKey(key)
                          }, DWELL_MS)
                        }
                  }
                  onPointerLeave={
                    editingPins
                      ? undefined
                      : (event) => {
                          if (event.pointerType !== 'mouse') return
                          cancelDwell()
                          // Only ever retracts the peek this mark itself borrowed —
                          // a pinned one belongs to the user, not to the cursor.
                          setDwellKey((current) => (current === key ? null : current))
                        }
                  }
                  // THE DRAG ITSELF, spread conditionally the same way the
                  // canvas's pan handlers are — present ONLY while editing,
                  // so a mark is incapable of moving anything the rest of the
                  // time. `pinSite` resolves the WRITE TARGET once per
                  // gesture at pointerdown: every member of a cluster shares
                  // one `buildingCode` (mapClustering.ts's group barrier), so
                  // `first.unit` speaks for the whole mark.
                  {...(editingPins
                    ? {
                        onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
                          if (event.button !== 0) return
                          if (pinDragRef.current !== null) return
                          const site = pinSite(first.unit, units)
                          // Unreachable while `hasCoordinates` gates which
                          // units ever reach a mark at all — kept as a guard
                          // on a state this file cannot prove impossible from
                          // here, not as a state believed reachable.
                          if (site === null) return
                          event.stopPropagation()
                          try {
                            event.currentTarget.setPointerCapture(event.pointerId)
                          } catch {
                            // Unsupported, or the pointer is already gone —
                            // same non-fatal case `UnitMapPositionField`
                            // documents at its own capture call.
                          }
                          pinDragRef.current = {
                            pointerId: event.pointerId,
                            buildingCode: first.buildingCode,
                          }
                          const rect = canvasRef.current?.getBoundingClientRect()
                          if (!rect) return
                          const point = screenToNormalized(
                            event.clientX - rect.left,
                            event.clientY - rect.top,
                            view,
                            width,
                            height
                          )
                          setPinDrafts((current) => {
                            const next = new Map(current)
                            next.set(first.buildingCode, {
                              targetUnitId: site.unit_id,
                              x: point.x,
                              y: point.y,
                            })
                            return next
                          })
                        },
                        onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
                          const drag = pinDragRef.current
                          if (!drag || drag.pointerId !== event.pointerId) return
                          // No button held: the release happened somewhere
                          // this mark never saw (capture unavailable), so end
                          // the gesture here rather than keep following an
                          // unpressed cursor. Same guard UnitMapPositionField
                          // carries at its own onPointerMove.
                          if (event.buttons === 0) {
                            pinDragRef.current = null
                            return
                          }
                          const rect = canvasRef.current?.getBoundingClientRect()
                          if (!rect) return
                          const point = screenToNormalized(
                            event.clientX - rect.left,
                            event.clientY - rect.top,
                            view,
                            width,
                            height
                          )
                          setPinDrafts((current) => {
                            const existing = current.get(drag.buildingCode)
                            if (!existing) return current
                            const next = new Map(current)
                            next.set(drag.buildingCode, { ...existing, x: point.x, y: point.y })
                            return next
                          })
                        },
                        onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
                          const drag = pinDragRef.current
                          if (!drag || drag.pointerId !== event.pointerId) return
                          pinDragRef.current = null
                        },
                        // The browser took the gesture away. The draft this
                        // gesture last wrote STAYS — this only releases the
                        // pointer's OWNERSHIP of the drag, so a later drag can
                        // pick the same building back up; the accumulated
                        // move is not lost the way a single-value `abandon()`
                        // would lose it in `UnitMapPositionField`.
                        onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
                          const drag = pinDragRef.current
                          if (!drag || drag.pointerId !== event.pointerId) return
                          pinDragRef.current = null
                        },
                      }
                    : {})}
                  style={{
                    left: cluster.x,
                    top: cluster.y,
                  }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                    editingPins ? 'cursor-grab touch-none' : 'cursor-pointer'
                  }`}
                >
                  <span
                    style={{
                      backgroundColor: many || first.parties.length > 0 ? hue : 'white',
                      borderColor: hue,
                      boxShadow: halo,
                      width: many ? Math.min(17 + cluster.members.length * 2.6, 38) : 16,
                      height: many ? Math.min(17 + cluster.members.length * 2.6, 38) : 16,
                      borderRadius: allStaff ? 4 : '50%',
                      borderStyle: anyStaff ? 'dashed' : 'solid',
                    }}
                    className="grid place-items-center border-2 text-xs font-bold text-white"
                  >
                    {/* A cluster spends its face on the member count, so the
                        `?` is a lone room's glyph. An unmeasured room inside a
                        cluster surfaces in the peek's grid instead. */}
                    {many ? cluster.members.length : unmeasured ? '?' : ''}
                  </span>
                  {bathhouse && (
                    <span
                      data-testid="map-mark-bathhouse"
                      aria-hidden="true"
                      style={{ backgroundColor: BATHHOUSE_BLUE }}
                      className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full ring-1 ring-white"
                    />
                  )}
                </div>
              )
            })}

            {/* A SIBLING of the marks, never a child. Nesting it inside a mark
                put MapUnitPopover's occupant <button>s inside the mark element,
                which is interactive content inside interactive content: invalid
                ARIA, two click handlers on one gesture, and an accessible name
                computed from all the descendant text. It is absolutely
                positioned either way, so nesting bought nothing.
                CLAMPED rather than centred blindly: 11 of 102 marks sit within
                120px of a canvas edge at rest, and most pass near one when
                zoomed, so an unclamped popover runs off-canvas and half of it
                becomes unreachable. */}
            {openCluster && (
              <div
                style={{
                  left: Math.min(
                    Math.max(openCluster.x, POPOVER_HALF_WIDTH),
                    width - POPOVER_HALF_WIDTH
                  ),
                  top: Math.min(
                    Math.max(openCluster.y, POPOVER_HALF_HEIGHT),
                    height - POPOVER_HALF_HEIGHT
                  ),
                }}
                className="absolute z-30 -translate-x-1/2 -translate-y-1/2"
              >
                <MapUnitPopover
                  units={openCluster.members.map((member) => member.item)}
                  hue={openCluster.members[0]?.item.hue ?? ''}
                  onOpenParty={openParty}
                  wholeBuildingKeys={wholeBuildingKeys}
                />
              </div>
            )}

            {/* Wheel-zoom, drag-pan and the double-click reset have no
                affordance of their own, and a full-bleed illustration reads
                as a static picture until someone says otherwise. Inert, so it
                can never eat a drag that starts on top of it. */}
            <p className="text-muted-foreground bg-card/90 border-border pointer-events-none absolute bottom-2 left-2 rounded-md border px-2 py-1 text-[11px]">
              scroll to zoom · drag to pan · double-click to reset · click a pin for detail
            </p>
          </div>

          {/* The mark has seven encoding channels and no text of its own. Its
              `title` says the same things in words, but only one mark at a time
              and only on hover — which is no help at all to someone scanning
              for the blue dots. staff-default, near-bathhouse and area colour
              moved to the shared Visual Guide (kindred#1997) — they are no
              longer map-only, now that the board's own cards carry them too. */}
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
            {/* DEMOTED from the control bar, not deleted (kindred#1997): it
                hides 25 of 76 marks on the busiest 2026 weekend, and it is the
                map's LAST keyboard-reachable control — see the note at
                `:29-33` above. Still a real `<input>` behind a real `<label>`,
                per that note, not re-invented as a div. A SIBLING of the
                legend strip below, not a child of it (kindred#2157), so the
                checkbox stays out of whatever the strip's own markup does —
                this `role="group"` carries it instead, and is how the test
                suite addresses it (`getByRole('group', { name: 'Map
                controls' })`). No wrapping div around the label either; the
                label already declares the same `inline-flex items-center
                gap-1.5` a wrapper would add. */}
            <div
              role="group"
              aria-label="Map controls"
              className="flex flex-wrap items-center gap-x-4 gap-y-1.5"
            >
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={showEmpty}
                  onChange={(event) => {
                    setShowEmpty(event.target.checked)
                    // The hidden rooms take their peek with them; leaving it
                    // open would strand a popover over a mark that no longer
                    // exists.
                    closePeek()
                  }}
                />
                Empty rooms
              </label>
              {/* SIBLING OF EMPTY ROOMS, per the owner ruling on kindred#2396
                  — the same `role="group"` this one already carries a test
                  handle for, no new one needed. Toggling either direction
                  calls `closePeek()`, mirroring Empty rooms' own onChange:
                  turning editing ON must not leave a peek open to follow the
                  drag over the label it exists to uncover, and turning it
                  OFF is the flush point — see the effect above — where a peek
                  from BEFORE editing started has long since closed anyway. */}
              <label className="inline-flex cursor-pointer items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={editingPins}
                  onChange={(event) => {
                    setEditingPins(event.target.checked)
                    closePeek()
                  }}
                />
                Edit pins
              </label>
              {editingPins && (
                <span className="text-primary font-semibold">
                  Editing — drag a pin to uncover a label. Saves when you turn this off.
                </span>
              )}
            </div>
            {/* `contents`: this legend strip generates no box of its own —
                its children lay out as direct items of the flex-wrap row
                above, unchanged from before kindred#2157, `ml-auto` on
                Counts included. A plain `<div>`, not a `<dl>`: each row used
                to pair a visible `<dd>` with a `<dt className="sr-only">`
                restating it (kindred#2348) — invisible-but-rendered text
                nothing here reads, since the mark beside each `<dd>` already
                carries the same fact for a sighted user. Deleting only the
                `<dt>`s would have left an orphaned `<dd>` with no `<dt>`, an
                invalid list either way, so the wrapper and every row's
                definition became plain elements together. */}
            <div data-testid="map-legend" className="contents">
              <div className="flex items-center gap-1.5">
                <span className="border-muted-foreground/70 h-3 w-3 rounded-full border-2 bg-transparent" />
                <span>empty</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="bg-muted-foreground/70 border-muted-foreground/70 h-3 w-3 rounded-full border-2" />
                <span>one party</span>
              </div>
              {/* The ringed "shared" row is GONE with the halo it keyed
                  (kindred#2179). A legend entry for a mark the surface no
                  longer draws is worse than no entry: it sends staff looking
                  for a ring that cannot appear. */}
              <div className="flex items-center gap-1.5">
                <span className="text-foreground font-bold">?</span>
                <span>capacity unknown (never 0)</span>
              </div>
              {/* A cluster's mark GROWS with what is under it and wears the
                  count on its face. Without this, a big numbered mark reads as
                  importance rather than as "there are more of them here". */}
              <div className="flex items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className="bg-muted-foreground/70 border-muted-foreground/70 grid h-4 w-4 place-items-center rounded-full border-2 text-[8px] font-bold text-white"
                >
                  3
                </span>
                <span>bigger mark, more rooms under it</span>
              </div>
              <div className="ml-auto flex items-center gap-1.5">
                <span className="tabular-nums">
                  <b className="text-foreground font-semibold">{roomCount}</b>{' '}
                  {roomCount === 1 ? 'room' : 'rooms'} ·{' '}
                  <b className="text-foreground font-semibold">{containerCount}</b>{' '}
                  {containerCount === 1 ? 'container' : 'containers'} not drawn ·{' '}
                  <b className="text-foreground font-semibold">{clusterCount}</b>{' '}
                  {clusterCount === 1 ? 'cluster' : 'clusters'}
                </span>
              </div>
            </div>
          </div>

          {/* A merge carries no unit code, and an assignment can name a
              container or a unit the map has no coordinate for. Those
              parties ARE placed, so the unplaced queue would be a lie if it
              counted them — and dropping them would make the map quietly
              disagree with the roster. Mirrors `LodgingBoard`'s "Placed
              outside the board". Inside the card, not a sibling of it, so it
              inherits the same `p-3` padding the rest of the card body
              does. */}
          {model.offMap.length > 0 && (
            <section data-testid="map-offmap-section">
              <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
                <Info className="h-3.5 w-3.5 flex-shrink-0" />
                Placed, off the map
              </h3>
              <p className="text-muted-foreground mb-2 text-xs">
                Assigned to a merged slot or to a room with no position on the map yet.
              </p>
              <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-start gap-2.5">
                {model.offMap.map((entry) => (
                  <FamilyCard
                    key={partyKey(entry.party)}
                    party={entry.party}
                    // ⚠️ THE UNIT IS NOT OPTIONAL HERE, though the prop is.
                    // These parties are PLACED — the section says so — and
                    // since kindred#2072 the card grades its need glyphs
                    // against whatever unit it is handed. Passing nothing
                    // makes every glyph read as met, which is a positive
                    // claim about a cabin this surface never looked at; it
                    // used to print "Fit not verified" instead, and that chip
                    // is struck. `resolvePartyUnit` is the same call the
                    // details panel below already makes, and it is what
                    // resolves a MERGED slot, whose `unit_code` is "" by
                    // design (kindred#1982) — which is most of what lands in
                    // this section.
                    unit={resolvePartyUnit(entry.party, unitsByCode)}
                    onOpen={openParty}
                  />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* The SHARED corner queue the board mounts too, deliberately without
          the placement permission the board passes it. That omission is a
          RULING, not an oversight (kindred#2183): the queue here is a list of
          who still needs a room, and this surface does not give anyone one.
          The component defaults the permission off, so the omission is the
          whole implementation — nothing to hard-code false. */}
      <FloatingUnplacedBadge
        parties={model.unplaced}
        onOpenParty={openParty}
        isPanelOpen={panelParty !== null}
      />

      {panelParty !== null && (
        <FamilyDetailsPanel
          party={panelParty}
          unit={resolvePartyUnit(panelParty, unitsByCode)}
          year={year}
          requestClose={requestClose}
          onClose={closePanel}
        />
      )}
    </div>
  )
}
