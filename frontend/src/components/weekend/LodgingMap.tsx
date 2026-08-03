/**
 * The weekend lodging MAP — read-only, and a projection of the board.
 *
 * Same roster payload, same `buildBoard`, plus position. It answers the two
 * questions a grid cannot: is this family near that one, and does this family
 * sit beside a bathhouse or a staff cabin.
 *
 * SCENARIO AWARENESS MIRRORS THE BOARD AND NOTHING MORE. With no scenario this
 * is a CampMinder mirror and says so on the surface. When the drag PR wires
 * `ScenarioContext`'s `isProductionMode` through, both surfaces adopt it
 * together — a map that knew about scenarios while the board did not would be
 * a second system of record, which is the one thing this must not be.
 *
 * ACCESSIBILITY, stated rather than implied: a pan/zoom map is not
 * keyboard-navigable. The Inventory tab is the accessible equivalent — the same
 * units, grouped by area, in a list. Nothing may be reachable ONLY here.
 *
 * The marks are therefore plain clickable divs and deliberately do NOT carry
 * `role="button"`. A role they cannot honour — 82 unreachable tab stops, or a
 * control with `tabIndex={-1}` that no keyboard can focus — is a worse lie than
 * an honest non-control. The popover is a SIBLING of the marks for a related
 * reason; see the comment at its render site.
 *
 * THE MARK CARRIES SPEC §6.3's ENCODING IN FULL, and the list is closed on
 * purpose — position, fill, area hue, dashed square for staff-default, a blue
 * dot for `near_bathhouse`, `?` for unmeasured capacity, and a ring that is
 * the area hue when a room is shared and amber when that sharing was never
 * consented to. Everything else the payload carries — reservation state,
 * inactive, unconfirmed, amenities, beds, and a cabin that does not answer
 * what a family asked for — lives in the peek. A 16px pin has room for about
 * seven channels before it stops being readable, which is the failure §6.2
 * spends its whole length avoiding.
 */
