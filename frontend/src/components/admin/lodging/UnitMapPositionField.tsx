/**
 * Put this unit's pin where the cabin actually is.
 *
 * SINCE kindred#2440 THIS POSITIONS A BUILDING, not necessarily one room. The
 * map is a view of buildings: a room draws at its container's point and its
 * own coordinate is never read, so `LodgingUnitForm` offers this editor to
 * whichever unit is the pin SITE — a container, or a room with no parent — and
 * shows an inheriting room where its pin lives instead. Dragging here moves
 * every room under the building at once, which is the whole point of the
 * ruling: one thing to maintain per building rather than up to fourteen.
 *
 * `/manage/lodging` used to expose the position as two number inputs; PR #2024
 * deleted them and nothing replaced them, so correcting a coordinate meant
 * editing the database. Typing `0.4389` was never how a pin gets placed
 * anyway — dragging it onto the cabin is (kindred#2013).
 *
 * SAVES ON POINTER-UP, and that is a ruling rather than a shortcut. It is the
 * same save-on-interaction shape `LodgingAreasDrawer`'s centroid inputs use
 * (`saveCentroid`, save-on-blur): a direct manipulation that then asked for a
 * second, separate commit would be two commits for one intention. This is
 * therefore NOT part of the form's payload — `LodgingUnitForm` still omits
 * `map_x`/`map_y` from every submit, which is what keeps its (0,0) guarantee
 * intact (see that file's header, point 2).
 *
 * AND IT IS GATED. The objection to saving on pointer-up was that an
 * accidental drag persists the instant a finger lifts, and the answer is that
 * accidents cannot start: with `editing` off this canvas carries NO pointer
 * handlers at all, so a pan, a scroll or a touch-drag across it is incapable
 * of moving anything. That is a stronger guarantee than a handler that checks
 * a flag, and it is why the handlers are spread conditionally below rather
 * than written with an early return inside.
 *
 * INSIDE the gate a drag is still one pointer's primary-button gesture, and
 * the handlers say why at each guard: a right-click delivers a pointerup all
 * the same, a second finger must not seize a drag in flight, and a release
 * the canvas never sees must END the gesture rather than leave it armed.
 *
 * THE GATE IS A REAL CHECKBOX, for the reason LodgingMap's accessibility note
 * gives about the empty-rooms toggle: that toggle is the map's last
 * keyboard-reachable control, and a pointer-only control here would repeat the
 * mistake the note exists to warn about. The DRAG itself is pointer-only —
 * honestly so, exactly as the weekend map's pan is — and the accessible
 * equivalent is the units table this editor is opened from.
 *
 * AN UNSET PAIR IS NOT THE ORIGIN. `hasCoordinates` decides whether this unit
 * has a position at all; an unplaced one draws no pin and writes nothing until
 * someone presses on the map. Opening this editor must never be what turns
 * "unpositioned" into "positioned at the top-left".
 */
import { useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'

import { MapBaseLayer } from '../../weekend/MapBaseLayer'
import { hasCoordinates } from '../../weekend/mapModel'
import { IDENTITY_VIEW, MAP_ASPECT } from '../../weekend/mapViewport'
import { updateLodgingUnit } from '../../../services/lodgingCrud'
import type { LodgingUnitRecord } from '../../../types/lodging'
import { SECTION } from './lodgingStyles'

/**
 * Four decimals — one part in 10,000 against a 3300px render, so roughly a
 * third of a pixel. Finer than an area centroid's `step="0.001"` because a
 * cabin is a building and an area is a whole zone, and coarse enough that the
 * stored value stays readable.
 */
const PRECISION = 4

interface Point {
  x: number
  y: number
}

function round(value: number): number {
  return Number(value.toFixed(PRECISION))
}

/** 0-1, and never outside it: a pin dragged past the edge belongs on the edge. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/** The finest step this field can express, and so the smallest nudge that is
 *  still a different coordinate. */
const EPSILON = 10 ** -PRECISION

/**
 * (0,0) IS THE SENTINEL for "never placed" — it is what `hasCoordinates` reads
 * as no position at all — so it is the one pair a placement may never write.
 * A drag off the TOP-LEFT corner clamps to exactly it, and storing that would
 * UNPLACE the unit through the very gesture meant to place it: the pin would
 * be gone the next time this editor opened.
 *
 * Only the exact corner is special-cased. Every other edge is a real
 * coordinate and goes on clamping to the edge, and a ten-thousandth of the map
 * is a third of a pixel at full render — the pin does not visibly move.
 */
function offOrigin(point: Point): Point {
  if (point.x === 0 && point.y === 0) return { x: EPSILON, y: EPSILON }
  return point
}

/** The pin is placed as a PERCENTAGE of an aspect-locked box, so it needs no
 *  measurement and cannot drift out of register with the backdrop. */
function percent(value: number): string {
  return `${(value * 100).toFixed(PRECISION)}%`
}

export interface UnitMapPositionFieldProps {
  /** Edit only. A unit being created has no id to write a coordinate to. */
  unit: LodgingUnitRecord
  /**
   * A coordinate landed. The host invalidates the lodging registry queries
   * with this — the write bypasses the form's own save, so nothing else would
   * tell the cached registry the map moved.
   */
  onPositionSaved?: (() => void) | undefined
}

export function UnitMapPositionField({ unit, onPositionSaved }: UnitMapPositionFieldProps) {
  const [editing, setEditing] = useState(false)
  // The last position the SERVER accepted, and the only thing a failed write
  // has to fall back to. Seeded once, like every other initialiser in this
  // form — `LodgingUnitsPanel` keys the form on the record, so switching to
  // another unit remounts rather than reusing this instance.
  const [saved, setSaved] = useState<Point | null>(
    hasCoordinates(unit) ? { x: unit.map_x, y: unit.map_y } : null
  )
  // What the pointer is currently proposing. Null between gestures, so the pin
  // renders from `saved` at rest and there is no second copy to keep in step.
  const [draft, setDraft] = useState<Point | null>(null)
  // THE POINTER THAT OWNS THE GESTURE, not a bare boolean. A drag belongs to
  // one pointer: a second finger landing mid-drag, or the stray pointerup of a
  // pointer that never pressed here, must not be able to move or commit it.
  const draggingRef = useRef<number | null>(null)
  /** Which write is the current one; see `commit`. */
  const writeSeq = useRef(0)
  const canvasRef = useRef<HTMLDivElement>(null)

  // Measured for the SAME reason LodgingMap measures: the backdrop is laid out
  // in real pixels because it is transform-scaled. The pin is not — it sits at
  // a percentage of an aspect-locked box, which needs no measurement and
  // cannot drift out of register with the image.
  const [size, setSize] = useState({ width: 0, height: 0 })
  useEffect(() => {
    const node = canvasRef.current
    if (!node) return
    const measure = () => {
      setSize({ width: node.clientWidth, height: node.clientHeight })
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => {
      observer.disconnect()
    }
  }, [])
  // jsdom performs no layout, so clientWidth is 0 there — the same fallback
  // LodgingMap uses, for the same reason.
  const width = size.width > 0 ? size.width : 1000
  const height = size.height > 0 ? size.height : 1000 / MAP_ASPECT

  const position = draft ?? saved

  /** Where in 0-1 map space did this pointer land? */
  const pointAt = (event: React.PointerEvent<HTMLDivElement>): Point | null => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: clamp01((event.clientX - rect.left) / rect.width),
      y: clamp01((event.clientY - rect.top) / rect.height),
    }
  }

  /** The gesture is over and nothing is being written: forget the draft, or
   *  the pin sits at a position no one ever saved. */
  const abandon = () => {
    draggingRef.current = null
    setDraft(null)
  }

  const commit = async (point: Point) => {
    const next = offOrigin({ x: round(point.x), y: round(point.y) })
    // Mirrors saveCentroid's `if (value === area[axis]) return` — a press that
    // put the pin back where it already was is not an edit.
    // (`saved?.x` then a bare `saved.y`: the first comparison narrows `saved`
    // to non-null, so the second chain would be flagged as unnecessary.)
    if (saved?.x === next.x && saved.y === next.y) {
      setDraft(null)
      return
    }
    // THE LAST DROP WINS, not the last response. Two drags inside one
    // round-trip are easy to make and the requests can answer out of order; an
    // older one landing late would otherwise drag the pin back to where it is
    // no longer, and its `finally` would blank a drop still waiting.
    const seq = ++writeSeq.current
    try {
      await updateLodgingUnit(unit.id, { map_x: next.x, map_y: next.y })
      if (seq !== writeSeq.current) return
      setSaved(next)
      onPositionSaved?.()
    } catch (error) {
      // The stored position goes back, for the reason `saveField` puts a
      // refused value back in the areas drawer: a pin left where the server
      // refused to put it is indistinguishable from a saved one.
      toast.error(error instanceof Error ? error.message : 'Failed to save the map position')
    } finally {
      if (seq === writeSeq.current) setDraft(null)
    }
  }

  const dragHandlers = {
    onPointerDown: (event: React.PointerEvent<HTMLDivElement>) => {
      // A placement is a PRIMARY-button press. A right-click opens the context
      // menu and still delivers its pointerup here, so without this guard it
      // would write a coordinate wherever the menu was opened.
      if (event.button !== 0) return
      // One gesture at a time: the second finger of a pinch must not seize a
      // drag the first is in the middle of.
      if (draggingRef.current !== null) return
      const point = pointAt(event)
      if (!point) return
      draggingRef.current = event.pointerId
      // KEEP THE GESTURE OURS once the pointer leaves the canvas. Without
      // capture, a drag released outside is delivered to whatever is under the
      // cursor instead, this handler's pointerup never runs, and the field is
      // left armed — a later mouse-over then drags the pin and the next click
      // writes it. jsdom implements no pointer capture, hence the try.
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {
        // Unsupported, or the pointer is already gone. Neither is a reason to
        // refuse the drag; the `buttons` check below is the fallback.
      }
      setDraft(point)
    },
    onPointerMove: (event: React.PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current !== event.pointerId) return
      // No button is down, so the release happened somewhere we never saw it
      // and this is a plain hover. Ending the gesture here is what stops the
      // pin from following an unpressed cursor if capture was unavailable.
      if (event.buttons === 0) {
        abandon()
        return
      }
      const point = pointAt(event)
      if (point) setDraft(point)
    },
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current !== event.pointerId) return
      draggingRef.current = null
      const point = pointAt(event) ?? draft
      if (point) void commit(point)
    },
    // The browser took the gesture away. Nothing is committed, and the draft
    // has to go or the pin stays where a cancelled drag left it.
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => {
      if (draggingRef.current !== event.pointerId) return
      abandon()
    },
  }

  // A FRAGMENT, not a wrapper: every section of this form renders as one so
  // its heading is a direct child of the form grid and `SECTION`'s `first:`
  // rules resolve against the real first section (see ./lodgingStyles).
  return (
    <>
      <h3 className={SECTION}>Map position</h3>
      <div className="sm:col-span-2">
        <div
          ref={canvasRef}
          data-testid="unit-map-canvas"
          data-editing={editing ? 'true' : 'false'}
          style={{ aspectRatio: `${String(MAP_ASPECT)}` }}
          className={`bg-muted/40 relative w-full overflow-hidden rounded-xl select-none ${
            editing
              ? 'ring-primary cursor-crosshair touch-none ring-2'
              : 'border-border cursor-default border'
          }`}
          {...(editing ? dragHandlers : {})}
        >
          <MapBaseLayer view={IDENTITY_VIEW} width={width} height={height} />
          {position && (
            <span
              data-testid="unit-map-pin"
              style={{ left: percent(position.x), top: percent(position.y) }}
              className={`bg-primary absolute z-10 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow ${
                editing ? 'cursor-grab' : ''
              }`}
            />
          )}
          {!position && (
            <p className="text-muted-foreground bg-card/90 border-border absolute top-3 left-3 rounded-md border px-2 py-1 text-xs">
              No position yet — switch on Edit position and press where this unit sits.
            </p>
          )}
        </div>

        {/* The map's own control row, in the admin surface's grammar. The
            checkbox is the precedent LodgingMap's empty-rooms toggle sets: a
            real <input> inside a real <label>, never re-invented as a div. */}
        <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input
              type="checkbox"
              checked={editing}
              onChange={(event) => {
                setEditing(event.target.checked)
                // A draft belongs to a gesture, and switching the gate off
                // ends any gesture in flight without committing it.
                if (!event.target.checked) abandon()
              }}
            />
            Edit position
          </label>
          {editing && (
            <span className="text-primary font-semibold">
              Editing — drag the pin, or press where the unit sits. Saves straight away.
            </span>
          )}
          <span className="ml-auto tabular-nums">
            {position
              ? `x ${position.x.toFixed(PRECISION)} · y ${position.y.toFixed(PRECISION)}`
              : 'not placed'}
          </span>
        </div>
      </div>
    </>
  )
}
