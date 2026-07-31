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

export interface UnitInventoryPanelProps {
  units: LodgingUnitRow[]
}

function reservationBadge(unit: LodgingUnitRow): { label: string; className: string } | null {
  const staff = {
    label: 'Staff',
    className: 'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300',
  }
  if (unit.is_container === true) {
    return { label: 'Building', className: 'bg-muted text-muted-foreground' }
  }
  if (unit.reservation_state === 'reserved_staff') return staff
  if (unit.reservation_state === 'reserved_other') {
    return {
      label: 'Held',
      className: 'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200',
    }
  }
  if (unit.reservation_state === 'released_to_family') {
    return {
      label: 'Released',
      className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300',
    }
  }
  if (unit.allocation_default === 'staff_default') return staff
  return null
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
          No lodging units in the registry yet. Add them in Admin → Family Camp Lodging.
        </p>
      </div>
    )
  }

  const byArea = new Map<string, { name: string; units: LodgingUnitRow[] }>()
  for (const unit of units) {
    const key = unit.area_code ?? ''
    const bucket = byArea.get(key) ?? { name: unit.area_name ?? 'Unassigned area', units: [] }
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
