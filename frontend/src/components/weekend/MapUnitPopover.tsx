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
import { Accessibility, Bath, Plug, Refrigerator, Snowflake } from 'lucide-react'
import type { ReactNode } from 'react'

import type { RosterPartyRow } from '../../types/lodging'
import { partyIdentityLabel } from './householdIdentity'
import { CONSENT_AMBER } from './mapColors'
import type { MapUnit } from './mapModel'
import { partyKey } from './partyKey'
import { partyAttention, partyBeds } from './rosterAttention'
import { reservationBadge, shareabilityBadge } from './unitBadges'

/**
 * The board's `border-amber-400`, reused rather than re-picked. A consent flag
 * that were amber on one surface and orange on the other would read as two
 * different warnings.
 *
 * RE-EXPORTED from `mapColors.ts` rather than defined here (kindred#1997
 * review): the Guide's own `WeekendLegendButton` needs the same token from an
 * eager surface, and importing this file there would drag `LodgingMap`'s lazy
 * chunk in with it. Existing callers (`LodgingMap.tsx`, its tests) keep
 * importing `CONSENT_AMBER` from here unchanged.
 */
export { CONSENT_AMBER }

/** Said in words, because colour alone is not a signal (WCAG 1.4.1). */
export const CONSENT_PHRASE = 'sharing not consented'

export interface MapUnitPopoverProps {
  /** One entry for a lone room, several for a cluster. */
  units: MapUnit[]
  hue: string
  onOpenParty: (party: RosterPartyRow) => void
}

/**
 * What the registry records about the room.
 *
 * Icons carry `role="img"` and a label rather than bare `aria-hidden` glyphs:
 * an amenity that exists only as a shape is invisible to AT, and this is the
 * only place on the map that reports them. Same icon grammar as
 * `LodgingUnitCard`, so an amenity reads the same on both surfaces.
 */
function Amenities({ unit }: { unit: MapUnit['unit'] }): ReactNode {
  const items: Array<{ label: string; icon: typeof Bath }> = []
  if (unit.bathroom === 'private') items.push({ label: 'Private bathroom', icon: Bath })
  if (unit.bathroom === 'shared') items.push({ label: 'Shared bathroom', icon: Bath })
  if (unit.has_power === true) items.push({ label: 'Power', icon: Plug })
  if (unit.has_ac === true) items.push({ label: 'Air conditioning', icon: Snowflake })
  if (unit.has_fridge === true) items.push({ label: 'Fridge', icon: Refrigerator })
  if (unit.is_accessible === true) items.push({ label: 'Accessible', icon: Accessibility })
  if (items.length === 0) return null

  return (
    <ul className="text-muted-foreground flex flex-wrap items-center gap-1.5">
      {items.map(({ label, icon: Icon }) => (
        <li key={label}>
          <Icon role="img" aria-label={label} className="h-3 w-3" />
        </li>
      ))}
    </ul>
  )
}

function occupantButtons(
  parties: RosterPartyRow[],
  onOpenParty: (party: RosterPartyRow) => void
): ReactNode {
  return parties.map((party) => (
    <button
      key={partyKey(party)}
      type="button"
      onClick={() => {
        onOpenParty(party)
      }}
      className="text-foreground hover:text-primary text-right text-xs font-semibold underline-offset-2 hover:underline"
    >
      {partyIdentityLabel(party)}
    </button>
  ))
}

