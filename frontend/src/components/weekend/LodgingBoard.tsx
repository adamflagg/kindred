/**
 * The weekend lodging board — read-only (spec §10, "C1").
 *
 * WHICH plan it is showing is the header's to say, not this component's — the
 * page's `ModeBadge` carries CM-vs-Draft exactly as summer's `SessionHeader`
 * does, and summer's board carries no chip of its own. This one used to, which
 * is how it came to assert the mirror over a draft once #1967 shipped a picker:
 * two indicators, only one of them wired up.
 *
 * The board takes no scenario id because it never reads or writes one — the
 * page fetches, and nothing here mutates. Drag placement (#1985) is what earns
 * plumbing it back, along with the writes that need it.
 *
 * Layout is §3.7: one collapsible section per area, each a WRAPPING GRID of
 * slot cards. Not summer's columns — a summer bunk column is tall because it
 * holds 10–14 campers, and 82 rooms cannot be 82 columns. Unplaced families
 * sit in the same floating corner queue summer uses for unassigned campers
 * (`FloatingUnplacedBadge`), not a permanent rail.
 *
 * Dragging is C2 and needs Phase B's draft tables, which do not exist yet.
 * Nothing here writes.
 */
import { ChevronDown, ChevronRight, Info, TriangleAlert } from 'lucide-react'
import { useCallback, useState } from 'react'

import { useDismissOnDeadSpace } from '../../hooks/useDismissOnDeadSpace'
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { buildBoard } from './boardLayout'
import { FamilyCard } from './FamilyCard'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'
import { FloatingUnplacedBadge } from './FloatingUnplacedBadge'
import { LodgingUnitCard } from './LodgingUnitCard'
import { partyKey } from './partyKey'

export interface LodgingBoardProps {
  parties: RosterPartyRow[]
  units: LodgingUnitRow[]
  year: number
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

      <FloatingUnplacedBadge
        parties={board.unplaced}
        onOpenParty={openParty}
        isPanelOpen={selected !== null}
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
    </div>
  )
}
