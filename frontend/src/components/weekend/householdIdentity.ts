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
 * Tokens a registrant types into an unused `family_camp_adults` slot instead
 * of leaving it empty (kindred#1925).
 *
 * MIRRORED IN PYTHON -- `api/constants/lodging.py` holds the same list and
 * uses it to compute `party_size`. `tests/unit/api/test_lodging_constants.py`
 * greps this declaration and fails if the two drift, so adding a token needs
 * both edits. That pairing is the point: excluding a name from the count
 * while still printing it on the card is the disagreement this exists to
 * prevent.
 *
 * WHOLE-VALUE tokens, compared after trimming and lowercasing. Never a
 * substring test -- "Nona" and "Noor" are names.
 */
export const ADULT_NAME_PLACEHOLDERS = new Set(['na', 'n/a', 'none', '-', '0', 'no'])

/**
 * Whether a `family_camp_adults` name is a real attending adult.
 *
 * Blank is the ordinary case: the scrape has five fixed slots and leaves the
 * unused ones empty rather than omitting the row. A placeholder is the case
 * that used to slip through, because `'NA'.trim()` is truthy -- measured on
 * 2026's 382 rostered households, two such rows were being printed on the
 * board, so staff were reading an adult called "NA".
 */
export function isAttendingAdultName(name: string | null | undefined): boolean {
  const token = name?.trim() ?? ''
  return token.length > 0 && !ADULT_NAME_PLACEHOLDERS.has(token.toLowerCase())
}

/**
 * The attending adults on a household party -- `FamilyCard`'s own filter,
 * extracted verbatim. `[]` for a person-grain party, which has no separate
 * adult list to show (its identity is its own `display_name`).
 *
 * A slot with no name on file is not an attending adult -- CampMinder's
 * `family_camp_adults` leaves it blank rather than omitting the row -- and
 * neither is a slot holding a placeholder.
 */
export function attendingAdults(party: RosterPartyRow): PartyAdultRow[] {
  if (party.grain !== 'household') return []
  return (party.adults ?? []).filter((adult) => isAttendingAdultName(adult.display_name))
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
 * `party.adults`, with any blank or placeholder `family_camp_adults` slot
 * dropped -- for every OTHER place that lists or counts a party's adults, not
 * just the identity label.
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
  return (party.adults ?? []).filter((adult) => isAttendingAdultName(adult.display_name))
}

/**
 * The headcount to print beside a party's own name/adult list -- the number
 * of adults and children actually NAMED, never `party.party_size`
 * (kindred#2152).
 *
 * `party_size` became a BED count under kindred#1925/#2046: the server drops
 * blank and placeholder adult slots from it AND discounts a child under 18
 * months at session start, so it legitimately diverges from the names on the
 * card -- `boardLayout.partySize` and `rosterAttention.partyBeds` both need
 * that bed number for the fit check. A badge sitting next to the printed
 * list needs the OTHER number: whatever this function returns, so it can
 * never disagree with the names underneath it.
 *
 * kindred#1946's nameless-row cleanup runs on the next successful derived
 * sync, not on merge -- the rows this excludes are still live in `adults`
 * today, which is exactly why the filtering has to happen here rather than
 * being trusted to have already happened upstream.
 *
 * `namedAdults`, NOT the grain-gated `attendingAdults` -- deliberately, and
 * do not "make them consistent". A person-grain party (an adult weekend
 * guest) carries exactly one adult entry, its own name, which the card and
 * panel both print; `attendingAdults` returns `[]` for that grain, so
 * swapping it in here would silently render a 0 badge on every adult-weekend
 * card. The person-grain test in `householdIdentity.test.ts` pins this.
 *
 * Every child is counted because every child is PRINTED: `FamilyCard`'s
 * `ChildList` renders a nameless child as "Unnamed camper" rather than
 * dropping it, so there is no child-side equivalent of the blank adult slot
 * to filter. If that fallback ever goes, this count has to filter too.
 */
export function partyHeadcount(party: RosterPartyRow): number {
  return namedAdults(party).length + (party.children?.length ?? 0)
}
