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
import type { PartyAdultRow, PartyChildRow, RosterPartyRow } from '../../types/lodging'

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
 * Text a staff member might type to find this party.
 *
 * Children and adults both, so a household can be found by whoever the staff
 * member happens to remember. The LEADING element is `partyIdentityLabel`,
 * the same identity the card shows (kindred#2084) -- `display_name` is
 * CampMinder's `mailing_title` salutation, which disagreed with the real
 * attending-adult list on 26.7% of 2026's rostered households, and a search
 * that still matched it would resurrect wording the card deliberately
 * stopped showing.
 *
 * ONE construction, shared, for the same reason the identity label above is
 * shared: `FloatingUnplacedBadge`'s queue and the unit card's placement
 * picker (kindred#2080) search the SAME list of unplaced parties. Two copies
 * that drifted would leave a household findable in one and not the other.
 */
export function partySearchText(party: RosterPartyRow): string {
  return [
    partyIdentityLabel(party),
    ...(party.adults ?? []).map((adult) => adult.display_name ?? ''),
    ...(party.children ?? []).map((child) => child.display_name ?? ''),
  ].join(' ')
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
 * card -- `boardLayout.partySize` and `rosterAttention.partySpots` both need
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

/**
 * The distinct surnames of a party's children, in the order they arrive.
 *
 * ★ THE DERIVATION LIVES HERE AND NOWHERE ELSE (kindred#2180). The card, the
 * details panel and kindred#2073's year-over-year household heading all name
 * a family from this one function. Two implementations of a naming rule
 * drift, and the drift is invisible: both look right in isolation.
 *
 * ⚠️ **A HYPHENATED SURNAME IS ONE NAME.** 72 of 2026's 680 distinct
 * rostered children carry one (measured 2026-08-09). The dedupe is on the
 * WHOLE string -- never on hyphen parts, and never on whitespace tokens
 * either: 32 of those children have a `last_name` that itself contains a
 * space. "Garcia-Lopez" is one surname; a household of Garcia-Lopez children
 * is "The Garcia-Lopez Family", never "The Garcia & Lopez Family".
 *
 * Reads `child.last_name`, the structured column, NOT the trailing token of
 * `display_name` -- `_person_display_name` builds that string as
 * `preferred_or_first + ' ' + last_name`, so splitting it back apart is the
 * wrong surname for those same 32 children (4.7%). kindred#2180 put
 * `last_name` on the wire for exactly this reason; do not "simplify" it back
 * out.
 *
 * Case-insensitive dedupe, first-seen casing kept -- CampMinder holds the
 * casing a parent typed, and two spellings of one surname are one family.
 * Blank surnames are dropped rather than becoming an empty name in the list.
 *
 * Takes the child rows rather than a party so kindred#2073 can pass the
 * UNION across years, which is what its heading spans.
 */
export function childSurnames(children: readonly PartyChildRow[] | null | undefined): string[] {
  return distinctSurnames((children ?? []).map((child) => child.last_name ?? ''))
}

/**
 * Trim, drop the blanks, and keep the first spelling of each surname.
 *
 * Shared by `childSurnames` and `familyNameLabel` rather than living only in
 * the former, because `familyNameLabel` is exported for kindred#2073, whose
 * heading takes the UNION of a household's surnames across years. A union
 * assembled by concatenating per-year lists holds the same surname once per
 * year -- and in whatever casing each year's CampMinder record was typed in.
 * Normalising in one place is what makes `familyNameLabel` idempotent, so
 * that caller cannot print "The Johnson & johnson Family".
 */
function distinctSurnames(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const surnames: string[] = []
  for (const value of values) {
    const surname = value.trim()
    if (surname.length === 0) continue
    const key = surname.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    surnames.push(surname)
  }
  return surnames
}

/**
 * Surnames as the household's name: `The Johnson Family`,
 * `The Johnson & Garcia Family`, `The Johnson, Garcia & Nguyen Family`.
 *
 * The 3+ form is REQUIRED, not defensive. One of 2026's 382 rostered
 * households already has three distinct child surnames (374 single / 7
 * double / 1 triple, measured 2026-08-09), and kindred#2073's heading takes
 * the UNION across years, which goes higher again. Do not special-case it
 * away into "and 2 others".
 *
 * Empty for no surnames -- "The Family" names nobody. Callers that need
 * something to print fall back; see `partyFamilyLabel`.
 *
 * Normalises its own input through `distinctSurnames` rather than trusting
 * the caller to have done it. `childSurnames` already has, so that path is a
 * no-op -- but kindred#2073 passes the cross-year UNION, and a union built by
 * concatenating per-year lists repeats every surname once per year. This is
 * the difference between "The Johnson Family" and
 * "The Johnson, johnson & Johnson Family" on a four-year household.
 */
export function familyNameLabel(surnames: readonly string[]): string {
  const distinct = distinctSurnames(surnames)
  if (distinct.length === 0) return ''
  const joined =
    distinct.length === 1
      ? (distinct[0] ?? '')
      : `${distinct.slice(0, -1).join(', ')} & ${distinct[distinct.length - 1] ?? ''}`
  return `The ${joined} Family`
}

/**
 * One household party's family name, for a single weekend.
 *
 * Falls back to `partyIdentityLabel` -- the attending adults, and beneath
 * them the salutation -- when no child on the party carries a surname, so a
 * party with no enrolled children still has something to print. It never
 * falls back to a name derived from the ADULTS' surnames:
 * `family_camp_adults.last_name` is empty on every 2026 row and on every row
 * from 2017-2021, which is precisely why the children are the source.
 *
 * A person-grain party (an adult weekend guest) is not a family and keeps
 * its own name.
 */
export function partyFamilyLabel(party: RosterPartyRow): string {
  if (party.grain !== 'household') return partyIdentityLabel(party)
  const label = familyNameLabel(childSurnames(party.children))
  return label.length > 0 ? label : partyIdentityLabel(party)
}

/**
 * A run of names with the surname they all share lifted out, so a card can
 * print it once at the end of the line instead of on every name
 * (kindred#2180).
 */
export interface DedupedNameRun {
  /** One entry per person, index-aligned with the input, surname removed. */
  names: string[]
  /** The surname to print once after the run, or `''` when none is shared. */
  sharedSurname: string
}

/**
 * Splits `display_name` into what precedes `surname`, or `null` when the
 * name does not end in that surname or consists of nothing else.
 *
 * The `null` on "the name IS the surname" is load-bearing: lifting the
 * surname off "Johnson" leaves an empty segment, and the card would render a
 * bare separator. Case-insensitive, because CampMinder holds whatever casing
 * was typed and two spellings are one name.
 */
function nameBeforeSurname(displayName: string, surname: string): string | null {
  const name = displayName.trim()
  const suffix = surname.trim()
  if (suffix.length === 0 || name.length <= suffix.length) return null
  if (name.slice(-suffix.length).toLowerCase() !== suffix.toLowerCase()) return null
  const head = name.slice(0, -suffix.length).trimEnd()
  return head.length > 0 ? head : null
}

/**
 * @param minimum How many names it takes before the surname is worth lifting.
 *   `1` for children and `2` for adults, and the difference is the strength of
 *   the signal rather than a taste: a child's surname is the structured
 *   `last_name` field, an adult's is a guessed trailing token.
 */
function dedupedRun(
  displayNames: readonly string[],
  surname: string,
  minimum: number
): DedupedNameRun {
  const unchanged: DedupedNameRun = { names: [...displayNames], sharedSurname: '' }
  if (displayNames.length < minimum || surname.length === 0) return unchanged
  const heads: string[] = []
  for (const name of displayNames) {
    const head = nameBeforeSurname(name, surname)
    if (head === null) return unchanged
    heads.push(head)
  }
  return { names: heads, sharedSurname: surname }
}

/**
 * The children of a party as one run, with the surname printed once at the
 * end (kindred#2180).
 *
 * Driven by the structured `last_name`, so a multi-word or hyphenated
 * surname is lifted WHOLE. Nothing is lifted unless every child carries the
 * same surname and every one has something in front of it: a household whose
 * children have two surnames has nothing to factor out, and one whose only
 * child IS the surname would be left with a bare age.
 *
 * ⚠️ ONE CHILD IS ENOUGH, AND IT WAS NOT UNTIL 2026-08-20. kindred#2180 set
 * the floor at two on the argument that "a single child shares nothing with
 * anybody" -- so an only child read `Ava Johnson (5)` while a pair read
 * `Ava (5) · Liam (8) Johnson`. The owner ruled the floor down to one, and
 * the reason is what the lift is FOR on this board: it is not deduplication
 * for its own sake, it puts the AGE immediately after the first name, which
 * is the pair staff read when they are matching families by how old the
 * children are. A surname sitting between them costs the same on a household
 * with one child as on a household with three, and the approved design
 * artifact drew `Isla (3) Nguyen` throughout.
 *
 * The floor stays at two for ADULTS -- see `dedupeAdultNames`, whose surname
 * is a guessed trailing token rather than a field.
 */
export function dedupeChildNames(
  children: readonly PartyChildRow[] | null | undefined
): DedupedNameRun {
  const rows = children ?? []
  const displayNames = rows.map((child) => child.display_name ?? '')
  const surnames = childSurnames(rows)
  // Every child must carry the ONE surname -- `childSurnames` drops blanks,
  // so a single distinct surname does not by itself mean every child has it.
  const shared = surnames[0]
  if (
    surnames.length !== 1 ||
    shared === undefined ||
    rows.some((child) => (child.last_name ?? '').trim().length === 0)
  ) {
    return { names: displayNames, sharedSurname: '' }
  }
  // ONE child is enough (owner, 2026-08-20) -- see this function's doc.
  return dedupedRun(displayNames, shared, 1)
}

/**
 * The same treatment for the grey adult line -- but on a MATERIALLY WEAKER
 * signal, and deliberately not the children's rule (kindred#2180).
 *
 * An adult has no structured surname to read: `family_camp_adults.last_name`
 * is empty on every 2026 row, so `display_name` is the free-text `name` a
 * parent typed. All this can do is compare the trailing whitespace token.
 * Measured on production 2026-08-09: of the 340 rostered 2026 households
 * with two or more named adults, only 135 (39.7%) have all adults sharing
 * one, and printing the other 205 unchanged is the correct outcome.
 *
 * Pass the FILTERED adults (`attendingAdults` / `namedAdults`) -- a blank or
 * placeholder slot has no trailing token and would suppress every dedupe.
 */
export function dedupeAdultNames(adults: readonly PartyAdultRow[]): DedupedNameRun {
  const displayNames = adults.map((adult) => (adult.display_name ?? '').trim())
  if (displayNames.length < 2) return { names: displayNames, sharedSurname: '' }
  const tokens = displayNames.map((name) => name.split(/\s+/))
  // A one-token name has nothing in front of its "surname" to keep.
  if (tokens.some((parts) => parts.length < 2)) return { names: displayNames, sharedSurname: '' }
  const trailing = tokens.map((parts) => parts[parts.length - 1] ?? '')
  const first = trailing[0] ?? ''
  // NOT redundant with `dedupedRun`'s own check below, and it is the word
  // boundary this rule has. `nameBeforeSurname` asks only whether a name ENDS
  // WITH the surname string -- safe for the children, whose `display_name` is
  // built as `first + ' ' + last_name`, but not for an adult's free text:
  // "Olivia MacJohnson" ends with "Johnson", and without this the line would
  // read "Olivia Mac · Noah Johnson". `householdIdentity.test.ts` pins it.
  if (trailing.some((token) => token.toLowerCase() !== first.toLowerCase())) {
    return { names: displayNames, sharedSurname: '' }
  }
  // TWO, and never one: a lone adult's "surname" here is only the last word
  // of free text, so lifting it off would print a first name and a guess.
  return dedupedRun(displayNames, first, 2)
}

/**
 * Youngest-first display order for one party's children (kindred#2254).
 *
 * A COPY, never the input array sorted in place: `party.children` is the
 * frontend's own copy of the server's `_children_oldest_first` -- the order
 * `lodging_roster_service.py` computes once and every surface prints in --
 * and `FamilyCardIdentity` reads it twice (the bold line and the grey line
 * render from the SAME `children` array). Sorting in place on the first
 * render would leave the second render, and any sibling component still
 * holding that reference, reading an order nobody asked it to have.
 *
 * Unknown age (`null` -- this field's already-converted form of the raw
 * `0.0` sentinel the API collapses before the wire, kindred#2088) is not a
 * fact about how young a child is, so it cannot take part in the comparison
 * at all. A comparator naive enough to do `(a.age ?? 0) - (b.age ?? 0)`
 * coerces it to 0 and sorts it FIRST under an ascending youngest-first order
 * -- the exact opposite of the intent, and wrong in a way that looks right.
 * Unknown-age children go in their own trailing bucket instead, in their
 * original relative order (`Array.sort` is stable, so ties within the
 * known-age bucket keep theirs too) -- the same place the server's own
 * descending sort already puts them, since its raw-float sentinel sorts last
 * there too.
 *
 * ⚠️ MOVED HERE FROM `FamilyCard.tsx` (kindred#2072 §3.5). It is half of the
 * children-run below, and the run now has two callers.
 *
 * NOT exported: `childrenRun` is the only thing that should order children,
 * because ordering and dedupe have to see the same array — the surname lift
 * reads index-for-index against the sorted order. A second caller sorting on
 * its own is how the two would drift apart again.
 */
function youngestFirst(children: readonly PartyChildRow[]): PartyChildRow[] {
  const known: PartyChildRow[] = []
  const unknown: PartyChildRow[] = []
  for (const child of children) {
    ;(child.age === null || child.age === undefined ? unknown : known).push(child)
  }
  known.sort((a, b) => (a.age as number) - (b.age as number))
  return [...known, ...unknown]
}

/** One child's printed segment, plus a React key the card can render with. */
export interface ChildRunSegment {
  readonly key: string
  readonly text: string
}

export interface ChildRun {
  readonly segments: readonly ChildRunSegment[]
  /** A surname every child shares, printed ONCE after the run. `''` if none. */
  readonly sharedSurname: string
}

/**
 * ★ A PARTY'S CHILDREN AS ONE RUN, AND THE DERIVATION LIVES HERE ONLY.
 *
 * `Ava (5) · Liam (8) Johnson` -- youngest first, the age omitted when it is
 * not known, a blank name named rather than left empty, and a surname every
 * child shares lifted off the individual names and printed once
 * (kindred#2180).
 *
 * ⚠️ TWO SURFACES DRAW THIS, WHICH IS WHY IT IS NOT IN `FamilyCard.tsx`.
 * The family card's bold identity line renders it as JSX (`ChildList`), and
 * the Assign modal's candidate rows print it as text -- the owner ruled
 * 2026-08-20 that the modal's row identity is the CHILDREN, reversing the
 * `partyIdentityLabel` reading that PR #2506 shipped with and flagged.
 *
 * The reason the modal did NOT simply copy the run is the whole argument for
 * this function: `MapUnitPopover` once hand-reproduced `FamilyCard`'s
 * `Whole building` chip -- "same label, same tokens, same icon", with a
 * comment admitting the copy -- and the two drifted. Every decision inside
 * this run (the ordering, the unknown-age bucket, the omitted age, the
 * blank-name fallback, the lifted surname) is made once, here.
 *
 * SEGMENTS rather than a string, because the card wants one element per
 * child and the modal wants text. `childrenRunLabel` builds the text from
 * these, so the two can never disagree about the separator either.
 *
 * @param formatAge `displayTruncatedAge` on the card's bold line and in the
 *   modal (whole years are the point of a similar-ages match),
 *   `displayCampMinderAge` on the card's grey person-grain line.
 */
export function childrenRun(
  children: readonly PartyChildRow[] | null | undefined,
  formatAge: (age: number) => string
): ChildRun {
  const ordered = youngestFirst(children ?? [])
  // Fed the ALREADY-SORTED order, not the raw prop, so the names returned
  // line up index-for-index with what actually renders.
  const { names, sharedSurname } = dedupeChildNames(ordered)
  const segments = ordered.map((child, index) => {
    // A blank name (no first/preferred/last name on file --
    // `_person_display_name` has no fallback the way `_household_display_name`
    // does) falls back rather than leaving this segment, or the whole card
    // when it is the only child, with no text at all.
    //
    // `||` AND NOT `??`, deliberately: the value being guarded is `''`, not
    // `undefined`. `dedupeChildNames` returns `child.display_name ?? ''`, so a
    // nameless child arrives as an empty string and `??` would let it through.
    // Carried over unchanged from `FamilyCard`'s `ChildList`.
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
    const name = names[index] || 'Unnamed camper'
    return {
      // The index is the fallback rather than the name: two nameless,
      // id-less children in one household would otherwise collide on one key.
      key: String(child.person_cm_id ?? index),
      // An age we do not have is omitted, never rendered as 0.
      text:
        child.age === null || child.age === undefined ? name : `${name} (${formatAge(child.age)})`,
    }
  })
  return { segments, sharedSurname }
}

/**
 * The same run as plain text, for a surface that cannot render elements --
 * the Assign modal's candidate row, which sits inside a truncating span.
 *
 * `''` for a party with no children, which is the signal a caller falls back
 * on (`AssignFamilyModal` falls back to `partyIdentityLabel`, the identity a
 * person-grain adult-weekend guest has).
 */
export function childrenRunLabel(
  children: readonly PartyChildRow[] | null | undefined,
  formatAge: (age: number) => string
): string {
  const { segments, sharedSurname } = childrenRun(children, formatAge)
  if (segments.length === 0) return ''
  const run = segments.map((segment) => segment.text).join(' · ')
  return sharedSurname.length > 0 ? `${run} ${sharedSurname}` : run
}
