/**
 * The in-place peek on the map — the surface that answers WHO IS HOUSED WHERE.
 *
 * One room gets a detail card. A cluster gets MASTER-DETAIL (kindred#2183): a
 * summary over the whole building, the footprint grid beneath it as a spatial
 * picker, and this same detail card for whichever room the picker selects.
 *
 * That replaced an either/or — `units.length === 1 ? DetailCard : FootprintGrid`
 * — under which a multi-room building could NEVER show the rich card, because
 * having more than one room was itself the disqualifier. Its cells carried a
 * family label and nothing else, so the owner's question about a house ("who
 * is in it") was answerable only for lone cabins.
 *
 * THE GRID'S CELLS STAY SMALL. It is the cluster disambiguator: proximity
 * clustering can put rooms from more than one building under one pin, and a
 * numbered blob is unreadable without a footprint. Layering a summary above it
 * costs the grid nothing; growing its cells to carry detail would break the
 * thing it exists for.
 *
 * `sleeps: null` is UNKNOWN and says so. "Sleeps 0" would be a lie about a
 * cabin nobody has measured.
 */
import { Accessibility, Bath, Home, Plug, Refrigerator, Snowflake } from 'lucide-react'
import { type ReactNode, useState } from 'react'

import type { RosterPartyRow } from '../../types/lodging'
import { Tooltip } from '../ui/Tooltip'
import { namedAdults, partyIdentityLabel } from './householdIdentity'
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
  /**
   * Party keys holding an entire building this weekend (kindred#2008's
   * placement marker, extended to the map by kindred#2174). Computed by
   * `LodgingMap` from `boardLayout.ts`'s `wholeBuildingHolders(parties,
   * units)` — the full registry, which this popover never receives — and
   * handed down as one `Set`. Never re-derived here: this popover's own
   * `units` prop is only a cluster's members, and cannot answer the question
   * alone (see `MapUnitPopoverProps.units`'s own doc).
   *
   * Optional and defaulting to empty so the ~50 existing call sites that
   * predate this prop keep compiling and keep meaning "nobody holds a whole
   * building here" rather than needing a threaded-through empty set.
   */
  wholeBuildingKeys?: Set<string>
}

/** Referentially stable so an omitted `wholeBuildingKeys` never re-triggers
 *  a memoised child on every render. */
const NO_WHOLE_BUILDING_HOLDERS: Set<string> = new Set()

/**
 * The "Whole building" chip, and since kindred#2072 the MAP IS ITS ONLY HOME.
 *
 * It was a mirror of `FamilyCard.tsx`'s own chip (its `Chip` with
 * `tone="building"`), reproduced rather than imported because that `Chip` is
 * local and unexported. The board's copy is now STRUCK — vocabulary §3,
 * "Earlier cuts, still struck" — along with its indigo tone, so what was a
 * deliberate mirror is the last one standing.
 *
 * It stays here, and the asymmetry is the reason it can: a board card's
 * geometry says nothing about containment, where the map draws a building as
 * one mark among its neighbours and the fact is worth stating. The same
 * split `Staff` takes — cut from the card, alive on the map and the units
 * admin table.
 *
 * So do NOT "restore consistency" by putting it back on the card, and do not
 * delete it here for having lost its twin.
 */
function WholeBuildingBadge() {
  return (
    <span className="inline-flex items-center gap-0.5 rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap text-indigo-800 dark:bg-indigo-950/50 dark:text-indigo-300">
      <Home className="h-2.5 w-2.5 flex-shrink-0" />
      Whole building
    </span>
  )
}

/**
 * What the registry records about the room.
 *
 * Icons keep their `aria-label` — not for AT, but because it is the only handle
 * `MapUnitPopover.test.tsx` has to assert an amenity rendered (`getByLabelText`
 * at :219-222); the glyph itself carries no queryable text. Same icon grammar as
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
          <Icon aria-label={label} className="h-3 w-3" />
        </li>
      ))}
    </ul>
  )
}

/**
 * EVERY PERSON in the party, adults then children — the owner's ask on
 * kindred#2183: "who is housed where", not which household's label is on the
 * door.
 *
 * `namedAdults` rather than `party.adults`: `family_camp_adults` has five
 * fixed slots and leaves the unused ones blank rather than omitting them, so
 * the raw list renders nameless entries. Children are filtered the same way
 * for the same reason.
 *
 * Falls back to `partyIdentityLabel` when there is nobody named at all, which
 * is the one case where CampMinder's salutation is the only identity on file
 * — the same fallback, and the same reasoning, as `householdIdentity.ts`.
 */
