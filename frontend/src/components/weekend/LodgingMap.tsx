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
 * an honest non-control, and it is what forced the popover to be a child of the
 * mark rather than a sibling.
 */
import { Minus, Plus, Maximize2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { FamilyCard } from './FamilyCard'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { indexUnitsByCode } from './rosterAttention'
import { clusterByProximity, type Cluster } from './mapClustering'
import { buildMapModel, type MapUnit } from './mapModel'
import { MapUnitPopover } from './MapUnitPopover'
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

/** Half of the popover's `max-w-[15rem]` (240px), padded a bit. Clamping the
 *  anchor at least this far from each edge keeps the box on-screen. Height
 *  is content-dependent (a detail card is shorter than a multi-room
 *  footprint grid), so this is deliberately generous rather than exact —
 *  better a small unnecessary gap than a clipped popover. */
const POPOVER_HALF_WIDTH = 130
const POPOVER_HALF_HEIGHT = 110

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
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [selected, setSelected] = useState<RosterPartyRow | null>(null)
  const unitsByCode = useMemo(() => indexUnitsByCode(units), [units])

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
      setOpenKey(null)
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
      if (event.key === 'Escape') setOpenKey(null)
    }
    node.addEventListener('wheel', handleWheel, { passive: false })
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      node.removeEventListener('wheel', handleWheel)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [])

  const placed = model.units.map((mapUnit) => {
    const base = basePosition(mapUnit.x, mapUnit.y, width, height)
    const screen = screenPosition(base, view)
    return { item: mapUnit, x: screen.x, y: screen.y }
  })
  const clusters = clusterByProximity(placed)

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
    setOpenKey(null)
    setView(IDENTITY_VIEW)
  }

  const zoomBy = (factor: number) => {
    setOpenKey(null)
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

      <div className="card-lodge grid grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_280px]">
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
              className="border-border text-muted-foreground hover:text-foreground hover:border-primary/50 rounded-lg border p-1.5 transition-colors"
              aria-label="Fit the whole map"
            >
              <Maximize2 className="h-4 w-4" />
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
            </label>
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
              setOpenKey(null)
            }}
            // Deliberately UNCONDITIONAL, even mid-gesture. Refusing a new
            // pointerdown while a drag is live would strand the map forever if
            // an up event were ever lost; replacing the record every time is
            // what makes a dropped gesture self-heal on the next press.
            onPointerDown={(event) => {
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
                setOpenKey(null)
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
              return (
                <div
                  key={key}
                  data-testid="map-mark"
                  title={
                    many
                      ? `${String(cluster.members.length)} rooms · ${String(occupied)} occupied`
                      : first.unit.name
                  }
                  onClick={(event) => {
                    event.stopPropagation()
                    setOpenKey((current) => (current === key ? null : key))
                  }}
                  style={{ left: cluster.x, top: cluster.y }}
                  className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer"
                >
                  <span
                    style={{
                      backgroundColor: many || first.parties.length > 0 ? hue : 'white',
                      borderColor: hue,
                      boxShadow: shared
                        ? `0 0 0 2px #fff, 0 0 0 4.5px ${hue}`
                        : '0 0 0 2px rgba(255,255,255,.95)',
                      width: many ? Math.min(17 + cluster.members.length * 2.6, 38) : 16,
                      height: many ? Math.min(17 + cluster.members.length * 2.6, 38) : 16,
                      borderRadius: allStaff ? 4 : '50%',
                      borderStyle: anyStaff ? 'dashed' : 'solid',
                    }}
                    className="grid place-items-center border-2 text-xs font-bold text-white"
                  >
                    {many ? cluster.members.length : ''}
                  </span>
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
          </div>
        </div>

        {/* EMBEDDED, not an overlay. FamilyDetailsPanel's own docstring: "The map
            opens this same panel embedded; a second implementation is exactly what
            `embedded` exists to prevent." In embedded mode it installs no Escape
            handler and has no slide-out, so there is no `requestClose` and no
            click-outside predicate here — it stays until dismissed, which is what
            you want while comparing two families across the site.
            `key` is load-bearing: without it React reuses the instance across
            selections and `useState` initialisers never re-run. */}
        <aside className="bg-muted/30 border-border/60 flex flex-col gap-3 border-t p-3 lg:border-t-0 lg:border-l">
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
      </div>
    </div>
  )
}
