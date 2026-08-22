/**
 * The weekend lodging board (spec §10, "C1"; drag placement is "C2").
 *
 * WHICH plan it is showing is the header's to say, not this component's — the
 * page's `ModeBadge` carries CM-vs-Draft exactly as summer's `SessionHeader`
 * does, and summer's board carries no chip of its own. This one used to, which
 * is how it came to assert the mirror over a draft once #1967 shipped a picker:
 * two indicators, only one of them wired up.
 *
 * The board reads nothing and writes three times. The page fetches; this
 * component owns three mutations, and they are gated differently on purpose —
 * drag placement (#1985) needs a scenario because it writes a draft plan;
 * availability (#1999) needs none because a burst pipe closes a cabin in
 * every plan for that weekend; and a merge/split (migration 1500000140) needs none for a
 * different reason than availability does — a draw level is simply never
 * CampMinder-sourced, so there is no mirror truth for the write to clobber.
 * `canPlace`, `canSetAvailability` and `canMergeUnits` below are that
 * difference, and collapsing any pair of them is the mistake to avoid.
 *
 * Layout is §3.7: one collapsible section per area, each a WRAPPING GRID of
 * slot cards. Not summer's columns — a summer bunk column is tall because it
 * holds 10–14 campers, and 82 rooms cannot be 82 columns. Unplaced families
 * sit in the same floating corner queue summer uses for unassigned campers
 * (`FloatingUnplacedBadge`), not a permanent rail.
 *
 * Dragging is C2 and writes through `useLodgingPlacement`. It is live only
 * inside a scenario, for a user holding `bunking.manage` — with no scenario
 * this stays exactly as read-only as it always was, which is what summer's
 * `isProductionMode` does.
 */
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { ChevronDown, ChevronRight, Info, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { useDismissOnDeadSpace } from '../../hooks/useDismissOnDeadSpace'
import { useLodgingPlacement } from '../../hooks/useLodgingPlacement'
import { usePanelParty } from '../../hooks/usePanelParty'
import { useUnitAvailability } from '../../hooks/useUnitAvailability'
import { useUnitMerge } from '../../hooks/useUnitMerge'
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { areaTokens, buildBoard } from './boardLayout'
import { indexUnitsByCode } from './unitLevel'
import { createBoardCollisionDetection } from './boardCollision'
import {
  mergeDragUnit,
  resolveDrop,
  resolveMergeDrop,
  resolvePickerPlacement,
} from './dragPlacement'
import { FamilyCard, FamilyCardPreview } from './FamilyCard'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { FloatingUnplacedBadge } from './FloatingUnplacedBadge'
import { LodgingUnitCard } from './LodgingUnitCard'
import { partyKey } from './partyKey'
import { resolvePartyUnit } from './rosterAttention'
import type { UnitAvailabilityWrite } from './writeIn'
import { writeInEntries } from './writeIn'

export interface LodgingBoardProps {
  parties: RosterPartyRow[]
  units: LodgingUnitRow[]
  year: number
  /**
   * `''` is the CampMinder mirror; a scenario id is a draft.
   *
   * This is now a WRITE GATE, not a display input: #1991 moved the mode chip
   * up to the header badge, so nothing here renders the scenario — it only
   * decides whether anything may be dragged.
   *
   * OPTIONAL, defaulting to the mirror, which is the safe reading: a caller
   * that forgets it gets a read-only board rather than a silent write path.
   * Required would put tsc behind it, but the only real caller is
   * `WeekendRosterPage` — the rest are tests, and making thirty of them pass a
   * prop they do not exercise is churn.
   */
  scenario?: string
  /** The weekend being written into. Optional for the same reason `scenario` is. */
  sessionCmId?: number
  /** `bunking.manage` — what every lodging write rule gates on. */
  canManage?: boolean
}

/**
 * Where the collapsed areas live in the URL, one entry per area:
 * `?closed=GT&closed=HC`.
 *
 * REPEATED rather than a comma list, which was the first shape tried.
 * `URLSearchParams` percent-encodes a comma, so `?closed=GT,HC` reaches the
 * address bar as `?closed=GT%2CHC` — and a link somebody can actually read is
 * most of the point of moving this out of `useState`.
 */
const CLOSED_PARAM = 'closed'

/*
 * MODULE SCOPE, and that placement is load-bearing rather than tidiness.
 *
 * `useSensor` memoises on `[sensor, options]` and `useSensors` on the sensor
 * array (@dnd-kit/core 6.3.1). An options object written inline is a new
 * identity on every board render, so the memo misses, `activators` is rebuilt,
 * and `useSyntheticListeners` hands EVERY draggable on the board a fresh
 * `listeners` object. That is a prop change on every family card and every
 * card's merge handle, which defeats their `memo` wholesale — measured at
 * pick-up: 133 of 133 family-card bodies re-rendered for no reason.
 */
const MOUSE_ACTIVATION = { activationConstraint: { distance: 10 } }

/*
 * dnd-kit's auto-scroller defaults to a scrollBy every 5ms — 200 scroll
 * events/second, each one re-entering DndContext's scroll listeners while the
 * browser is also painting a ~5,500px board (the real 2026 boards are five
 * viewports tall, so every cross-area placement rides the auto-scroller).
 * Tripling the tick and the per-tick step keeps the same ~2,000px/s velocity
 * at a third of the event rate.
 *
 * Measured on the production build, real Family Camp 2 data: dropped frames
 * per 1,000px auto-scrolled went 3.4 → ~1.9, and script-per-pixel fell ~10%.
 * A modest win, not a dramatic one — the remaining cost of the auto-scroll
 * leg is the browser painting the board, not script.
 */
const AUTO_SCROLL = { interval: 15, acceleration: 30 }
const TOUCH_ACTIVATION = { activationConstraint: { delay: 100, tolerance: 5 } }

export function LodgingBoard({
  parties,
  units,
  year,
  scenario = '',
  sessionCmId = 0,
  canManage = false,
}: LodgingBoardProps) {
  // Memoised for the sake of `tokens` below, which depends on `board.areas`:
  // rebuilt every render, that array is a fresh identity each time and the
  // dependency never matches, so the memo reads as though it caches while
  // re-running `areaTokens` on every keystroke elsewhere in the tree.
  const board = useMemo(() => buildBoard(parties, units), [parties, units])
  const [searchParams, setSearchParams] = useSearchParams()
  /*
   * Which areas are collapsed, read from the query string rather than held in
   * `useState` (CLAUDE.md §4: state worth arranging is worth being able to
   * return to). Collapsing seven of eight areas IS the filter this board was
   * said to lack — and held in component state it evaporated on every reload,
   * so it was never worth arranging in the first place.
   *
   * A query PARAM, not a path segment. The view is already a segment
   * (`/weekend/:ref/:view`) because it selects what you are looking at; this
   * modifies how that view is arranged, which is what a query string is for.
   */
  // Derived from the whole set, because a two-character token is not always
  // unique — see `areaTokens`.
  const tokens = useMemo(() => areaTokens(board.areas), [board.areas])
  const collapsed = useMemo<ReadonlySet<string>>(
    () => new Set(searchParams.getAll(CLOSED_PARAM)),
    [searchParams]
  )
  const { panelParty, requestClose, openParty, closePanel, requestPanelClose } =
    usePanelParty(parties)
  const [dragging, setDragging] = useState<RosterPartyRow | null>(null)
  /** The card currently being dragged BY ITS MERGE HANDLE, for grey-out. */
  const [draggingMergeUnit, setDraggingMergeUnit] = useState<LodgingUnitRow | null>(null)

  // THREE conditions, not two. `sessionCmId` is in there because every write
  // names a weekend, and the prop defaults to 0 for the thirty tests that do
  // not exercise placement — a board that let a drop through without one would
  // send `session_cm_id: 0` against a schema declaring `gt=0`.
  const canPlace = canManage && scenario !== '' && sessionCmId > 0

  // TWO conditions, not three, and the missing one is deliberate — even though
  // this write now CARRIES a scenario (kindred#2382 PR 4). Carrying one and
  // requiring one are different rules: blank is the LIVE board, a scope in its
  // own right, so reusing `canPlace` here would leave staff looking at the
  // CampMinder mirror — which is where most of them look — unable to record a
  // write-in at all. Do not "fix" this to `canPlace` now that the scenario
  // travels.
  const canSetAvailability = canManage && sessionCmId > 0

  // Same two conditions as `canSetAvailability` above, not `canPlace` — and
  // for a related but distinct reason. Placement is read-only on the mirror
  // because the mirror IS CampMinder's truth and a sync would overwrite a
  // draft write. A draw level has no such truth to protect: no sync ever
  // writes `lodging_slot_merges`, so there is nothing on the mirror for a
  // merge to clobber (migration 1500000140 made this a weekend-level fact for exactly
  // that reason — `scenario: ''` is now a legitimate write, not a refusal).
  // Gating this on `canPlace` would reintroduce the scenario dimension this
  // hook does not need, the same mistake `canSetAvailability` already exists
  // to avoid. Do not "fix" this back to `canPlace`.
  const canMergeUnits = canManage && sessionCmId > 0

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

  const { move } = useLodgingPlacement({ year, sessionCmId, scenario })
  // The same `scenario` the placement and merge hooks get, and for the reason
  // `canSetAvailability` above spells out: it TARGETS the write rather than
  // gating it. An occupancy lands on this board (blank being the live one); a
  // release ignores it server-side, being a fact about the weekend.
  const { setAvailability, pendingUnitId } = useUnitAvailability({ year, sessionCmId, scenario })
  // `scenario` here is the same prop `useLodgingPlacement` gets — on the
  // mirror that is `''`, and the hook now sends it rather than refusing, per
  // `canMergeUnits` above.
  const { setCombined, pendingUnitId: pendingMergeUnitId } = useUnitMerge({
    year,
    sessionCmId,
    scenario,
  })

  // The shared WeakMap-cached index (`unitLevel`), not a local `useMemo` copy
  // of the same map — one instance per `units` array, everywhere. `mergeUnit`
  // closes over it and lists it as a `useCallback` dep, and the cache is what
  // keeps that identity stable across renders (at least as stable as the
  // `useMemo` this replaced).
  const unitsByCode = indexUnitsByCode(units)

  const sensors = useSensors(
    // The same activation constraints summer uses. The distance threshold is
    // what keeps a card that is also a button clickable: a plain click never
    // travels 10px, so it opens the details panel instead of starting a drag.
    useSensor(MouseSensor, MOUSE_ACTIVATION),
    useSensor(TouchSensor, TOUCH_ACTIVATION)
  )

  // Pointer-within first, falling back to rect intersection — summer's, and
  // for the same reason: without it a drop released over dead space snaps to
  // whichever cabin happens to be nearest, placing a family somewhere nobody
  // chose. The policy itself, and why it HOLDS the last cabin across a gutter,
  // lives in `boardCollision.ts`.
  //
  // A REF, not `useMemo`, because the detector is STATEFUL — the held cabin
  // is the state. `useMemo` is documented as a cache React may discard, and a
  // discard mid-gesture would silently lose the hold and put the flapping
  // back with nothing to notice it. A ref is the primitive that actually
  // promises one instance for the component's lifetime.
  const collisionDetectionRef = useRef<ReturnType<typeof createBoardCollisionDetection> | null>(
    null
  )
  collisionDetectionRef.current ??= createBoardCollisionDetection()
  const collisionDetection = collisionDetectionRef.current

  const handleDragStart = (event: DragStartEvent) => {
    // One gesture must never inherit the previous gesture's held cabin.
    collisionDetection.reset()
    const activeId = String(event.active.id)
    const mergeUnit = mergeDragUnit(activeId, units)
    if (mergeUnit !== null) {
      setDraggingMergeUnit(mergeUnit)
      setDragging(null)
      return
    }
    setDraggingMergeUnit(null)
    const active = parties.find((party) => partyKey(party) === activeId)
    setDragging(active ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    collisionDetection.reset()
    setDragging(null)
    setDraggingMergeUnit(null)

    const activeId = String(event.active.id)
    const overId = event.over === null ? null : String(event.over.id)

    // Tried FIRST and unconditionally, regardless of either gate below. A
    // card's drag id can never match a party's `partyKey`, so `resolveDrop`
    // below is naturally silent about a card drag whether or not this branch
    // fires — the two resolvers can never disagree about which gesture just
    // ended.
    const merge = resolveMergeDrop({ activeId, overId, units })
    if (merge !== null) {
      // Gated on `canMergeUnits`, NOT `canPlace` — see that constant's
      // comment. This mirrors the mirror-write disabled-affordance belt to
      // the handle's own `useDraggable({ disabled: !canMerge })` braces,
      // exactly as `canPlace` is re-checked below for a party card.
      if (!canMergeUnits) return
      const parentUnit = unitsByCode.get(merge.parentCode)
      // Never invent a unit. Unreachable in practice — `resolveMergeDrop`
      // only names a `parentCode` it read off a unit IN this same payload —
      // but a lookup that fails silently is safer than one that writes an
      // empty id.
      if (parentUnit !== undefined) {
        void setCombined(parentUnit.unit_id, parentUnit.name, merge.combined).catch(() => undefined)
      }
      return
    }

    if (!canPlace) return

    const intent = resolveDrop({ activeId, overId, parties, units })
    if (intent === null) return

    // The rejection path is the hook's: it rolls the optimistic move back and
    // raises the toast. Catching here keeps the rejected promise from
    // surfacing as an unhandled rejection.
    void move(intent).catch(() => undefined)
  }

  // dnd-kit fires `onDragCancel`, NEVER `onDragEnd`, on Escape, a window
  // resize, or a tab visibility change mid-drag. `handleDragEnd` is the only
  // place that resets `dragging`/`draggingMergeUnit` above, so without this
  // handler a cancelled CARD drag leaves `draggingMergeUnit` latched: every
  // party droppable stays disabled board-wide (`LodgingUnitCard`'s
  // `mergeDragActive` gate) and every non-sibling card sits dimmed and
  // unclickable (`pointer-events-none`) until staff happen to start another
  // drag. The same resets `handleDragEnd` opens with — the collision hold and
  // both drag states — see
  // `useLockGroupDragDrop.tsx`'s `handleDragCancel` for the same shape on
  // summer's own drag gesture.
  const handleDragCancel = () => {
    collisionDetection.reset()
    setDragging(null)
    setDraggingMergeUnit(null)
  }

  const splitUnit = useCallback(
    (unit: LodgingUnitRow) => {
      void setCombined(unit.unit_id, unit.name, false).catch(() => undefined)
    },
    [setCombined]
  )

  // The ACTIVATION path for the merge the drag gesture makes, so the handle
  // works for a keyboard — the board's sensors are Mouse and Touch only, and
  // widening them would change party placement too. Resolves to the same
  // parent `resolveMergeDrop` would have named: merging is promotion to the
  // parent, and either sibling as a drop target yields `source.parent_code`.
  //
  // Same never-invent-a-unit guard as the drop path: a parent code the
  // payload has no row for writes nothing rather than an empty id.
  const mergeUnit = useCallback(
    (unit: LodgingUnitRow) => {
      const parentUnit = unitsByCode.get(unit.parent_code ?? '')
      if (parentUnit === undefined) return
      void setCombined(parentUnit.unit_id, parentUnit.name, true).catch(() => undefined)
    },
    [setCombined, unitsByCode]
  )

  /*
   * kindred#2080 — the unit card's picker, resolved through the DROP path.
   *
   * `resolvePickerPlacement` IS `resolveDrop`, so this branch inherits every
   * refusal the drag has (a non-combined container, a party carrying neither
   * CampMinder id, a party already alone in the room) rather than restating
   * any of them, and produces the same `PlacementIntent` for the same `move`.
   * One placement path with two affordances, not two paths.
   *
   * That inheritance cuts both ways, which is what kindred#2432 proved: this
   * list said "a held space" first until the written-into refusal was struck
   * in `resolveDrop`, and this branch gave it up in the same change with
   * nothing here to edit. A copy of the list is not a second gate — but a
   * STALE copy of it is the next reader's evidence for restoring one, so keep
   * the two in step.
   *
   * `canPlace` is re-checked here for the same reason `handleDragEnd`
   * re-checks it: the card's own gate is the affordance half, and a write
   * gate that lives only in an affordance is one prop away from being
   * bypassed.
   *
   * Returns nothing. It used to report whether the placement landed, purely
   * so `LodgingUnitCard` could gate an `sr-only` announcement on it
   * (kindred#2219 round 6); kindred#2348 deleted that announcement and the
   * boolean lost its only reader, so it went with it rather than staying as
   * a contract nothing checks. A refused intent (stale picker row) and a
   * rejected mutation are still both handled here, they are simply no longer
   * distinguishable to the caller — which is the truth, since the caller has
   * nothing left to do differently in either case.
   */
  const placeParty = useCallback(
    (unit: LodgingUnitRow, party: RosterPartyRow): void => {
      if (!canPlace) return
      const intent = resolvePickerPlacement({ party, unitCode: unit.code, parties, units })
      if (intent === null) return
      // The rejection path is the hook's — it rolls the optimistic move back
      // and raises the toast. Caught here only so it does not surface as an
      // unhandled rejection, exactly as the drop handler does.
      void move(intent).catch(() => undefined)
    },
    [canPlace, move, parties, units]
  )

  const writeAvailability = useCallback(
    (write: UnitAvailabilityWrite) => {
      // The rejection path is the hook's: it raises the toast. Catching here
      // keeps the rejected promise from surfacing as an unhandled rejection,
      // exactly as the drop handler does.
      void setAvailability({
        // FROM THE WRITE, not from the card. An inherited write-in is cleared
        // at the unit that holds the row, which may be this card's building or
        // one of its rooms — and that unit has no card of its own, which is
        // precisely why the clear is offered here. `availabilityAction`
        // resolves the target; passing `unit` again would delete nothing.
        unitId: write.unitId,
        unitName: write.unitName,
        familyAvailable: write.familyAvailable,
        occupantName: write.occupantName,
        reason: write.reason,
        // Straight through (kindred#2503) — `UnitAvailabilityWrite` and
        // `AvailabilityIntent` carry the same three answers this fact can be
        // (a typed count, a preserved one, or `null`), and this glue is not
        // the place to collapse them.
        partySize: write.partySize,
      }).catch(() => undefined)
    },
    [setAvailability]
  )

  // `openParty`/`closePanel`/`panelParty` come from `usePanelParty` above —
  // shared with `LodgingMap` and `HouseholdRosterTable` (kindred#2139). See
  // its own docstring for the derivation and why it stores `selectedKey`
  // rather than the party object.

  // Same dead-space dismissal the summer board uses, through the same hook.
  useDismissOnDeadSpace(panelParty !== null, requestPanelClose)

  const toggleArea = (token: string) => {
    setSearchParams(
      (previous) => {
        // Built FROM the existing params, never from scratch: the board does
        // not own the query string, and rebuilding it would silently drop
        // whatever else a caller had put there.
        const next = new URLSearchParams(previous)
        const closed = new Set(next.getAll(CLOSED_PARAM))
        if (closed.has(token)) closed.delete(token)
        else closed.add(token)
        // Cleared and rewritten, because `set` would collapse the repeated
        // entries down to one. Sorted, so the same set of collapsed areas
        // always produces the same URL whatever order they were clicked in —
        // two people comparing links should not see a difference that is not
        // there. An empty set drops the parameter rather than leaving
        // `?closed=` hanging, which reads as though something is still hidden.
        next.delete(CLOSED_PARAM)
        for (const area of [...closed].sort()) next.append(CLOSED_PARAM, area)
        return next
      },
      // REPLACE, as the tab strip does. Pushing would turn Back into
      // "un-collapse one area", seven times, before it leaves the page.
      { replace: true }
    )
  }

  return (
    <DndContext
      autoScroll={AUTO_SCROLL}
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className="flex flex-col gap-3">
        {/* The mode chip that used to lead this row moved to the header badge,
            where summer keeps it. The row itself is now conditional: left
            unconditional it renders empty and still spends the parent's gap. */}
        {board.flaggedCount > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" />
              {board.flaggedCount === 1
                ? '1 shared cabin needs a look'
                : `${String(board.flaggedCount)} shared cabins need a look`}
            </span>
          </div>
        )}

        {/* The rule behind the amber, stated where the amber is.

            HANDOFF §4 deferred two consent questions to this PR: does a NAMED
            partner satisfy "mutual", and does a blank share gate count as
            consent? The code had already answered both — `named` does not
            flag, silence does — and this is the half that was missing. Once
            staff can create a shared cabin by dragging, a flag whose rule is
            invisible is one they have to infer from behaviour, and inferring
            it wrongly in the permissive direction is the failure this whole
            surface exists to prevent.

            Rendered only alongside a flag, so it is an explanation rather
            than a lecture on a clean board. */}
        {board.flaggedCount > 0 && (
          <p data-testid="consent-rule" className="text-muted-foreground text-xs">
            A shared cabin is flagged when someone in it did not request sharing, hasn&rsquo;t
            answered the cabin form, or gave two answers that disagree. A named partner is{' '}
            <strong className="font-semibold">not checked for mutual agreement</strong> — open the
            family to see who they asked for.
          </p>
        )}

        <div className="card-lodge overflow-hidden">
          <div className="flex flex-col gap-5 p-3">
            {board.areas.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No lodging units in the registry yet. Add them in Manage → Family Camp Lodging.
              </p>
            ) : (
              board.areas.map((area) => {
                const token = tokens.get(area.key) ?? area.key
                const isCollapsed = collapsed.has(token)
                return (
                  <section key={area.key}>
                    <h3 className="mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          toggleArea(token)
                        }}
                        aria-expanded={!isCollapsed}
                        className="group flex w-full items-center gap-2 text-left"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
                        )}
                        {/* Area colour is a SECONDARY channel (§3.10), and this dot
                          is now its ONLY carrier on the board — the card's top
                          edge lost it on 2026-08-21, taking 73 always-on marks
                          down to 8. The heading below does the actual
                          grouping, so nothing depends on telling violet from
                          rose, which is exactly why the card could give it up.
                          The map still draws the hue per unit: it has no
                          section headers, so position is its only other
                          grouping and the pills genuinely need a key. */}
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: area.hue }}
                          aria-hidden="true"
                        />
                        <span className="text-muted-foreground group-hover:text-foreground text-[11px] font-bold tracking-wider uppercase transition-colors">
                          {area.name}
                        </span>
                        <span className="text-muted-foreground/70 text-[11px] tabular-nums">
                          {/* Buildings alongside rooms and families (#2009):
                              how many DISTINCT buildings this area's drawn
                              rooms belong to, at the immediate-parent grain
                              #2008 ruled — a two-half house counts as two,
                              not one. Reads `area.buildingCount`
                              (`buildBoard`), never re-derived here. */}
                          {`${String(area.slots.length)} rooms · ${String(area.partyCount)} families · ${String(area.buildingCount)} buildings`}
                        </span>
                        <span className="bg-border/70 ml-1 h-px flex-1" aria-hidden="true" />
                      </button>
                    </h3>

                    {!isCollapsed && (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                        {area.slots.map((slot) => (
                          <LodgingUnitCard
                            key={slot.unit.unit_id}
                            slot={slot}
                            // The registry, so the card's per-party sharing
                            // chip expands a container code to its rooms —
                            // the same `overlappingPartyKeys` the slot flag
                            // already ran with these units in `buildBoard`.
                            units={units}
                            canPlace={canPlace}
                            canSetAvailability={canSetAvailability}
                            // THIS card's unit, or ANY of the ones holding a
                            // write-in it covers. `pendingUnitId` names the
                            // unit the WRITE targets, and a write-in removal
                            // targets the row's own unit, which for an
                            // inherited row is never this card's id — so
                            // keying the disable on the card alone leaves the
                            // corner X live for the whole write. `some`, not
                            // one id, since kindred#2381: a merged container
                            // covers every write-in beneath it and the pending
                            // write belongs to whichever one was clicked. Same
                            // shape as `savingMerge` below, and for the same
                            // reason: the unit written is not always the unit
                            // drawn.
                            savingAvailability={
                              pendingUnitId === slot.unit.unit_id ||
                              (pendingUnitId !== '' &&
                                writeInEntries(slot.unit).some(
                                  (entry) => entry.source.unitId === pendingUnitId
                                ))
                            }
                            onSetAvailability={writeAvailability}
                            canMerge={canMergeUnits}
                            mergeSourceUnit={draggingMergeUnit}
                            // The FAMILY in flight (#1912), broadcast to
                            // every card exactly as `mergeSourceUnit` above
                            // is: fit is a question about a pair, and the
                            // card only ever saw the space half of it. Each
                            // one resolves its own verdict from this, against
                            // the server's leaf-resolved coverage.
                            //
                            // `dragging` and `draggingMergeUnit` are mutually
                            // exclusive by construction (`handleDragStart`
                            // clears one when it sets the other), so the
                            // advisory misfit hatch and the invalid-merge dim
                            // can never be raised by the same gesture.
                            draggingParty={dragging}
                            onSplit={splitUnit}
                            onMerge={mergeUnit}
                            // THIS card, or its PARENT. A merge names the
                            // parent container, which has no card while the
                            // tree is split — so keying this on the card's
                            // own id alone leaves both room handles live for
                            // the whole write and the affordance never fires
                            // on the merge path at all. It works for Split
                            // unaided only because a combined card IS the
                            // unit written. Deliberately not board-wide:
                            // merging a second house while the first saves
                            // must stay possible.
                            savingMerge={
                              pendingMergeUnitId !== null &&
                              (pendingMergeUnitId === slot.unit.unit_id ||
                                pendingMergeUnitId ===
                                  unitsByCode.get(slot.unit.parent_code ?? '')?.unit_id)
                            }
                            // kindred#2080. The board's unplaced queue,
                            // whole and unfiltered — the picker annotates and
                            // orders it per card rather than hiding rows, on
                            // the owner's ruling. `board.unplaced` is the
                            // same list `FloatingUnplacedBadge` shows, so the
                            // two can never disagree about who still needs a
                            // cabin.
                            unplacedParties={board.unplaced}
                            onPlaceParty={placeParty}
                            onOpenParty={openParty}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })
            )}

            {/* An assignment can name a container, a unit absent from the
              payload, or a merge whose every room is missing. Those parties ARE
              placed, so the queue would be a lie — and dropping them would make
              the board quietly disagree with the roster.

              A merge whose rooms resolve is NOT here: since #1940 it is drawn
              across each of them. What is left is the genuinely undrawable.

              They are still draggable, and that is the point: dragging one onto
              a room COLLAPSES the placement to that room. That is still not
              merge-by-drag — creating a merge from the board is its own
              decision. */}
            {board.offBoard.length > 0 && (
              <section>
                <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
                  <Info className="h-3.5 w-3.5 flex-shrink-0" />
                  Placed outside the board
                </h3>
                <p className="text-muted-foreground mb-2 text-xs">
                  Assigned to a merged slot or to a room the board does not draw a card for.
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3">
                  {board.offBoard.map((party) => (
                    <FamilyCard
                      key={partyKey(party)}
                      party={party}
                      // ⚠️ PLACED, so the unit has to be resolved and passed —
                      // see the twin of this comment in `LodgingMap`. Without
                      // it the need glyphs kindred#2072 added all read as met,
                      // asserting something about a cabin this section never
                      // resolved. `resolvePartyUnit` is the call the details
                      // panel below already makes, and it is what handles a
                      // merged slot's empty `unit_code`.
                      unit={resolvePartyUnit(party, unitsByCode)}
                      isDraggable={canPlace}
                      onOpen={openParty}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <FloatingUnplacedBadge
          parties={board.unplaced}
          onOpenParty={openParty}
          isPanelOpen={panelParty !== null}
          canPlace={canPlace}
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

        {/* The card follows the pointer out of its slot. Without an overlay the
          only moving thing is dnd-kit's transform on a card sitting inside a
          scrolling grid, which clips it at the section boundary. */}
        <DragOverlay dropAnimation={null}>
          {dragging === null ? null : (
            <div className="w-[200px] opacity-95">
              <FamilyCardPreview party={dragging} />
            </div>
          )}
        </DragOverlay>
      </div>
    </DndContext>
  )
}