function partyPeopleLabel(party: RosterPartyRow): string {
  const people = [
    ...namedAdults(party).map((adult) => adult.display_name ?? ''),
    ...(party.children ?? []).map((child) => child.display_name ?? ''),
  ].filter((name) => name.trim() !== '')
  if (people.length === 0) return partyIdentityLabel(party)
  return people.join(' · ')
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
      {partyPeopleLabel(party)}
    </button>
  ))
}

interface DetailCardProps {
  entry: MapUnit
  hue: string
  onOpenParty: (party: RosterPartyRow) => void
  wholeBuildingKeys: Set<string>
}

function DetailCard({ entry, hue, onOpenParty, wholeBuildingKeys }: DetailCardProps) {
  const { unit, parties, consent, capacity } = entry
  // `capacity`, NOT `unit.sleeps` (kindred#2183). They are the same number for
  // every ordinary room, and different for the one case this card could not
  // previously tell the truth about: a combined house's own `sleeps` is a
  // DELTA over its rooms (kindred#2041) — the landing futon — so reading it
  // raw understates a four-room house as sleeping one. The map draws such a
  // house as a single mark, so this lone card is exactly where that lands.
  const capacityKnown = capacity !== null
  const badge = reservationBadge(unit)
  const bedsNeeded = parties.reduce((sum, party) => sum + partyBeds(party), 0)

  // Only the ACTIONABLE levels. `unverified` is a live fallback for a cabin
  // nobody has confirmed yet, not the state of the whole registry — measured
  // against the production snapshot of 2026-08-06, cabins were 118/118
  // confirmed. Rendering `unverified` anyway would put a caveat on every
  // occupied room and stop being read. `partyAttention` owns the rule that
  // only a confirmed cabin is evidence.
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
  // ANY occupant, not the first: a shared room's second party could not
  // itself hold the whole building (holding every leaf leaves no room for
  // another household), but checking `some` rather than assuming
  // `parties[0]` keeps this from silently depending on array order.
  const holdsWholeBuilding = parties.some((party) => wholeBuildingKeys.has(partyKey(party)))

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
          <dd>{capacityKnown ? capacity : <em>unknown</em>}</dd>
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
            <dd className={bedsNeeded > capacity ? 'font-semibold text-amber-700' : ''}>
              {`${String(bedsNeeded)} of ${String(capacity)}`}
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
          come from `partyAttention` and never carry medical narrative. */}
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
      {(tags.length > 0 || holdsWholeBuilding) && (
        <ul className="flex flex-wrap gap-1">
          {/* Its own indigo/`Home` token, not pushed into `tags` above: those
              render as hue-coloured pills keyed to an AREA, and this fact is
              about the building, not about where the building sits. Same tags
              ROW, different token, on purpose.

              ⚠️ This used to justify itself against "the board's own indigo
              chip for the same fact", which kindred#2072 deleted — see
              `WholeBuildingBadge`'s doc above, which is the surviving account:
              the board's copy is STRUCK and this is the last one standing. Do
              not restore the chip on the card for consistency, and do not
              delete this one for having lost its twin. */}
          {holdsWholeBuilding && (
            <li>
              <WholeBuildingBadge />
            </li>
          )}
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
          room. The string is built by `consentReason` and carries no
          medical narrative. */}
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
 *
 * The non-empty `prefix` is now ALSO the building's name in the master
 * summary's heading and in its "← All of …" control (kindred#2183), which is
 * the same fact put to a second use — not a second derivation of it.
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

/**
 * One family's PEOPLE, wherever in the building they are — the summary's chip.
 *
 * Grouped by `partyKey` rather than by room, because a household placed across
 * two rooms of one house is still ONE family and listing it twice would say
 * two families are in the building. `flagged` is true when ANY of the rooms it
 * occupies carries a consent flag: the summary is the first thing read, and a
 * warning that only surfaced once you picked the right cell would be lost
 * exactly when it matters.
 */
interface SummaryFamily {
  party: RosterPartyRow
  flagged: boolean
}

function summaryFamilies(units: MapUnit[]): SummaryFamily[] {
  const out: SummaryFamily[] = []
  const byKey = new Map<string, SummaryFamily>()
  for (const entry of units) {
    for (const party of entry.parties) {
      const key = partyKey(party)
      const seen = byKey.get(key)
      if (seen) {
        seen.flagged = seen.flagged || entry.consent !== null
        continue
      }
      const record = { party, flagged: entry.consent !== null }
      byKey.set(key, record)
      out.push(record)
    }
  }
  return out
}

interface ClusterSummaryProps {
  units: MapUnit[]
  hue: string
  /** The building name the cells share, or '' for a cluster of unrelated cabins. */
  prefix: string
  onOpenParty: (party: RosterPartyRow) => void
  wholeBuildingKeys: Set<string>
}

/**
 * The MASTER half of the master-detail peek: what is true of the whole
 * building, in the same shape as the single-room card beside it.
 *
 * Every number here is aggregated over `MapUnit.roomCount` / `MapUnit.capacity`
 * rather than over the marks — a combined house is ONE drawn unit standing for
 * several rooms, and counting marks would report it as one room. Those two
 * fields exist for exactly this reason and are computed in `buildMapModel`,
 * which is the only place with the registry needed to walk a house's rooms.
 */
function ClusterSummary({
  units,
  hue,
  prefix,
  onOpenParty,
  wholeBuildingKeys,
}: ClusterSummaryProps) {
  const rooms = units.reduce((total, entry) => total + entry.roomCount, 0)
  // A drawn unit is taken as a WHOLE: a family holding a combined house holds
  // every room in it, which is what "combined" means.
  const taken = units.reduce(
    (total, entry) => total + (entry.parties.length > 0 ? entry.roomCount : 0),
    0
  )
  // ONE unmeasured room leaves the building total unknown — a partial sum
  // understates capacity silently, which is worse than saying nothing.
  const capacities = units.map((entry) => entry.capacity)
  const capacity = capacities.some((value) => value === null)
    ? null
    : capacities.reduce((total: number, value) => total + (value ?? 0), 0)
  const families = summaryFamilies(units)
  // OVER THE DEDUPED FAMILIES, never over `units.flatMap(parties)`. A party
  // holding two rooms is deliberately attached to BOTH of them by
  // `indexPayload` — "A party holding several rooms appears on each of them",
  // which is what stops the second room rendering empty — so the flat list
  // counts its beds once per door, and can print more placed than the
  // building sleeps. One chip, one household, one bed total.
  const placed = families.reduce((total, { party }) => total + partyBeds(party), 0)

  return (
    <div className="flex min-w-[11rem] flex-col gap-1.5">
      <h4 className="text-xs font-bold" style={{ color: hue }}>
        {prefix === '' ? `${String(rooms)} rooms` : prefix}
      </h4>
      <dl className="flex flex-col gap-0.5 text-xs">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Rooms</dt>
          <dd>{`${String(rooms)} · ${String(taken)} taken, ${String(rooms - taken)} open`}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Sleeps</dt>
          <dd>
            {capacity === null ? (
              <em>unknown</em>
            ) : (
              `${String(capacity)} · ${String(placed)} placed`
            )}
          </dd>
        </div>
      </dl>

      {/* A BLOCK, not a right-aligned `dd`: a chip naming four people needs the
          popover's full width, and wrapping it into a 6rem column would put one
          name per line. */}
      <div className="flex flex-col gap-1">
        <span className="text-muted-foreground text-xs">Occupied by</span>
        {families.length === 0 ? (
          <em className="text-muted-foreground text-xs">empty</em>
        ) : (
          <ul className="flex flex-col gap-1">
            {families.map(({ party, flagged: notConsented }) => (
              <li key={partyKey(party)}>
                <button
                  data-testid="map-popover-family"
                  type="button"
                  onClick={() => {
                    onOpenParty(party)
                  }}
                  style={{ borderColor: notConsented ? CONSENT_AMBER : hue }}
                  className="bg-card hover:bg-muted/60 flex w-full flex-col items-start gap-0.5 rounded-md border px-1.5 py-1 text-left"
                >
                  <span className="flex items-center gap-1">
                    <span className="text-foreground text-[11px] font-semibold">
                      {partyPeopleLabel(party)}
                    </span>
                    {/* kindred#2174: the same fact as the DetailCard's tags-row
                        badge, on the OTHER surface the ruling named — this
                        family's chip, not the cluster mark or a new ring. */}
                    {wholeBuildingKeys.has(partyKey(party)) && <WholeBuildingBadge />}
                  </span>
                  {/* SAID IN WORDS. The amber border alone would be colour as
                      the sole signal (WCAG 1.4.1), and this chip is the only
                      place the flag appears before a room is picked. */}
                  {notConsented && (
                    <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
                      {CONSENT_PHRASE}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

interface FootprintGridProps {
  units: MapUnit[]
  hue: string
  /** Per-room labels with the shared building name stripped, from the parent. */
  shortNames: string[]
  selectedUnitId: string | null
  onSelectUnit: (unitId: string) => void
}

/**
 * The DETAIL half's picker: the building's footprint, one cell per room.
 *
 * A cell now SELECTS its room rather than opening the occupant's panel — the
 * panel is one step further in, off the room card's own occupant chips. The
 * cluster header this used to carry moved up into `ClusterSummary`, which
 * always sits above it; two headers saying "3 rooms · 1 taken" a few pixels
 * apart is noise in a 15rem popover.
 */
function FootprintGrid({
  units,
  hue,
  shortNames,
  selectedUnitId,
  onSelectUnit,
}: FootprintGridProps) {
  const columns = Math.ceil(Math.sqrt(units.length))

  return (
    <div className="flex flex-col gap-1.5">
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
          // Prefixed by the visible label so an accessible name built from it
          // still contains the label (WCAG 2.5.3). It used to be duplicated
          // into `title` as well, because a native tooltip is invisible to
          // touch and unreliable for screen readers — kindred#2177 replaced
          // that with `ui/Tooltip`, which is neither.
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
              </div>
            )
          }

          return (
            <Tooltip
              key={entry.unit.unit_id}
              data-testid="map-popover-cell"
              content={described}
              // `aria-label` KEPT alongside the bubble, and it is the one place
              // in this sweep where the sentence is deliberately said twice.
              // The cell's visible label is a family name, which the detail
              // pane below repeats as its own chip — without this, two controls
              // in one popover answer to "Sofia Garcia" and neither says which
              // room it is. Name disambiguates, bubble explains.
              aria-label={described}
              // PICKS the room; it no longer opens the family panel directly.
              // `aria-pressed` because that is what this control now is — a
              // toggle into the detail below, not a link out of the popover.
              aria-pressed={selectedUnitId === entry.unit.unit_id}
              // The cell keeps its own action — the bubble is already open
              // from the hover or focus the tap produced, so a tap must not be
              // spent pinning it.
              onActivate={() => {
                onSelectUnit(entry.unit.unit_id)
              }}
              style={style}
              className={className}
            >
              {label}
            </Tooltip>
          )
        })}
      </div>
    </div>
  )
}

export function MapUnitPopover({
  units,
  hue,
  onOpenParty,
  wholeBuildingKeys = NO_WHOLE_BUILDING_HOLDERS,
}: MapUnitPopoverProps) {
  // LOCAL and nothing leaves the popover: which room of a container is being
  // read is not a fact the map, the board or the URL has any use for.
  const [pickedUnitId, setPickedUnitId] = useState<string | null>(null)

  const { names: shortNames, prefix } = distinguishingNames(units)
  // DERIVED from the current props every render, never trusted from state.
  // This popover is reconciled by POSITION — `LodgingMap` renders it inside an
  // unkeyed wrapper — so a roster refetch or a pan that dissolves this cluster
  // and opens another reuses the same component instance. Looking the id up in
  // THIS render's units is what stops a room from staying picked under a pin
  // that no longer contains it; the same latch shape as `LodgingMap`'s
  // pinned/dwell keys (kindred#2137 bug 4).
  const picked = units.find((entry) => entry.unit.unit_id === pickedUnitId) ?? null
  // And DROPPED, not merely ignored, the moment it stops resolving. Falling
  // back to the summary is only half the latch: the id would still be in state
  // when the original cluster came back — pin A, pin B, pin A — and the room
  // card would reappear under a click that only asked for the building.
  // Cleared right here during render rather than in an Effect, the same shape
  // and for the same reason as `LodgingMap`'s pinned/dwell keys.
  if (pickedUnitId !== null && picked === null) setPickedUnitId(null)

  if (units.length === 0) return null

  const lone = units[0]
  return (
    <div
      data-map-popover
      style={{ borderColor: hue }}
      className="bg-card shadow-lodge-sm max-w-[15rem] rounded-xl border-2 p-2"
    >
      {units.length === 1 && lone ? (
        <DetailCard
          entry={lone}
          hue={hue}
          onOpenParty={onOpenParty}
          wholeBuildingKeys={wholeBuildingKeys}
        />
      ) : (
        <div className="flex flex-col gap-2">
          {picked === null ? (
            <ClusterSummary
              units={units}
              hue={hue}
              prefix={prefix}
              onOpenParty={onOpenParty}
              wholeBuildingKeys={wholeBuildingKeys}
            />
          ) : (
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setPickedUnitId(null)
                }}
                className="text-muted-foreground hover:text-foreground self-start text-[11px] font-semibold underline-offset-2 hover:underline"
              >
                {prefix === '' ? '← All rooms' : `← All of ${prefix}`}
              </button>
              <DetailCard
                entry={picked}
                hue={hue}
                onOpenParty={onOpenParty}
                wholeBuildingKeys={wholeBuildingKeys}
              />
            </div>
          )}
          <FootprintGrid
            units={units}
            hue={hue}
            shortNames={shortNames}
            selectedUnitId={picked?.unit.unit_id ?? null}
            onSelectUnit={setPickedUnitId}
          />
        </div>
      )}
    </div>
  )
}
