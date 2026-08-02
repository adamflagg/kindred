/**
 * The lodging inventory for one weekend, grouped by area.
 *
 * Reserved units are BADGED, not hidden (spec §3.7): staff need them for
 * adjacency reasoning, and hiding them would make the site look smaller than
 * it is. Container rows are labelled "Building" so nobody mistakes a
 * whole-building aggregate for a bookable room.
 */
import { Bath, Plug, Snowflake } from 'lucide-react'

import type { LodgingUnitRow } from '../../types/lodging'
import { reservationBadge } from './unitBadges'

export interface UnitInventoryPanelProps {
  units: LodgingUnitRow[]
}

function UnitRow({
  unit,
  showUnconfirmedBadge,
}: {
  unit: LodgingUnitRow
  showUnconfirmedBadge: boolean
}) {
  const badge = reservationBadge(unit)
  return (
    <li className="border-border/50 flex flex-wrap items-center gap-2 border-b py-1.5 last:border-b-0">
      <span className="text-foreground min-w-40 text-sm font-medium">{unit.name}</span>
      {/* null means UNKNOWN — the API maps PocketBase's stored 0 to null.
          "Sleeps 0" would be a lie about a cabin nobody has measured. */}
      <span className="text-muted-foreground text-xs">
        Sleeps {unit.sleeps === null || unit.sleeps === undefined ? '—' : String(unit.sleeps)}
      </span>
      {unit.bathroom === 'private' && (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <Bath className="h-3 w-3" /> Private
        </span>
      )}
      {unit.bathroom === 'shared' && (
        <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <Bath className="h-3 w-3" /> Shared
        </span>
      )}
      {unit.has_power === true && <Plug className="text-muted-foreground h-3 w-3" />}
      {unit.has_ac === true && <Snowflake className="text-muted-foreground h-3 w-3" />}
      {badge && (
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${badge.className}`}>
          {badge.label}
        </span>
      )}
      {showUnconfirmedBadge && unit.is_confirmed === false && (
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          Unconfirmed
        </span>
      )}
    </li>
  )
}

export function UnitInventoryPanel({ units }: UnitInventoryPanelProps) {
  if (units.length === 0) {
    return (
      <div className="card-lodge p-4">
        <p className="text-muted-foreground text-sm">
          No lodging units in the registry yet. Add them in Manage → Family Camp Lodging.
        </p>
      </div>
    )
  }

  // Keyed on the code AND the name. The code alone is not unique: the API
  // sends `area_code: ""` for anything it cannot resolve, so two differently
  // named areas would share a bucket and the second one's name would be
  // silently discarded along with its heading.
  const byArea = new Map<string, { name: string; units: LodgingUnitRow[] }>()
  for (const unit of units) {
    const name = unit.area_name ?? 'Unassigned area'
    const key = `${unit.area_code ?? ''}::${name}`
    const bucket = byArea.get(key) ?? { name, units: [] }
    bucket.units.push(unit)
    byArea.set(key, bucket)
  }

  // Nothing in the registry is confirmed yet in 2026, so a per-row badge would
  // repeat on all 82 rows and stop being read. Say it once instead.
  const allUnconfirmed = units.every((unit) => unit.is_confirmed === false)

  return (
    <div className="card-lodge flex flex-col gap-4 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-foreground text-lg font-bold">Lodging inventory</h2>
        {allUnconfirmed && (
          <span className="text-muted-foreground text-xs">No amenities confirmed yet</span>
        )}
      </div>
      {[...byArea.entries()].map(([code, bucket]) => (
        <section key={code}>
          <h3 className="text-muted-foreground mb-1 text-xs font-semibold tracking-wide uppercase">
            {bucket.name}
          </h3>
          <ul>
            {bucket.units.map((unit) => (
              <UnitRow key={unit.unit_id} unit={unit} showUnconfirmedBadge={!allUnconfirmed} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
