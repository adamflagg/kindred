/**
 * The household's identity where the deleted salutation used to stand.
 *
 * `FamilyCard.tsx` already builds this exact list (kindred#2074) -- the
 * household's adults who are actually attending, filtered from
 * `family_camp_adults`'s five fixed slots down to the ones with a name on
 * file. This module extracts that construction so the four non-card
 * surfaces (`FamilyDetailsPanel`, `HouseholdRosterRow`, `MapUnitPopover`,
 * `FloatingUnplacedBadge` -- kindred#2084) read the SAME identity the card
 * does, rather than falling back to `party.display_name` -- CampMinder's
 * `mailing_title`, which disagreed with the real adult list on 26.7% of
 * 2026's 382 rostered households, in both directions. Two sources for one
 * household's name is exactly what this extraction is for.
 *
 * Household-grain only. A person-grain party (an adult weekend guest) IS
 * its own identity -- `display_name` stays for it, unchanged, both here and
 * on the card.
 */
import type { PartyAdultRow, RosterPartyRow } from '../../types/lodging'

/**
 * The attending adults on a household party -- `FamilyCard`'s own filter,
 * extracted verbatim. `[]` for a person-grain party, which has no separate
 * adult list to show (its identity is its own `display_name`).
 *
 * A slot with no name on file is not an attending adult -- CampMinder's
 * `family_camp_adults` leaves it blank rather than omitting the row.
 */
export function attendingAdults(party: RosterPartyRow): PartyAdultRow[] {
  if (party.grain !== 'household') return []
  return (party.adults ?? []).filter((adult) => Boolean(adult.display_name?.trim()))
}

/**
 * The household's identity as one string, for surfaces that need plain text
 * rather than a list of names -- a heading, an aria-label, a table cell, a
 * sort key.
 *
 * Falls back to `party.display_name` only when there is NO attending adult
 * to name -- an empty `family_camp_adults` scrape, not a malformed
 * salutation. Every household kindred#2084 measured as malformed HAS a
 * non-empty attending-adult list, so this fallback never resurrects the
 * string being replaced; it only covers the disjoint case of a household
 * with nothing to show at all.
 *
 * A person-grain party always uses its own `display_name` -- it IS the
 * identity, not a salutation over one.
 */
export function partyIdentityLabel(party: RosterPartyRow): string {
  if (party.grain !== 'household') return party.display_name ?? ''
  const adults = attendingAdults(party)
  if (adults.length === 0) return party.display_name ?? ''
  return adults.map((adult) => adult.display_name ?? '').join(' · ')
}

/**
 * `party.adults`, with any blank `family_camp_adults` slot dropped -- for
 * every OTHER place that lists or counts a party's adults, not just the
 * identity label.
 *
 * Unlike `attendingAdults`, this is NOT gated to household grain: a
 * person-grain party's single adult entry (`_build_person_parties` gives it
 * exactly one, the guest's own name) is real, never a blank slot to drop, so
 * filtering it is safe and correct for both grains alike. Scan finding on
 * kindred#2084: `HouseholdRosterRow`'s `composition()` count and its members
 * line, and `FamilyDetailsPanel`'s Party section, all read `party.adults`
 * raw -- inflating a headcount and rendering a nameless list item for a
 * blank slot, right beside an identity label that already filters it out.
 */
export function namedAdults(party: RosterPartyRow): PartyAdultRow[] {
  return (party.adults ?? []).filter((adult) => Boolean(adult.display_name?.trim()))
}
