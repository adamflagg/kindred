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
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { ChevronDown, ChevronRight, Info, TriangleAlert } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'

import { useDismissOnDeadSpace } from '../../hooks/useDismissOnDeadSpace'
import { useLodgingPlacement } from '../../hooks/useLodgingPlacement'
import { useUnitAvailability } from '../../hooks/useUnitAvailability'
import { useUnitMerge } from '../../hooks/useUnitMerge'
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { buildBoard } from './boardLayout'
import { mergeDragUnit, resolveDrop, resolveMergeDrop } from './dragPlacement'
import { FamilyCard, FamilyCardPreview } from './FamilyCard'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { FloatingUnplacedBadge } from './FloatingUnplacedBadge'
import { LodgingUnitCard } from './LodgingUnitCard'
import { partyKey } from './partyKey'

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

export function LodgingBoard({
  parties,
  units,
  year,
  scenario = '',
  sessionCmId = 0,
  canManage = false,
}: LodgingBoardProps) {
  const board = buildBoard(parties, units)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<RosterPartyRow | null>(null)
  const [requestClose, setRequestClose] = useState(false)
  const [dragging, setDragging] = useState<RosterPartyRow | null>(null)
  /** The card currently being dragged BY ITS MERGE HANDLE, for grey-out. */
  const [draggingMergeUnit, setDraggingMergeUnit] = useState<LodgingUnitRow | null>(null)

  // THREE conditions, not two. `sessionCmId` is in there because every write
  // names a weekend, and the prop defaults to 0 for the thirty tests that do
  // not exercise placement — a board that let a drop through without one would
  // send `session_cm_id: 0` against a schema declaring `gt=0`.
  const canPlace = canManage && scenario !== '' && sessionCmId > 0

  // TWO conditions, not three, and the missing one is deliberate. Availability
  // carries no scenario since 1500000135 — a burst pipe closes a cabin in every
  // plan for that weekend — so reusing `canPlace` here would reintroduce the
  // deleted dimension at the UI layer: staff looking at the CampMinder mirror,
  // which is where most of them look, could not close a cabin at all.
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

  const { move } = useLodgingPlacement({ year, sessionCmId, scenario })
  const { setAvailability, pendingUnitId } = useUnitAvailability({ year, sessionCmId })
  // `scenario` here is the same prop `useLodgingPlacement` gets — on the
  // mirror that is `''`, and the hook now sends it rather than refusing, per
  // `canMergeUnits` above.
  const { setCombined, pendingUnitId: pendingMergeUnitId } = useUnitMerge({
    year,
    sessionCmId,
    scenario,
  })

  // Memoised because `mergeUnit` closes over it: rebuilt each render, it would
  // give that callback a new identity every time and defeat the point of the
  // `useCallback`. Cheap either way at ~120 units, but the lint rule is right.
  const unitsByCode = useMemo(() => new Map(units.map((unit) => [unit.code, unit])), [units])

  const sensors = useSensors(
    // The same activation constraints summer uses. The distance threshold is
    // what keeps a card that is also a button clickable: a plain click never
    // travels 10px, so it opens the details panel instead of starting a drag.
    useSensor(MouseSensor, { activationConstraint: { distance: 10 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 100, tolerance: 5 } })
  )

  // Pointer-within first, falling back to rect intersection — summer's, and
  // for the same reason: without it a drop released over dead space snaps to
  // whichever cabin happens to be nearest, placing a family somewhere nobody
  // chose.
  const collisionDetection = (args: Parameters<typeof pointerWithin>[0]) => {
    const pointerCollisions = pointerWithin(args)
    return pointerCollisions.length > 0 ? pointerCollisions : rectIntersection(args)
  }

  const handleDragStart = (event: DragStartEvent) => {
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
  // drag. Same two resets as `handleDragEnd`'s first two lines — see
  // `useLockGroupDragDrop.tsx`'s `handleDragCancel` for the same shape on
  // summer's own drag gesture.
  const handleDragCancel = () => {
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

  const writeAvailability = useCallback(
    (unit: LodgingUnitRow, write: { familyAvailable: boolean | null; reason: string }) => {
      // The rejection path is the hook's: it raises the toast. Catching here
      // keeps the rejected promise from surfacing as an unhandled rejection,
      // exactly as the drop handler does.
      void setAvailability({
        unitId: unit.unit_id,
        unitName: unit.name,
        familyAvailable: write.familyAvailable,
        reason: write.reason,
      }).catch(() => undefined)
    },
    [setAvailability]
  )

  const openParty = useCallback((party: RosterPartyRow) => {
    setRequestClose(false)
    setSelected(party)
  }, [])

  const closePanel = useCallback(() => {
    setSelected(null)
    setRequestClose(false)
  }, [])

  // Same dead-space dismissal the summer board uses, through the same hook.
  useDismissOnDeadSpace(selected !== null, () => {
    setRequestClose(true)
  })

  const toggleArea = (key: string) => {
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  return (
    <DndContext
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
              <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
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
                const isCollapsed = collapsed.has(area.key)
                return (
                  <section key={area.key}>
                    <h3 className="mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          toggleArea(area.key)
                        }}
                        aria-expanded={!isCollapsed}
                        className="group flex w-full items-center gap-2 text-left"
                      >
                        {isCollapsed ? (
                          <ChevronRight className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
                        ) : (
                          <ChevronDown className="text-muted-foreground h-3.5 w-3.5 flex-shrink-0" />
                        )}
                        {/* Area colour is a SECONDARY channel (§3.10). This dot
                          and the card's top edge carry it; the heading below
                          does the actual grouping, so nothing depends on
                          telling violet from rose. */}
                        <span
                          className="h-2 w-2 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: area.hue }}
                          aria-hidden="true"
                        />
                        <span className="text-muted-foreground group-hover:text-foreground text-[11px] font-bold tracking-wider uppercase transition-colors">
                          {area.name}
                        </span>
                        <span className="text-muted-foreground/70 text-[11px] tabular-nums">
                          {`${String(area.slots.length)} rooms · ${String(area.partyCount)} families`}
                        </span>
                        <span className="bg-border/70 ml-1 h-px flex-1" aria-hidden="true" />
                      </button>
                    </h3>

                    {!isCollapsed && (
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-3">
                        {area.slots.map((slot) => (
                          <LodgingUnitCard
                            key={slot.unit.unit_id}
                            slot={slot}
                            // The registry, so the card's per-party sharing
                            // chip expands a container code to its rooms —
                            // the same `overlappingPartyKeys` the slot flag
                            // already ran with these units in `buildBoard`.
                            units={units}
                            hue={area.hue}
                            canPlace={canPlace}
                            canSetAvailability={canSetAvailability}
                            savingAvailability={pendingUnitId === slot.unit.unit_id}
                            onSetAvailability={writeAvailability}
                            canMerge={canMergeUnits}
                            mergeSourceUnit={draggingMergeUnit}
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
                  <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  Placed outside the board
                </h3>
                <p className="text-muted-foreground mb-2 text-xs">
                  Assigned to a merged slot or to a room the board does not draw a card for.
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] items-start gap-3">
                  {board.offBoard.map((party) => (
                    <FamilyCard
                      key={partyKey(party)}
                      party={party}
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
          isPanelOpen={selected !== null}
          canPlace={canPlace}
        />

        {selected !== null && (
          <FamilyDetailsPanel
            party={selected}
            unit={unitsByCode.get(selected.unit_code ?? '')}
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
