/**
 * The in-place peek on the map.
 *
 * One room gets a detail card; a cluster gets its rooms as a footprint grid.
 * Both matter: a pin whose only affordance is a native tooltip reads as broken,
 * and over half the site's rooms are lone cabins that would otherwise have no
 * interaction at all.
 *
 * `sleeps: null` is UNKNOWN and says so. "Sleeps 0" would be a lie about a
 * cabin nobody has measured.
 */
import type { ReactNode } from 'react'

import type { RosterPartyRow } from '../../types/lodging'
import type { MapUnit } from './mapModel'

export interface MapUnitPopoverProps {
  /** One entry for a lone room, several for a cluster. */
  units: MapUnit[]
  hue: string
  onOpenParty: (party: RosterPartyRow) => void
}

function occupantButtons(
  parties: RosterPartyRow[],
  onOpenParty: (party: RosterPartyRow) => void
): ReactNode {
  return parties.map((party) => (
    <button
      key={`${party.grain}-${String(party.household_cm_id || party.person_cm_id)}`}
      type="button"
      onClick={() => {
        onOpenParty(party)
      }}
      className="text-foreground hover:text-primary text-right text-xs font-semibold underline-offset-2 hover:underline"
    >
      {party.display_name}
    </button>
  ))
}

function DetailCard({ units, hue, onOpenParty }: MapUnitPopoverProps) {
  const entry = units[0]
  if (!entry) return null
  const { unit, parties } = entry
  const capacityKnown = unit.sleeps !== null && unit.sleeps !== undefined

  const tags: string[] = []
  if (unit.near_bathhouse) tags.push('near bathhouse')
  if (unit.allocation_default === 'staff_default') tags.push('staff-default')
  if (parties.length > 1) tags.push(`shared by ${String(parties.length)}`)

  return (
    <div className="flex min-w-[11rem] flex-col gap-1.5">
      <h4 className="text-foreground text-xs font-bold" style={{ color: hue }}>
        {unit.name}
      </h4>
      <dl className="flex flex-col gap-0.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Area</dt>
          <dd>{unit.area_name}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Sleeps</dt>
          <dd>{capacityKnown ? unit.sleeps : <em>unknown</em>}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Occupied by</dt>
          <dd className="flex flex-col items-end gap-0.5">
            {parties.length > 0 ? occupantButtons(parties, onOpenParty) : <em>empty</em>}
          </dd>
        </div>
      </dl>
      {tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {tags.map((tag) => (
            <li
              key={tag}
              style={{ backgroundColor: hue }}
              className="rounded-full px-1.5 py-0.5 text-xs font-semibold text-white"
            >
              {tag}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function FootprintGrid({ units, hue, onOpenParty }: MapUnitPopoverProps) {
  const taken = units.filter((entry) => entry.parties.length > 0).length
  const columns = Math.ceil(Math.sqrt(units.length))

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-bold" style={{ color: hue }}>
        {units.length} rooms · {taken} taken
      </h4>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${String(columns)}, auto)` }}
      >
        {units.map((entry) => {
          const occupied = entry.parties.length > 0
          const label = entry.parties[0]?.display_name ?? entry.unit.name
          return (
            <button
              key={entry.unit.unit_id}
              data-testid="map-popover-cell"
              type="button"
              title={`${entry.unit.name} — ${occupied ? entry.parties.map((p) => p.display_name).join(', ') : 'empty'}`}
              onClick={() => {
                const first = entry.parties[0]
                if (first) onOpenParty(first)
              }}
              style={
                occupied
                  ? { backgroundColor: hue, borderColor: hue }
                  : {
                      borderColor: hue,
                      borderStyle:
                        entry.unit.allocation_default === 'staff_default' ? 'dashed' : 'solid',
                    }
              }
              className={`min-w-[2.5rem] truncate rounded border px-1.5 py-1 text-xs font-semibold ${
                occupied ? 'text-white' : 'bg-card text-muted-foreground'
              }`}
            >
              {label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function MapUnitPopover(props: MapUnitPopoverProps) {
  if (props.units.length === 0) return null
  return (
    <div
      data-map-popover
      style={{ borderColor: props.hue }}
      className="bg-card shadow-lodge-sm max-w-[15rem] rounded-xl border-2 p-2"
    >
      {props.units.length === 1 ? <DetailCard {...props} /> : <FootprintGrid {...props} />}
    </div>
  )
}
