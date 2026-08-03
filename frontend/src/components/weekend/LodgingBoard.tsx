/**
 * The weekend lodging board — read-only (spec §10, "C1").
 *
 * With no scenario this is a CampMinder MIRROR, exactly as the summer board is
 * read-only for everyone in production mode (`ScenarioContext`'s
 * `isProductionMode`). The amber CM badge says so on the surface, because a
 * board that looks draggable and is not is worse than a list.
 *
 * Layout is §3.7: an unplaced rail on the left, then one collapsible section
 * per area, each a WRAPPING GRID of slot cards. Not summer's columns — a
 * summer bunk column is tall because it holds 10–14 campers, and 82 rooms
 * cannot be 82 columns.
 *
 * Dragging is C2 and needs Phase B's draft tables, which do not exist yet.
 * Nothing here writes.
 */
import { ChevronDown, ChevronRight, Info, TriangleAlert } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useDismissOnDeadSpace } from '../../hooks'
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { buildBoard } from './boardLayout'
import { FamilyCard } from './FamilyCard'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { LodgingUnitCard } from './LodgingUnitCard'

export interface LodgingBoardProps {
  parties: RosterPartyRow[]
  units: LodgingUnitRow[]
  year: number
}

/** Stable identity for a party across renders. */
function partyKey(party: RosterPartyRow): string {
  return `${party.grain}-${String(party.household_cm_id ?? party.person_cm_id ?? party.display_name)}`
}

export function LodgingBoard({ parties, units, year }: LodgingBoardProps) {
  const board = buildBoard(parties, units)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [selected, setSelected] = useState<RosterPartyRow | null>(null)
  const [requestClose, setRequestClose] = useState(false)

  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))

  const openParty = useCallback((party: RosterPartyRow) => {
    setRequestClose(false)
    setSelected(party)
  }, [])

  const closePanel = useCallback(() => {
    setSelected(null)
    setRequestClose(false)
  }, [])

  // Same dead-space dismissal the summer board uses, through the same hook.
  useDismissOnDeadSpace(selected === null ? null : partyKey(selected), () => {
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
          <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true" />
          CM — CampMinder mirror, read-only
        </span>
        {board.flaggedCount > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
            <TriangleAlert className="h-3.5 w-3.5 flex-shrink-0" aria-hidden="true" />
            {board.flaggedCount === 1
              ? '1 shared cabin needs a look'
              : `${String(board.flaggedCount)} shared cabins need a look`}
          </span>
        )}
      </div>

      <div className="card-lodge grid grid-cols-1 overflow-hidden lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside
          aria-label="Unplaced parties"
          className="bg-muted/30 border-border/60 flex flex-col gap-2 border-b p-3 lg:border-r lg:border-b-0"
        >
          <div className="flex items-baseline justify-between gap-2">
            <h3 className="font-display text-foreground text-sm font-bold">Unplaced</h3>
            <span className="text-muted-foreground text-xs tabular-nums">
              {board.unplaced.length}
            </span>
          </div>

          {board.unplaced.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">Everyone has a cabin.</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {board.unplaced.map((party) => (
                <FamilyCard key={partyKey(party)} party={party} onRail={true} onOpen={openParty} />
              ))}
            </div>
          )}

          {/* §3.7 also wanted "a share request whose partner is not yet
              placed". That leg DOES NOT EXIST — no request names are resolved
              to households (spec §7.3, unbuilt) — so the surface admits it
              rather than implying a completeness it does not have. */}
          <p className="text-muted-foreground/80 mt-1 text-[11px] leading-snug">
            Ranked on a mandatory accommodation only. Ranking by an unplaced share partner needs
            request names resolved to households, which is not built yet.
          </p>
        </aside>

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
              placed, so the rail would be a lie — and dropping them would make
              the board quietly disagree with the roster. */}
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
                  <FamilyCard key={partyKey(party)} party={party} onOpen={openParty} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {selected !== null && (
        <FamilyDetailsPanel
          key={partyKey(selected)}
          party={selected}
          unit={unitsByCode.get(selected.unit_code ?? '')}
          year={year}
          requestClose={requestClose}
          onClose={closePanel}
        />
      )}
    </div>
  )
}