function DetailCard({ units, hue, onOpenParty }: MapUnitPopoverProps) {
  const entry = units[0]
  if (!entry) return null
  const { unit, parties, consent } = entry
  const capacityKnown = unit.sleeps !== null && unit.sleeps !== undefined
  const badge = reservationBadge(unit)
  const bedsNeeded = parties.reduce((sum, party) => sum + partyBeds(party), 0)

  // Only the ACTIONABLE levels. `unverified` is the normal state of every
  // cabin in the registry today — nothing is `is_confirmed` yet — so rendering
  // it would put a caveat on every occupied room and stop being read.
  // `partyAttention` owns the rule that only a confirmed cabin is evidence.
  const unmet = parties
    .map((party) => ({ party, attention: partyAttention(party, unit) }))
    .filter(({ attention }) => attention.level === 'required' || attention.level === 'unmet')

  const tags: string[] = []
  if (unit.near_bathhouse) tags.push('near bathhouse')
  if (unit.inventory_class === 'staff_default') tags.push('staff-default')
  if (parties.length > 1) tags.push(`shared by ${String(parties.length)}`)
  // kindred#2026, and it belongs HERE rather than only on the board because
  // this popover is the one surface that already prints `shared by N`. Saying
  // a room is shared by two while saying nothing about whether it MAY be is
  // the disagreement `unitBadges`' own header exists to prevent ("shared by
  // the board's slot cards and the map's unit popover so the two cannot
  // drift"). Rendered through the shared helper, never re-derived, so the
  // wording and the silence on `single_party` match the board exactly.
  const sharing = shareabilityBadge(unit)

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
        {/* A SIZING HINT, not a verdict. This comment used to say the number
            "counts every adult in the household whether or not they attend,
            so it runs high" — no longer true since #1925 and #2046: the
            server drops blank and placeholder `family_camp_adults` slots and
            discounts a child under 18 months, so `partyBeds` is BEDS. Still a
            hint rather than a verdict, because the adult list is a five-slot
            scrape staff transpose by hand and 16–22 households a year carry
            adults it never receives (#1925's accepted cost) — the error now
            runs in both directions instead of only high. Shown only against a
            capacity that exists; "3 of unknown" says nothing. */}
        {parties.length > 0 && capacityKnown && (
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Beds</dt>
            <dd className={bedsNeeded > (unit.sleeps ?? 0) ? 'font-semibold text-amber-700' : ''}>
              {`${String(bedsNeeded)} of ${String(unit.sleeps)}`}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Occupied by</dt>
          <dd className="flex flex-col items-end gap-0.5">
            {parties.length > 0 ? occupantButtons(parties, onOpenParty) : <em>empty</em>}
          </dd>
        </div>
      </dl>

      <Amenities unit={unit} />

      {(badge !== null || unit.is_active === false || unit.is_confirmed === false) && (
        <ul className="flex flex-wrap gap-1">
          {badge && (
            <li className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
              {badge.label}
            </li>
          )}
          {/* A deactivated room reaches the board only because somebody is
              still in it — `boardLayout`'s own note: "hiding it would drop
              them." So it must say so rather than read as bookable. */}
          {unit.is_active === false && (
            <li className="rounded-full bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-800 dark:bg-slate-800 dark:text-slate-200">
              Inactive
            </li>
          )}
          {unit.is_confirmed === false && (
            <li className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              Unconfirmed
            </li>
          )}
        </ul>
      )}

      {/* The cabin does not answer what this family asked for. Reason strings
          come from `partyAttention` and are documented as never PHI. */}
      {unmet.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {unmet.map(({ party, attention }) => (
            <li
              key={partyKey(party)}
              className="text-[11px] font-medium text-red-700 dark:text-red-400"
            >
              {`${partyIdentityLabel(party)} — ${attention.reason}`}
            </li>
          ))}
        </ul>
      )}
      {sharing && (
        <div>
          <span className={`rounded-full px-1.5 py-0.5 text-xs font-medium ${sharing.className}`}>
            {sharing.label}
          </span>
        </div>
      )}
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
      {/* The board prints `consent.reason` verbatim beside the slot and this
          says the same thing, because the flag is the same flag off the same
          `buildBoard` slot. Rendering it is the whole reason `MapUnit` carries
          `consent` — a room #1926 flagged must not peek as an ordinary shared
          room. The string is built by `consentReason` and is never PHI. */}
      {consent && (
        <p className="text-[11px] font-medium text-amber-700 dark:text-amber-400">
          {consent.reason}
        </p>
      )}
    </div>
  )
}