import { Minus, Plus, Maximize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { FamilyCard } from './FamilyCard'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { indexUnitsByCode } from './rosterAttention'
import { clusterByProximity, type Cluster, type Placed } from './mapClustering'
import { buildMapModel, type MapUnit } from './mapModel'
import { CONSENT_AMBER, CONSENT_PHRASE, MapUnitPopover } from './MapUnitPopover'
import {
  basePosition,
  clampView,
  IDENTITY_VIEW,
  MAP_ASPECT,
  screenPosition,
  type Viewport,
  zoomAt,
} from './mapViewport'

/** Served from the private repo, exactly as the logos are. */
const MAP_IMAGE_URL = '/local/assets/camp-map.webp'

/** Below this a pointer gesture is a click, above it a pan. Capturing the
 *  pointer any earlier retargets the click away from the mark under it. */
const DRAG_THRESHOLD_PX = 4

/** Default scrim over the map so the marks read against a busy illustration. */
const DEFAULT_FADE = 25

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

/** The bathhouse dot. Blue, and not one of the eight area hues. */
const BATHHOUSE_BLUE = '#2563eb'

/**
 * A highlight DIMS what does not match rather than hiding it.
 *
 * "Which cabins are near a bathhouse" is only half the question — the other
 * half is where they sit relative to everything else, and removing the rest
 * throws that away. Low enough to recede, high enough that the dimmed marks
 * still read as a site plan.
 */
const DIMMED_OPACITY = 0.22

/** Breathing room around an area's tint box, in screen pixels. */
const TINT_PADDING_PX = 20

/**
 * Which question the marks are answering. At most one at a time.
 *
 * Area tint and Empty rooms are NOT in here and stay checkboxes: a tint is a
 * backdrop and the empty toggle changes which rooms are on the map at all, so
 * neither competes with a highlight or with the other.
 */
type Highlight = 'none' | 'bathhouse' | 'staff'

const HIGHLIGHTS: Array<{ id: Highlight; label: string }> = [
  { id: 'none', label: 'No highlight' },
  { id: 'bathhouse', label: 'Near bathhouse' },
  { id: 'staff', label: 'Staff cabins' },
]

/** Half of the popover's `max-w-[15rem]` (240px), padded a bit. Clamping the
 *  anchor at least this far from each edge keeps the box on-screen. Height
 *  is content-dependent (a detail card is shorter than a multi-room
 *  footprint grid), so this is deliberately generous rather than exact —
 *  better a small unnecessary gap than a clipped popover. */
const POPOVER_HALF_WIDTH = 130
const POPOVER_HALF_HEIGHT = 110

interface TintBox {
  areaName: string
  hue: string
  left: number
  top: number
  width: number
  height: number
}

/**
 * A translucent box around each area's rooms, in SCREEN space so it pans and
 * zooms with them.
 *
 * A bounding box, not a hull: areas genuinely overlap where they abut, and a
 * box that says "roughly here" is honest about that in a way a tight polygon
 * would not be. Areas with a single room on screen are skipped — one pin has
 * no extent to describe.
 */
function areaTintBoxes(placed: Array<Placed<MapUnit>>): TintBox[] {
  const byArea = new Map<string, Array<Placed<MapUnit>>>()
  for (const entry of placed) {
    // `area_name` is optional on the generated row type. Rooms without one are
    // left untinted rather than pooled under a shared blank key, which would
    // draw one box spanning two rooms that have nothing to do with each other.
    const areaName = entry.item.unit.area_name
    if (areaName === undefined || areaName.length === 0) continue
    const existing = byArea.get(areaName)
    if (existing) existing.push(entry)
    else byArea.set(areaName, [entry])
  }

  const boxes: TintBox[] = []
  for (const [areaName, members] of byArea) {
    if (members.length < 2) continue
    const xs = members.map((member) => member.x)
    const ys = members.map((member) => member.y)
    const left = Math.min(...xs)
    const top = Math.min(...ys)
    boxes.push({
      areaName,
      hue: members[0]?.item.hue ?? '',
      left: left - TINT_PADDING_PX,
      top: top - TINT_PADDING_PX,
      width: Math.max(...xs) - left + TINT_PADDING_PX * 2,
      height: Math.max(...ys) - top + TINT_PADDING_PX * 2,
    })
  }
  return boxes
}

export interface LodgingMapProps {
  parties: RosterPartyRow[]
  units: LodgingUnitRow[]
  year: number
}

function partyKey(party: RosterPartyRow): string {
  return `${party.grain}-${String(party.household_cm_id || party.person_cm_id || party.display_name)}`
}

export function LodgingMap({ parties, units, year }: LodgingMapProps) {
  // MEMOISED, and not as a micro-optimisation: panning updates `view` on every
  // pointermove, and an unmemoised call would re-run buildBoard — area bucketing,
  // sorting, hue assignment, the lot — on every frame of a drag.
  const model = useMemo(() => buildMapModel(parties, units), [parties, units])

  const canvasRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
    x: number
    y: number
    tx: number
    ty: number
    id: number
    active: boolean
  } | null>(null)
  const [view, setView] = useState<Viewport>(IDENTITY_VIEW)
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [imageFailed, setImageFailed] = useState(false)
  const [fade, setFade] = useState(DEFAULT_FADE)
  // Empty rooms are DRAWN by default and nothing is highlighted at rest: the
  // map's job when you arrive is the whole site, and each control below is a
  // question you bring to it rather than one the surface should ask for you.
  const [showEmpty, setShowEmpty] = useState(true)
  const [areaTint, setAreaTint] = useState(false)
  // ONE CHOICE, not two booleans. As independent checkboxes these ANDed, so
  // ticking both dimmed everything that was not near a bathhouse AND beside
  // staff — an intersection nobody asked for, which read as a filter that had
  // eaten the map. They are two questions about the same marks, and the
  // control now says so.
  const [highlight, setHighlight] = useState<Highlight>('none')
  // TWO keys, not one. A click PINS the peek and a dwell only borrows it, so
  // the pointer leaving a mark must close a dwell-opened peek without
  // touching one the user deliberately pinned. Collapsing them into a single
  // `openKey` made a pinned peek evaporate the moment the cursor moved to
  // read it.
  const [pinnedKey, setPinnedKey] = useState<string | null>(null)
  const [dwellKey, setDwellKey] = useState<string | null>(null)
  const dwellTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [selected, setSelected] = useState<RosterPartyRow | null>(null)
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

  const openParty = useCallback((party: RosterPartyRow) => {
    setSelected(party)
  }, [])

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closePeek()
    }
    node.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      node.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
    }
    // `closePeek` is a stable useCallback over a stable `cancelDwell`, so this
    // listener is still attached exactly once — the dependency documents the
    // reference rather than reattaching on every render.
  }, [closePeek])

  // FILTERED BEFORE CLUSTERING, and that ordering is the point: hiding empty
  // rooms also dissolves the clusters they were padding, so what is left is a
  // map of the occupied site rather than the same blobs with holes in them.
  const drawn = showEmpty
    ? model.units
    : model.units.filter((mapUnit) => mapUnit.parties.length > 0)
  const placed = drawn.map((mapUnit) => {
    const base = basePosition(mapUnit.x, mapUnit.y, width, height)
    const screen = screenPosition(base, view)
    return { item: mapUnit, x: screen.x, y: screen.y }
  })
  const clusters = clusterByProximity(placed)
  const tintBoxes = areaTint ? areaTintBoxes(placed) : []

  // Counted off what was actually drawn, never off a second predicate — a
  // legend that disagrees with the map is worse than no legend.
  const clusterCount = clusters.filter((cluster) => cluster.members.length > 1).length
  // Rooms the payload HAS, not rooms currently shown: this number's job is to
  // account for the units, and a count that moved when you hid the empties
  // would stop reconciling against the Inventory tab.
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

  const resetView = () => {
    closePeek()
    setView(IDENTITY_VIEW)
  }

  const zoomBy = (factor: number) => {
    closePeek()
    setView((current) => zoomAt(current, width / 2, height / 2, factor, width, height))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          CM — CampMinder mirror, read-only
        </span>
        {model.unpositionedUnits.length > 0 && (
          <span className="text-muted-foreground text-xs">
            {model.unpositionedUnits.length === 1
              ? '1 room has no position yet'
              : `${String(model.unpositionedUnits.length)} rooms have no position yet`}
          </span>
        )}
      </div>

      <div className="card-lodge grid grid-cols-1 overflow-hidden lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="bg-muted/30 border-border/60 flex flex-col gap-3 border-b p-3 lg:border-r lg:border-b-0">
          {selected ? (
            <FamilyDetailsPanel
              key={partyKey(selected)}
              party={selected}
              unit={unitsByCode.get(selected.unit_code ?? '')}
              year={year}
              embedded={true}
              onClose={() => {
                setSelected(null)
              }}
            />
          ) : (
            <>
              <div data-testid="map-unplaced-rail" className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-foreground text-sm font-bold">Unplaced</h3>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {model.unplaced.length}
                  </span>
                </div>
                {model.unplaced.length === 0 ? (
                  <p className="text-muted-foreground text-xs italic">Everyone has a cabin.</p>
                ) : (
                  model.unplaced.map((party) => (
                    <FamilyCard
                      key={partyKey(party)}
                      party={party}
                      onRail={true}
                      onOpen={openParty}
                    />
                  ))
                )}
              </div>

              <div data-testid="map-offmap-rail" className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-display text-foreground text-sm font-bold">
                    Placed, off the map
                  </h3>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {model.offMap.length}
                  </span>
                </div>
                {model.offMap.length === 0 ? (
                  <p className="text-muted-foreground text-xs italic">
                    Everyone placed is on the map.
                  </p>
                ) : (
                  model.offMap.map((entry) => (
                    <FamilyCard
                      key={partyKey(entry.party)}
                      party={entry.party}
                      onRail={true}
                      onOpen={openParty}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </aside>
        <div className="flex flex-col gap-2 p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button
              type="button"
              onClick={() => {
                zoomBy(1 / 1.45)
              }}
              className="border-border text-muted-foreground hover:text-foreground hover:border-primary/50 rounded-lg border p-1.5 transition-colors"
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => {
                zoomBy(1.45)
              }}
              className="border-border text-muted-foreground hover:text-foreground hover:border-primary/50 rounded-lg border p-1.5 transition-colors"
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={resetView}
              className="border-border text-muted-foreground hover:text-foreground hover:border-primary/50 inline-flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition-colors"
            >
              <Maximize2 className="h-4 w-4" />
              Fit all
            </button>
            <label className="text-muted-foreground ml-2 inline-flex items-center gap-1.5">
              Fade map
              <input
                type="range"
                min={0}
                max={70}
                step={5}
                value={fade}
                onChange={(event) => {
                  setFade(Number(event.target.value))
                }}
                className="w-20"
              />
              <span
                data-testid="map-fade-value"
                className="text-foreground font-semibold tabular-nums"
              >
                {fade}%
              </span>
            </label>

            <span aria-hidden="true" className="bg-border mx-1 h-5 w-px" />

            {/* Real checkboxes, and the only keyboard-reachable controls on this
                surface. The marks cannot be — see the note at the top of the
                file — so these must not be re-invented as divs. */}
            <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={areaTint}
                onChange={(event) => {
                  setAreaTint(event.target.checked)
                }}
              />
              Area tint
            </label>
            <label className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5">
              <input
                type="checkbox"
                checked={showEmpty}
                onChange={(event) => {
                  setShowEmpty(event.target.checked)
                  // The hidden rooms take their peek with them; leaving it open
                  // would strand a popover over a mark that no longer exists.
                  closePeek()
                }}
              />
              Empty rooms
            </label>

            {/* RADIOS, not checkboxes. The control's shape is the explanation:
                a checkbox promises the options combine, and these cannot —
                answering both at once leaves an intersection that reads as a
                filter with a bug in it. */}
            <fieldset className="contents">
              <legend className="sr-only">Highlight</legend>
              <span aria-hidden="true" className="bg-border mx-1 h-5 w-px" />
              <span className="text-muted-foreground">Highlight</span>
              {HIGHLIGHTS.map((option) => (
                <label
                  key={option.id}
                  className="text-muted-foreground inline-flex cursor-pointer items-center gap-1.5"
                >
                  <input
                    type="radio"
                    name="map-highlight"
                    value={option.id}
                    checked={highlight === option.id}
                    onChange={() => {
                      setHighlight(option.id)
                    }}
                  />
                  {option.label}
                </label>
              ))}
            </fieldset>

            <span className="text-muted-foreground ml-auto tabular-nums">{view.k.toFixed(1)}×</span>
          </div>

          <div
            ref={canvasRef}
            data-testid="map-canvas"
            style={{ aspectRatio: `${String(MAP_ASPECT)}` }}
            className="bg-muted/40 relative w-full touch-none overflow-hidden rounded-xl select-none"
            onClick={(event) => {
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
            // as the background dismiss is what keeps the two apart.
            onDoubleClick={(event) => {
              const target = event.target as HTMLElement
              if (
                target.closest('[data-testid="map-mark"]') ||
                target.closest('[data-map-popover]')
              ) {
                return
              }
              resetView()
            }}
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
            onPointerDown={(event) => {
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
            }}
            onPointerMove={(event) => {
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
              setView(clampView({ k: view.k, tx: drag.tx + dx, ty: drag.ty + dy }, width, height))
            }}
            onPointerCancel={() => {
              // The browser took the gesture away (system gesture, tab switch).
              // No capture to release — it is released for us — but the record
              // must go or a stale baseline outlives the gesture.
              dragRef.current = null
            }}
            onPointerUp={(event) => {
              const drag = dragRef.current
              if (!drag || event.pointerId !== drag.id) return
              if (drag.active && event.currentTarget.hasPointerCapture(drag.id)) {
                event.currentTarget.releasePointerCapture(drag.id)
              }
              dragRef.current = null
            }}
          >
            {!imageFailed && (
              <img
                data-testid="map-backdrop"
                src={MAP_IMAGE_URL}
                alt=""
                loading="lazy"
                onError={() => {
                  setImageFailed(true)
                }}
                style={{
                  width,
                  height,
                  transform: `translate(${String(view.tx)}px, ${String(view.ty)}px) scale(${String(view.k)})`,
                  // LOAD-BEARING, not incidental. The marks are placed at
                  // `u * size * k + t`, which matches this image only while it
                  // scales about its top-left. With the CSS default of 50% 50%
                  // an image point lands at `k*a + (1-k)*w/2 + t` — an offset
                  // that is ZERO ONLY AT k=1, so the map would look
                  // pixel-perfect at rest and drift further out of register the
                  // more you zoom. jsdom performs no layout, so no test here can
                  // catch it; the algebra is the only guard.
                  transformOrigin: '0 0',
                }}
                className="pointer-events-none absolute top-0 left-0 max-w-none"
              />
            )}
            <div
              aria-hidden="true"
              style={{ opacity: fade / 100 }}
              className="bg-card pointer-events-none absolute inset-0"
            />
            {imageFailed && (
              <p className="text-muted-foreground pointer-events-none absolute top-3 left-3 text-xs">
                Map image unavailable — showing positions only.
              </p>
            )}

            {/* UNDER the marks and inert: a tint that could swallow a click
                would cost the surface its only interaction. */}
            {tintBoxes.map((box) => (
              <div
                key={box.areaName}
                data-testid="map-area-tint"
                aria-hidden="true"
                style={{
                  left: box.left,
                  top: box.top,
                  width: box.width,
                  height: box.height,
                  backgroundColor: box.hue,
                }}
                className="pointer-events-none absolute rounded-2xl opacity-15"
              />
            ))}

            {clusters.map((cluster) => {
              const key = clusterKey(cluster)
              const first = cluster.members[0]?.item
              if (!first) return null
              const many = cluster.members.length > 1
              const occupied = cluster.members.filter((m) => m.item.parties.length > 0).length
              const shared = !many && first.parties.length > 1
              // ORDER-INVARIANT, mirroring MapUnitPopover's own semantics. A
              // cluster is only "a staff building" — SHAPE: a dashed square —
              // if EVERY member is one, but ANY staff member still HIGHLIGHTS
              // the mark with a dashed border, so a mixed cluster does not
              // silently read as an ordinary building with nothing
              // staff-related about it. Reading straight off `members[0]` —
              // the old code — meant the shape flipped with whichever row the
              // database happened to return first.
              const allStaff = cluster.members.every(
                (member) => member.item.unit.allocation_default === 'staff_default'
              )
              const anyStaff = cluster.members.some(
                (member) => member.item.unit.allocation_default === 'staff_default'
              )
              // Hue has the same order-dependence risk. Cross-area clusters
              // are 0 on the current registry — clustering is proximity-based
              // and rooms rarely straddle an area boundary — but this must
              // not assume that stays true. `first.hue` is kept as the
              // fallback deliberately: there is no principled "average" of
              // two areas' colours.
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
              // `some`, matching the mark's own semantics: a cluster holding
              // one bathhouse-adjacent room IS part of the answer to where the
              // bathhouses are.
              const dimmed =
                (highlight === 'bathhouse' && !bathhouse) || (highlight === 'staff' && !anyStaff)
              // A room nobody has measured, findable at a glance. `sleeps: 0`
              // is treated as unknown alongside null — the API maps 0 to None
              // today, but a 0 arriving here must never render as a capacity.
              const unmeasured =
                first.unit.sleeps === null ||
                first.unit.sleeps === undefined ||
                first.unit.sleeps === 0
              let summary = many
                ? `${String(cluster.members.length)} rooms · ${String(occupied)} occupied`
                : first.unit.name
              // Every glyph on the pin is also said in words here — colour and
              // shape alone are not signals (WCAG 1.4.1), and the mark carries
              // no other text.
              if (bathhouse) summary += ' · near bathhouse'
              if (!many && unmeasured) summary += ' · capacity unknown'
              // Amber SUPERSEDES the shared ring rather than competing with it:
              // a consent flag only ever exists on a shared room, so the two
              // can never both need the same ring.
              let halo = '0 0 0 2px rgba(255,255,255,.95)'
              if (flagged > 0) halo = `0 0 0 2px #fff, 0 0 0 4.5px ${CONSENT_AMBER}`
              else if (shared) halo = `0 0 0 2px #fff, 0 0 0 4.5px ${hue}`
              return (
                <div
                  key={key}
                  data-testid="map-mark"
                  title={flagged > 0 ? `${summary} — ${CONSENT_PHRASE}` : summary}
                  onClick={(event) => {
                    event.stopPropagation()
                    // A click PINS, and supersedes any dwell in flight —
                    // otherwise the timer fires later and reopens what the
                    // click just toggled shut.
                    cancelDwell()
                    setDwellKey(null)
                    setPinnedKey((current) => (current === key ? null : key))
                  }}
                  // MOUSE ONLY. A touch pointerenter arrives with the tap
                  // itself, so honouring it would open on dwell and then
                  // immediately toggle shut on the click that follows.
                  onPointerEnter={(event) => {
                    if (event.pointerType !== 'mouse') return
                    cancelDwell()
                    dwellTimer.current = setTimeout(() => {
                      setDwellKey(key)
                    }, DWELL_MS)
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType !== 'mouse') return
                    cancelDwell()
                    // Only ever retracts the peek this mark itself borrowed —
                    // a pinned one belongs to the user, not to the cursor.
                    setDwellKey((current) => (current === key ? null : current))
                  }}
                  style={{
                    left: cluster.x,
                    top: cluster.y,
                    // Set EXPLICITLY at full strength rather than left unstyled,
                    // so "nothing is dimmed" is an assertable state rather than
                    // the absence of one.
                    opacity: dimmed ? DIMMED_OPACITY : 1,
                  }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
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
                />
              </div>
            )}

            {/* Wheel-zoom and drag-pan have no affordance of their own, and a
                full-bleed illustration reads as a static picture until someone
                says otherwise. Inert, so it can never eat a drag that starts
                on top of it. */}
            <p className="text-muted-foreground bg-card/90 border-border pointer-events-none absolute bottom-2 left-2 rounded-md border px-2 py-1 text-[11px]">
              scroll to zoom · drag to pan · click a pin for detail
            </p>
          </div>

          {/* The mark has seven encoding channels and no text of its own. Its
              `title` says the same things in words, but only one mark at a time
              and only on hover — which is no help at all to someone scanning
              for the blue dots. */}
          <dl
            data-testid="map-legend"
            className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]"
          >
            <div className="flex items-center gap-1.5">
              <span className="border-muted-foreground/70 h-3 w-3 rounded-full border-2 bg-transparent" />
              <dt className="sr-only">Hollow mark</dt>
              <dd>empty</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="bg-muted-foreground/70 border-muted-foreground/70 h-3 w-3 rounded-full border-2" />
              <dt className="sr-only">Solid mark</dt>
              <dd>one party</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="bg-muted-foreground/70 border-muted-foreground/70 h-3 w-3 rounded-full border-2 ring-2 ring-current ring-offset-1" />
              <dt className="sr-only">Ringed mark</dt>
              <dd>shared</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="border-muted-foreground/70 h-3 w-3 rounded-[3px] border-2 border-dashed" />
              <dt className="sr-only">Dashed square</dt>
              <dd>staff-default</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                style={{ backgroundColor: BATHHOUSE_BLUE }}
                className="h-2 w-2 rounded-full ring-1 ring-white"
              />
              <dt className="sr-only">Blue dot</dt>
              <dd>near bathhouse</dd>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-foreground font-bold">?</span>
              <dt className="sr-only">Question mark</dt>
              <dd>capacity unknown (never 0)</dd>
            </div>
            <div className="ml-auto flex items-center gap-1.5">
              <dt className="sr-only">Counts</dt>
              <dd className="tabular-nums">
                <b className="text-foreground font-semibold">{roomCount}</b>{' '}
                {roomCount === 1 ? 'room' : 'rooms'} ·{' '}
                <b className="text-foreground font-semibold">{containerCount}</b>{' '}
                {containerCount === 1 ? 'container' : 'containers'} not drawn ·{' '}
                <b className="text-foreground font-semibold">{clusterCount}</b>{' '}
                {clusterCount === 1 ? 'cluster' : 'clusters'} at this zoom
              </dd>
            </div>
          </dl>
        </div>

        {/* EMBEDDED, not an overlay. FamilyDetailsPanel's own docstring: "The map
            opens this same panel embedded; a second implementation is exactly what
            `embedded` exists to prevent." In embedded mode it installs no Escape
            handler and has no slide-out, so there is no `requestClose` and no
            click-outside predicate here — it stays until dismissed, which is what
            you want while comparing two families across the site.
            `key` is load-bearing: without it React reuses the instance across
            selections and `useState` initialisers never re-run. */}
      </div>
    </div>
  )
}
