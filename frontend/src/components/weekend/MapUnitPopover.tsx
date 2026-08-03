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

/**
 * Drop the building name every cell in a cluster shares.
 *
 * Found in a browser, not by a test: a four-room house rendered every cell as
 * "Clouds Rest Ba…", "Clouds Rest La…", "Clouds Rest Loft", "Clouds Rest Si…" —
 * the shared prefix consumed the width and truncated away the only part that
 * told them apart. Stripping the common leading WORDS leaves "Back", "Landing",
 * "Loft", "Side".
 *
 * Never strips a name to nothing: the walk stops while every name still has a
 * word left. Returns the names untouched when they share no prefix, which is
 * the normal case for a cluster of unrelated cabins.
 */
function distinguishingNames(units: MapUnit[]): string[] {
  const names = units.map((entry) => entry.unit.name)
  if (names.length < 2) return names
  const words = names.map((name) => name.split(' '))
  let shared = 0
  while (words.every((word) => word.length > shared + 1 && word[shared] === words[0]?.[shared])) {
    shared += 1
  }
  return shared === 0 ? names : words.map((word) => word.slice(shared).join(' '))
}

function FootprintGrid({ units, hue, onOpenParty }: MapUnitPopoverProps) {
  const taken = units.filter((entry) => entry.parties.length > 0).length
  const columns = Math.ceil(Math.sqrt(units.length))
  const shortNames = distinguishingNames(units)

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-bold" style={{ color: hue }}>
        {units.length} rooms · {taken} taken
      </h4>
      <div
        className="grid gap-1"
        style={{ gridTemplateColumns: `repeat(${String(columns)}, auto)` }}
      >
        {units.map((entry, index) => {
          const first = entry.parties[0]
          const extra = entry.parties.length - 1
          const shortName = shortNames[index] ?? entry.unit.name
          // A shared room must SAY it is shared. Showing only the first name
          // makes a two-family room read as single-occupancy, and three rooms
          // are genuinely shared in the current year's data.
          const label = first
            ? extra > 0
              ? `${first.display_name ?? ''} +${String(extra)}`
              : (first.display_name ?? '')
            : shortName
          const who = first
            ? entry.parties.map((party) => party.display_name ?? '').join(', ')
            : 'empty'
          // Prefixed by the visible label so the accessible name contains it
          // (WCAG 2.5.3), and duplicated into `title` because a tooltip alone is
          // invisible to touch and unreliable for screen readers.
          // For an empty cell `label` IS the unit name, so the occupied form
          // would read "Cedar 2 — Cedar 2, empty".
          const described = first ? `${label} — ${entry.unit.name}, ${who}` : `${label} — empty`
          const style = first
            ? { backgroundColor: hue, borderColor: hue }
            : {
                borderColor: hue,
                borderStyle: entry.unit.allocation_default === 'staff_default' ? 'dashed' : 'solid',
              }
          const className = `min-w-[2.5rem] truncate rounded border px-1.5 py-1 text-xs font-semibold ${
            first ? 'text-white' : 'bg-card text-muted-foreground'
          }`

          // An EMPTY cell is not a control. Rendering it as a button puts a
          // dead end in the tab order for every unoccupied room in a building,
          // which on this data is most of them.
          if (!first) {
            return (
              <div
                key={entry.unit.unit_id}
                data-testid="map-popover-cell"
                title={described}
                style={style}
                className={className}
              >
                {label}
                {/* REAL TEXT, not an aria-label. This div's implicit role is
                    `generic`, which ARIA 1.2 marks name-prohibited, so an
                    aria-label here is silently ignored by screen readers.
                    Worse, testing-library's accessible-name helper DOES return
                    it, so a test asserting the name would pass while real AT
                    announced nothing. `sr-only` puts the status in the DOM
                    where it is exposed regardless of role — the same pattern
                    SessionAvailability.tsx already uses. */}
                <span className="sr-only"> — empty</span>
              </div>
            )
          }

          return (
            <button
              key={entry.unit.unit_id}
              data-testid="map-popover-cell"
              type="button"
              title={described}
              aria-label={described}
              onClick={() => {
                onOpenParty(first)
              }}
              style={style}
              className={className}
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
