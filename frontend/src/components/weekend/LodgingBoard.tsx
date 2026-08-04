/**
 * The weekend lodging board (spec §10, "C1"; drag placement is "C2").
 *
 * With no scenario this is a CampMinder MIRROR, exactly as the summer board is
 * read-only for everyone in production mode (`ScenarioContext`'s
 * `isProductionMode`). The amber CM badge says so on the surface, because a
 * board that looks draggable and is not is worse than a list.
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
import { useCallback, useState } from 'react'

import { useDismissOnDeadSpace } from '../../hooks/useDismissOnDeadSpace'
import { useLodgingPlacement } from '../../hooks/useLodgingPlacement'
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { BoardModeChip } from './BoardModeChip'
import { buildBoard } from './boardLayout'
import { resolveDrop } from './dragPlacement'
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
   * OPTIONAL, defaulting to the mirror, which is the safe reading: a
   * caller that forgets it gets the amber read-only chip rather than a
   * claim of a draft. Required would put tsc behind it, but the only two
   * real callers are on `WeekendRosterPage` — the rest are tests, and
   * making thirty of them pass a prop they do not exercise is churn.
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

  // THREE conditions, not two. `sessionCmId` is in there because every write
  // names a weekend, and the prop defaults to 0 for the thirty tests that do
  // not exercise placement — a board that let a drop through without one would
  // send `session_cm_id: 0` against a schema declaring `gt=0`.
  const canPlace = canManage && scenario !== '' && sessionCmId > 0

  const { move } = useLodgingPlacement({ year, sessionCmId, scenario })

  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))

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
    const active = parties.find((party) => partyKey(party) === event.active.id)
    setDragging(active ?? null)
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDragging(null)
    if (!canPlace) return

    const intent = resolveDrop({
      activeId: String(event.active.id),
      overId: event.over === null ? null : String(event.over.id),
      parties,
      units,
    })
    if (intent === null) return

    // The rejection path is the hook's: it rolls the optimistic move back and
    // raises the toast. Catching here keeps the rejected promise from
    // surfacing as an unhandled rejection.
    void move(intent).catch(() => undefined)
  }

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
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <BoardModeChip scenario={scenario} />
          {board.flaggedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
              <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
              {board.flaggedCount === 1
                ? '1 shared cabin needs a look'
                : `${String(board.flaggedCount)} shared cabins need a look`}
            </span>
          )}
        </div>

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
                      <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-start gap-2.5">
                        {area.slots.map((slot) => (
                          <LodgingUnitCard
                            key={slot.unit.unit_id}
                            slot={slot}
                            hue={area.hue}
                            canPlace={canPlace}
                            onOpenParty={openParty}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })
            )}

            {/* A merge carries no unit code, and an assignment can name a
              container or a unit absent from the payload. Those parties ARE
              placed, so the queue would be a lie — and dropping them would make
              the board quietly disagree with the roster.

              They are still draggable, and that is the point: dragging one
              onto a room COLLAPSES the placement to that room, which is how a
              multi-room party gets a card again. That is not merge-by-drag —
              creating a merge needs #1940 first. */}
            {board.offBoard.length > 0 && (
              <section>
                <h3 className="text-muted-foreground mb-2 flex items-center gap-1.5 text-[11px] font-bold tracking-wider uppercase">
                  <Info className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
                  Placed outside the board
                </h3>
                <p className="text-muted-foreground mb-2 text-xs">
                  Assigned to a merged slot or to a room the board does not draw a card for.
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] items-start gap-2.5">
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
