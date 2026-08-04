/**
 * One slot on the board: a room, whoever is in it, and whether that is a
 * problem.
 *
 * A slot, not a column. A summer bunk column is tall because it holds 10–14
 * campers; a lodging unit holds nothing, one party, or — three times in the
 * whole of 2026 — two parties who agreed to share. 82 rooms cannot be 82
 * columns, so these are small cards in a wrapping grid.
 *
 * The card asserts nothing it cannot support. `sleeps: null` means UNKNOWN and
 * renders as an em dash: the API already maps PocketBase's stored 0 to null,
 * and "sleeps 0" would be a lie about a cabin nobody has measured.
 */
import { useDroppable } from '@dnd-kit/core'
import { Bath, Plug, Snowflake, TriangleAlert, Users } from 'lucide-react'

import type { RosterPartyRow } from '../../types/lodging'
import type { BoardSlot } from './boardLayout'
import { unitDroppableId } from './dragPlacement'
import { FamilyCard } from './FamilyCard'
import { partyKey } from './partyKey'
import { reservationBadge } from './unitBadges'

export interface LodgingUnitCardProps {
  slot: BoardSlot
  /** The area's colour — a SECONDARY channel (§3.10), never the only one. */
  hue: string
  /** Placement is live: a scenario is selected and the user holds `bunking.manage`. */
  canPlace?: boolean
  onOpenParty: (party: RosterPartyRow) => void
}

export function LodgingUnitCard({
  slot,
  hue,
  canPlace = false,
  onOpenParty,
}: LodgingUnitCardProps) {
  const { unit, parties, consent } = slot
  const badge = reservationBadge(unit)
  const capacityKnown = unit.sleeps !== null && unit.sleeps !== undefined
  const isShared = parties.length > 1

  // Every room accepts a drop while placement is live, including a full or
  // unsuitable one. The fit check is advisory and every cabin is unconfirmed
  // until staff walk the property, so refusing here would block nearly every
  // placement for a reason that is really "nobody has checked yet".
  const { setNodeRef, isOver } = useDroppable({
    id: unitDroppableId(unit.code),
    disabled: !canPlace,
  })

  return (
    <div
      data-unit-card
      data-unit-code={unit.code}
      ref={setNodeRef}
      style={{ borderTopColor: hue }}
      className={`bg-card flex flex-col gap-2 rounded-xl border border-t-[3px] p-2.5 transition-colors ${
        consent
          ? 'border-amber-400 ring-1 ring-amber-400/40 dark:border-amber-500'
          : 'border-border'
      } ${parties.length === 0 ? 'bg-muted/25 border-dashed' : ''} ${
        isOver ? 'border-primary ring-primary/50 bg-primary/5 ring-2' : ''
      }`}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="text-foreground truncate text-[13px] font-semibold">{unit.name}</span>
        <span
          title={capacityKnown ? `Sleeps ${String(unit.sleeps)}` : 'Capacity not recorded'}
          className="text-muted-foreground ml-auto text-[11px] tabular-nums"
        >
          {capacityKnown ? String(unit.sleeps) : '—'}
        </span>
      </div>

      <div className="text-muted-foreground flex flex-wrap items-center gap-1.5 text-[11px]">
        {unit.bathroom === 'private' && (
          <span className="inline-flex items-center gap-0.5">
            <Bath className="h-3 w-3" aria-hidden="true" /> Private
          </span>
        )}
        {unit.bathroom === 'shared' && (
          <span className="inline-flex items-center gap-0.5">
            <Bath className="h-3 w-3" aria-hidden="true" /> Shared
          </span>
        )}
        {unit.has_power === true && <Plug className="h-3 w-3" aria-label="Power" />}
        {unit.has_ac === true && <Snowflake className="h-3 w-3" aria-label="Air conditioning" />}
        {badge && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
            {badge.label}
          </span>
        )}
        {/* A deactivated room only reaches the board when somebody is still in
            it — hiding it would drop them. */}
        {unit.is_active === false && (
          <span className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
            Inactive
          </span>
        )}
      </div>

      {isShared && (
        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            consent
              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
              : 'bg-muted text-muted-foreground'
          }`}
        >
          {consent ? (
            <TriangleAlert className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          ) : (
            <Users className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
          )}
          {`${String(parties.length)} families`}
        </span>
      )}

      {/* Spec §11: a household answered `no_share` and is sharing anyway. On
          2026 data this fires exactly once, and that one case is real. */}
      {consent && (
        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          {consent.reason}
        </p>
      )}

      {parties.length === 0 ? (
        <p className="text-muted-foreground py-1 text-center text-[11px] italic">Empty</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {parties.map((party) => (
            <FamilyCard
              key={partyKey(party)}
              party={party}
              unit={unit}
              sharedSlot={isShared}
              isDraggable={canPlace}
              onOpen={onOpenParty}
            />
          ))}
        </div>
      )}
    </div>
  )
}