interface ClusterNames {
  /** Per-room labels, with any building name the whole cluster shares stripped. */
  names: string[]
  /** The stripped building name, or '' when the cluster shared no prefix. */
  prefix: string
}

/**
 * Drop the building name every cell in a cluster shares — but don't delete
 * it outright. Stripping it from every cell with nowhere else to put it trades
 * one lie for another: a staff member would see "Back / Loft" with nothing
 * saying which building those rooms are in. Callers put a non-empty `prefix`
 * in the header instead.
 *
 * Found in a browser, not by a test: a four-room house rendered every cell as
 * "Clouds Rest Ba…", "Clouds Rest La…", "Clouds Rest Loft", "Clouds Rest Si…" —
 * the shared prefix consumed the width and truncated away the only part that
 * told them apart. Stripping the common leading WORDS leaves "Back", "Landing",
 * "Loft", "Side", with "Clouds Rest" moved to the header.
 *
 * Never strips a name to nothing: the walk stops while every name still has a
 * word left. Returns the names untouched, and an empty prefix, when they
 * share no prefix, which is the normal case for a cluster of unrelated
 * cabins. Computed over UNIT NAMES only, never party names — a cell's label
 * is the occupant's name once a room is taken, and a prefix walk across mixed
 * unit/party strings would find something meaningless.
 */
function distinguishingNames(units: MapUnit[]): ClusterNames {
  const names = units.map((entry) => entry.unit.name)
  if (names.length < 2) return { names, prefix: '' }
  const words = names.map((name) => name.split(' '))
  let shared = 0
  while (words.every((word) => word.length > shared + 1 && word[shared] === words[0]?.[shared])) {
    shared += 1
  }
  if (shared === 0) return { names, prefix: '' }
  return {
    names: words.map((word) => word.slice(shared).join(' ')),
    prefix: words[0]?.slice(0, shared).join(' ') ?? '',
  }
}

function FootprintGrid({ units, hue, onOpenParty }: MapUnitPopoverProps) {
  const taken = units.filter((entry) => entry.parties.length > 0).length
  const columns = Math.ceil(Math.sqrt(units.length))
  const { names: shortNames, prefix } = distinguishingNames(units)

  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-bold" style={{ color: hue }}>
        {prefix && `${prefix} · `}
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
              ? `${partyIdentityLabel(first)} +${String(extra)}`
              : partyIdentityLabel(first)
            : shortName
          const who = first
            ? entry.parties.map((party) => partyIdentityLabel(party)).join(', ')
            : 'empty'
          // Prefixed by the visible label so the accessible name contains it
          // (WCAG 2.5.3), and duplicated into `title` because a tooltip alone is
          // invisible to touch and unreliable for screen readers.
          // Always built from the FULL unit name, never the shortened cluster
          // label — a tooltip has room, and the short form is ambiguous once
          // it is out of the header's context.
          // A cluster mark rings amber if ANY member is flagged, which on a
          // four-room house narrows it to four. This is where that resolves to
          // the one room — in the tooltip as well as the border, because the
          // border alone would be colour as the sole signal.
          const base = first
            ? `${label} — ${entry.unit.name}, ${who}`
            : `${entry.unit.name} — empty`
          // The grid has no room for badges, so status rides in the tooltip.
          // A held or deactivated room that said nothing here would be
          // indistinguishable from a bookable one.
          const notes: string[] = []
          const cellBadge = reservationBadge(entry.unit)
          if (cellBadge) notes.push(cellBadge.label)
          if (entry.unit.is_active === false) notes.push('Inactive')
          if (entry.consent) notes.push(CONSENT_PHRASE)
          const described = notes.length > 0 ? `${base} — ${notes.join(' — ')}` : base
          const style = first
            ? {
                backgroundColor: hue,
                borderColor: entry.consent ? CONSENT_AMBER : hue,
              }
            : {
                borderColor: hue,
                borderStyle: entry.unit.inventory_class === 'staff_default' ? 'dashed' : 'solid',
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
