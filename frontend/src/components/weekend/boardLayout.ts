/**
 * The board's layout, as a pure function over the roster payload.
 *
 * A unit is a SLOT, not a column. A summer bunk column is tall because it
 * holds 10–14 campers; a lodging unit holds nothing, one party, or — 3 times
 * in 2026 — two parties who agreed to share. 82 rooms cannot be 82 columns,
 * so the board is a wrapping grid of small cards and the arrangement work is
 * all here rather than in JSX.
 *
 * Two invariants this file exists to hold:
 *
 * 1. **A tree draws at its resolved level, never both.** `unitLevel.ts`
 *    (`drawnUnits`) decides that level: a non-combined container never gets a
 *    card, because its halves already report the beds; a combined one draws
 *    ITS OWN row instead of its rooms, so the card carries the measured
 *    whole-house `sleeps` rather than a summed one. A placement naming a code
 *    at the WRONG level — a room whose building is combined, or a container
 *    whose board is split — is mapped onto whatever card currently represents
 *    it (`cardCodesFor`): rolled up to the drawn ancestor, or fanned down to
 *    the drawn DESCENDANTS (`representingCodes`, which stops at the first drawn
 *    node rather than running on to the raw leaves — otherwise a combined
 *    intermediate leaves the fan-down with nothing drawable to land on).
 *
 *    So: nobody falls off the board because of which level they were named at,
 *    with ONE honest exception — a container that has nothing drawable beneath
 *    it at all. There is no card to name, and inventing one would be worse; see
 *    invariant 2.
 * 2. **No party is ever dropped.** A party can be placed somewhere the board
 *    structurally cannot draw. Three ways that happens, not two:
 *
 *    - a unit absent from the payload;
 *    - a merge whose every room is missing;
 *    - a CONTAINER with no drawable rooms — childless (expected workflow: a
 *      building created before its rooms are reparented under it,
 *      owner-confirmed in `unitLevel.ts`), or one whose every room fell out of
 *      the payload.
 *
 *    Those go to `offBoard`, never to the unplaced corner queue (they ARE
 *    placed) and never to nowhere. `buildBoard` is total: every input party
 *    comes out in exactly one of slots / unplaced / offBoard.
 *
 *    "Exactly one" is about the CATEGORY, not the slot. A party holding several
 *    rooms is drawn on each of them, which is why an area's family count reads
 *    distinct `partyKey`s rather than slot entries.
 */
import type {
  LodgingUnitRow,
  RosterPartyRow,
  ShareEligibilityValue,
  ShareRequest,
  SharePreferenceValue,
} from '../../types/lodging'
import { partyHeadcount } from './householdIdentity'
import { partyKey } from './partyKey'
import {
  buildingsSpanned,
  coveredCodes,
  drawnUnits,
  representingCodes,
  wholeBuildingHeld,
} from './unitLevel'

/**
 * The leaf codes a party currently occupies.
 *
 * `unit_codes` is the authority — it is the only field that survives a
 * multi-room placement, where `unit_code` is deliberately `''`. The fallback
 * exists for a payload predating that field rather than as a second opinion.
 *
 * Lives here, beside the grouping that consumes it, because `dragPlacement`
 * reads it too and two answers would let the board draw one thing while a drop
 * resolved against another.
 */
export function occupiedCodes(party: RosterPartyRow): string[] {
  const codes = party.unit_codes ?? []
  if (codes.length > 0) return codes
  const single = party.unit_code ?? ''
  return single.length > 0 ? [single] : []
}

/**
 * The LEAF codes a party occupies — `occupiedCodes` with every container
 * expanded to the rooms beneath it.
 *
 * `occupiedCodes` returns the codes a placement NAMED, and a placement may name
 * a building. A party on a building occupies every room in it, so it genuinely
 * shares a room with a party named at any one of them — but comparing the raw
 * strings puts `'house'` beside `'r1'` and finds no intersection. That is not a
 * merge-only case: with the building SPLIT, the container party fans down onto
 * `r1` and the two are drawn in the same slot, unflagged.
 *
 * A code the payload has no unit for stays as ITSELF rather than being dropped.
 * It is not knowably a container, and dropping it would stop two parties naming
 * one unknown code from overlapping — failing permissive, the direction this
 * whole surface exists to close.
 */
function occupiedLeafCodes(
  party: RosterPartyRow,
  units: LodgingUnitRow[],
  unitsByCode: Map<string, LodgingUnitRow>
): Set<string> {
  // A Set, not an array: a party naming BOTH a container and one of its rooms
  // expands to that room twice, and a duplicate would make the party its own
  // second occupant and flag it against itself.
  const leaves = new Set<string>()
  for (const code of occupiedCodes(party)) {
    const unit = unitsByCode.get(code)
    if (unit === undefined) {
      leaves.add(code)
      continue
    }
    for (const leaf of coveredCodes(unit, units)) leaves.add(leaf)
  }
  return leaves
}

/**
 * How many BEDS a party consumes.
 *
 * Beds, not bodies, since #1925 and #2046: the server drops blank and
 * placeholder `family_camp_adults` slots from the count, and discounts a
 * child under 18 months at session start. For the 24 households with an
 * infant this figure is deliberately one lower than the names printed beside
 * it — `slotOccupancy`, `partyBeds` and `bedsNeeded` all want beds, and the
 * card's own names-chip is #2152's to split out.
 *
 * ⚠️ TWO COPIES OF THIS READ, not one. This doc comment once claimed it was
 * "deliberately the single place it is read"; that was false when written and
 * cost #2046 a re-sweep, so it is worth stating the count exactly. The other
 * is `rosterAttention.partyBeds`, whose body is identical. Change one, change
 * both. (It said THREE until #2152: `FamilyDetailsPanel` held the third, and
 * that one turned out to want the PEOPLE number, not this one — it now calls
 * `partyHeadcount`. Deleting a copy by noticing it wanted a different number
 * is the only good way to lose one.)
 *
 * ⚠️ DO NOT COLLAPSE THIS INTO `partyHeadcount`. Only the FALLBACK arm is
 * shared. The reported `party_size` is a BED count and must survive: since
 * #1925/#2046 the server drops blank and placeholder adult slots from it AND
 * discounts a child under 18 months, so for a household with an infant it is
 * deliberately one BELOW the headcount. Making the two agree re-creates
 * exactly the bug #2152 fixed, while reading as a tidy-up. `boardLayout.test`
 * asserts both numbers on one infant party so the collapse fails loudly.
 *
 * A reported 0 means NOT STATED, not "nobody" — hence the fall back to the
 * people actually named. That 0 is newly reachable now that the server
 * discounts: a household whose only adult slot holds a placeholder and whose
 * only child is an infant reports zero beds. Recounting the bodies there
 * over-states, which is the safe direction on this surface — it reads as
 * "look at this", where 0 reads as "nothing here".
 *
 * That fallback IS `partyHeadcount` — same adult predicate the server counts
 * by (`namedAdults`), plus every child. It cannot apply the infant rule:
 * `PartyChild` carries `age` as CampMinder's `yy.mm`, which is exactly the
 * field #2046 forbids thresholding, and no birthdate reaches the client. So
 * with nothing reported the bed number and the headcount coincide — that
 * coincidence is the shared part, and the whole of it.
 */
export function partySize(party: RosterPartyRow): number {
  const reported = party.party_size ?? 0
  if (reported > 0) return reported
  return partyHeadcount(party)
}

/** What a card can say about how full it is. */
export interface SlotOccupancy {
  /**
   * People this card accounts for. An UPPER BOUND when `spanWidth > 0` — see
   * below.
   */
  occupants: number
  /**
   * 0 when every party here is wholly inside this card; otherwise how many
   * rooms the widest straddling party holds.
   *
   * Non-zero withholds the over-capacity verdict. Since #2010 a party holding
   * several rooms is drawn on EACH of them, and #2040 deliberately left that
   * rule alone, so the same six people appear on two cards. There is no
   * per-room breakdown to divide them by — `party_size` is one number for the
   * household — and inventing a split is precisely what `sleeps: null`
   * rendering an em dash exists to refuse.
   *
   * Counting the party in full rather than dropping it is the safer of the two
   * errors: it over-states, which reads as "look at this", where counting only
   * the wholly-contained parties would under-state and read as "room for more".
   * `occupiedLeafCodes` names that direction — failing permissive is what this
   * surface exists to close.
   *
   * Withholding only the VERDICT, rather than the figure, is the distinction:
   * a number carrying a marker is context, while "over capacity" is a claim,
   * and a household legitimately spread across two rooms it needs is not over
   * anything.
   *
   * Measured on the 2026 registry after #2040: ZERO parties span cards, down
   * from one, because combining a whole-let building rolls them onto a single
   * card. Owner-confirmed that a straddling household is never joined in one
   * of its rooms by a second family, so in practice such a card holds exactly
   * one party. This is a guard on a reachable-but-currently-empty state.
   */
  spanWidth: number
}

/**
 * Who this card holds, and whether it can speak for all of them.
 *
 * Reads `coveredCodes` and `occupiedLeafCodes` — the same two primitives
 * `overlappingPartyKeys` uses — rather than re-deriving "is this party inside
 * this card". #2040 records what re-deriving costs: the overlap rule was fixed
 * at the slot level and immediately came back one level down in `FamilyCard`,
 * because the second copy had not been told.
 */
export function slotOccupancy(slot: BoardSlot, units: LodgingUnitRow[]): SlotOccupancy {
  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))
  const covered = new Set(coveredCodes(slot.unit, units))
  let occupants = 0
  let spanWidth = 0
  for (const party of slot.parties) {
    occupants += partySize(party)
    const leaves = occupiedLeafCodes(party, units, unitsByCode)
    // `some`, not `every`: a party naming its own room AND the building above
    // it expands to a superset, and any single uncovered leaf is enough to say
    // this card cannot speak for the whole placement.
    const straddles = [...leaves].some((leaf) => !covered.has(leaf))
    if (straddles) spanWidth = Math.max(spanWidth, leaves.size)
  }
  return { occupants, spanWidth }
}

/**
 * Area colour, §3.10 — a SECONDARY channel.
 *
 * Eight hues is at the limit of distinguishability, so nothing may depend on
 * telling violet from rose: the section headers do the actual grouping and
 * this degrades to decoration. Mid-lightness on purpose, so one value reads on
 * both the light and the dark card.
 */
export const AREA_HUES = [
  'hsl(160 45% 42%)',
  'hsl(38 75% 50%)',
  'hsl(196 55% 45%)',
  'hsl(92 40% 40%)',
  'hsl(268 38% 56%)',
  'hsl(220 48% 55%)',
  'hsl(348 52% 55%)',
  'hsl(24 42% 46%)',
] as const

/**
 * Staff-facing wording for the share verdict, defined ONCE.
 *
 * These phrasings are load-bearing, not cosmetic. The Family Camp form has no
 * refusal option, so `declined` is the absence of a share request rather than a
 * recorded "no" — 106 of 165 form-declined households for 2026 had asked to be
 * housed NEAR someone. Saying they "declined" puts a claim in a staff member's
 * mouth that the family never made.
 *
 * The slot flag and the card chip render the same concepts, so they read from
 * here rather than each holding their own literal: a correction applied to one
 * copy and not the other is exactly how the wrong wording comes back.
 */
export const SHARE_WORDING = {
  /** Sentence fragment: "N families <…>". */
  declined: 'did not request sharing',
  /** Sentence fragment: "N families' two <…>". */
  conflict: 'answers disagree',
} as const

/** The same phrase as a standalone chip label. One source, two positions. */
export function shareWordingChip(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1)
}

/**
 * The REGISTRATION gate's answer, worded for a sentence rather than a chip.
 *
 * `preference` (`share_cabin_gate`) is a 3-state answer plus "never
 * answered" — see `SharePreferenceChip`'s doc, which owns the CHIP-label
 * spelling of the same four values. This is a distinct wording, not a
 * duplicate: it exists to sit in a sentence fragment ("Registration said
 * …"), where the chip's title-case labels ("Will not share") read oddly.
 */
const REGISTRATION_ANSWER: Record<SharePreferenceValue, string> = {
  no_share: 'will not share',
  maybe_mutual: 'only if a mutual match',
  yes_share: 'open to sharing',
  unknown: 'not answered',
}

/**
 * The FAMILY CAMP FORM's resolved answer, worded for the same sentence.
 *
 * `declined` reuses `SHARE_WORDING.declined` rather than its own phrase —
 * ONE definition of that claim, so the slot flag, the card's "did not
 * request sharing" chip, and this tooltip cannot drift into three different
 * wordings of a form that has no refusal option to record.
 */
const FORM_ANSWER: Record<ShareEligibilityValue, string> = {
  open: 'open to sharing',
  named: 'wants to share with a named family',
  declined: SHARE_WORDING.declined,
  unknown: 'not answered',
}

/**
 * Guarded lookup — same philosophy as `SharePreferenceChip`'s `Object.hasOwn`
 * guard on `CHIP`: a payload sent ahead of a type regen must degrade to the
 * "not answered" phrasing rather than throw and take the whole card with it.
 */
function wordingFor<T extends string>(
  table: Record<T, string>,
  value: T,
  fallback: string
): string {
  return Object.hasOwn(table, value) ? table[value] : fallback
}

/**
 * The tooltip text for the per-party "answers disagree" chip (kindred#2083).
 *
 * The chip alone said only that the two forms disagreed, never which two
 * answers or which one staff are acting on. This names both sides and the
 * resolution in one sentence.
 *
 * Reads `preference` (the registration gate) and `eligibility` (the
 * resolved verdict) directly rather than re-deriving either from `proximity`.
 * `DeriveShareEligibility` only ever sets `answers_conflict` true on its
 * form-answered branch (Go, `lodging_requests.go`), so whenever this returns
 * non-null, `eligibility` already IS the Family Camp form's own answer,
 * confirmed against 2026 production: all 16 conflicting households carry
 * `eligibility_source: 'form'`.
 *
 * That invariant is enforced only in a separate Go file, with nothing here
 * to catch a future change or a stale mid-`family_camp_derived`-recompute
 * row that briefly disagrees with it — so this still BRANCHES on
 * `eligibility_source` rather than assuming it, and only names "the Family
 * Camp form" when the field itself says so. Off that branch the resolved
 * answer is worded as "the answer on file" instead: a claim this function
 * can defend either way, matching `consentFlag`'s own rule of reporting only
 * what was recorded.
 *
 * `preference` (`share_cabin_gate`) is the registration answer that WON
 * `winsGate`'s newest-wins race, not necessarily the answer that disagrees
 * (kindred#2269). `DeriveShareEligibility` raises the conflict off the UNION
 * of every sibling's recorded no_share/yes_share answer, so a household can
 * conflict with `maybe_mutual` as the winning gate -- the actual
 * contradiction is a sibling answer that lost recency and never reaches this
 * payload. `REGISTRATION_ANSWER['maybe_mutual']` ("only if a mutual match")
 * does not itself read as a disagreement against any resolved verdict, so
 * naming it as "Registration said …" would have the tooltip pair two answers
 * that look like they agree, on a chip whose whole job is to say they don't.
 * `no_share` and `yes_share` don't have this problem: DeriveShareEligibility
 * can only raise a conflict off one of those FROM `preference` itself when
 * `preference` IS one of them, so naming it stays honest.
 *
 * Returns null when there is nothing to report: no conflict, or no share
 * block at all — the shape of an adult-weekend guest, who has no share
 * question to disagree on (`_build_person_parties` attaches no share data).
 * The caller gates the whole chip on this, rather than on the raw boolean,
 * so a party this can't explain never renders an empty chip.
 */
export function answersConflictDetail(share: ShareRequest | undefined): string | null {
  if (share?.answers_conflict !== true) return null
  const resolved = wordingFor(FORM_ANSWER, share.eligibility ?? 'unknown', 'not answered')
  const winner =
    share.eligibility_source === 'form'
      ? `the Family Camp form said ${resolved} — staff use the form's answer`
      : `the answer on file is ${resolved} — staff use that answer`
  if (share.preference === 'maybe_mutual') {
    return `A registration answer on file disagrees with this: ${winner}.`
  }
  const registration = wordingFor(
    REGISTRATION_ANSWER,
    share.preference ?? 'unknown',
    'not answered'
  )
  return `Registration said ${registration}; ${winner}.`
}

/** A shared unit holding somebody who did not consent to sharing it. */
export interface ConsentFlag {
  /** Parties whose resolved answer declines sharing. */
  declinedCount: number
  /**
   * Parties silent on BOTH forms. Counted separately from `declinedCount`
   * because the remedy differs — chase the form rather than move the family —
   * and because reporting "declined" about a household that answered nothing
   * is a claim staff cannot defend to that household.
   */
  unansweredCount: number
  /**
   * Parties whose two forms point opposite ways. A staff-review signal, not a
   * placement rule — it fires even when everyone in the slot is shareable,
   * because the disagreement is the thing worth a human look.
   */
  conflictCount: number
  /** Ready to render beside the slot. Never PHI. */
  reason: string
}

/**
 * One area's shorthand at a given depth: initials for a multi-word name,
 * leading letters for a single word. Depth 1 is the two-character form.
 */
function shorthand(name: string, depth: number): string {
  const words = name.split(/[^A-Za-z0-9]+/).filter((word) => word.length > 0)
  if (words.length === 0) return 'XX'
  const first = words[0] ?? ''
  const second = words[1]
  if (second === undefined) return first.slice(0, Math.max(2, depth + 1)).toUpperCase()
  return (first.slice(0, depth) + second.charAt(0)).toUpperCase()
}

/** How far `shorthand` will deepen before falling back to a numeric suffix. */
const MAX_TOKEN_DEPTH = 6

/**
 * A short, URL-safe token per area, keyed by `BoardArea.key`.
 *
 * Collapse state lives in the query string (`?closed=GT&closed=HC`), so each
 * area needs a name that survives a URL. `key` cannot do it — it is
 * `code::name`, which needs escaping and puts the camp's own area names into a
 * link that gets pasted into tickets and chat.
 *
 * The registry's `area_code` cannot do it either, and that was the first
 * attempt. It is hand-entered and ragged — two letters for some areas, four
 * for others — so the URL read as though the widths meant something. Deriving
 * the token instead makes every area two characters and drops a dependency on
 * a field nothing else on this board reads.
 *
 * WHY THIS TAKES THE WHOLE SET. Two characters is not always enough, and no
 * pure function of one name can fix that: on the 2026 registry "Ridge Side"
 * and "River Side" both reduce to RS, and both first words begin "Ri". So the
 * colliding group — and only that group — deepens a letter at a time until its
 * members are distinct, leaving every other area's token, and every link
 * already holding it, untouched.
 *
 * Stability: a token depends on its own name and on the names it clashes with,
 * never on position or on the number of areas. Adding an unrelated area cannot
 * move it. Adding one that clashes can, which is the honest cost of a short
 * token and is why the deepening is deterministic rather than first-come.
 */
export function areaTokens(
  areas: ReadonlyArray<Pick<BoardArea, 'key' | 'name'>>
): Map<string, string> {
  // Sorted by key so the last-resort suffix below is stable across payload
  // orders, exactly as the hue assignment is.
  const ordered = [...areas].sort((left, right) => left.key.localeCompare(right.key))
  const depths = new Map(ordered.map((area) => [area.key, 1]))

  for (let round = 0; round < MAX_TOKEN_DEPTH; round++) {
    const claimants = new Map<string, string[]>()
    for (const area of ordered) {
      const token = shorthand(area.name, depths.get(area.key) ?? 1)
      claimants.set(token, [...(claimants.get(token) ?? []), area.key])
    }
    const clashing = [...claimants.values()].filter((keys) => keys.length > 1)
    if (clashing.length === 0) break
    for (const keys of clashing) {
      for (const key of keys) depths.set(key, (depths.get(key) ?? 1) + 1)
    }
  }

  // Two names that are identical after stripping punctuation would still tie
  // at every depth. A numeric suffix is the floor, so a token is never blank
  // and never duplicated.
  const taken = new Set<string>()
  const tokens = new Map<string, string>()
  for (const area of ordered) {
    const base = shorthand(area.name, depths.get(area.key) ?? 1)
    let token = base
    let suffix = 2
    while (taken.has(token)) token = `${base}${String(suffix++)}`
    taken.add(token)
    tokens.set(area.key, token)
  }
  return tokens
}

/** One unit card: the room, whoever is in it, and whether that is a problem. */
export interface BoardSlot {
  unit: LodgingUnitRow
  parties: RosterPartyRow[]
  consent: ConsentFlag | null
}

export interface BoardArea {
  /** Area code and name together — see `areaKey`. */
  key: string
  name: string
  hue: string
  slots: BoardSlot[]
  partyCount: number
  /**
   * How many distinct buildings the area's DRAWN slots span — kindred#2009.
   *
   * Reads `slots`, the same set `slots.length` (rooms) counts, not just the
   * occupied ones: a static fact about how this area's inventory is carved
   * up into buildings, the same way "rooms" is a static fact about its
   * inventory rather than a count of who is in it. `buildingsSpanned`
   * (`unitLevel.ts`) is the one definition — the immediate-parent grain
   * ruled on #2008, so a two-half house counts as two buildings here too.
   */
  buildingCount: number
}

export interface BoardModel {
  areas: BoardArea[]
  /** Not placed anywhere. Unordered — the corner queue sorts by surname. */
  unplaced: RosterPartyRow[]
  /** Placed, but on something the board cannot draw a card for. */
  offBoard: RosterPartyRow[]
  flaggedCount: number
}

/**
 * Bucket key for an area.
 *
 * Keyed on the code AND the name because the code alone is not unique: the
 * API sends `area_code: ""` for anything it cannot resolve, so two differently
 * named areas would share a bucket and the second one's name would be
 * silently discarded along with its heading.
 */
function areaKey(unit: LodgingUnitRow): string {
  return `${unit.area_code ?? ''}::${unit.area_name ?? ''}`
}

function areaName(unit: LodgingUnitRow): string {
  const name = unit.area_name ?? ''
  return name.length > 0 ? name : 'Unassigned area'
}

/**
 * The Manage screen's area rank (kindred#2076) — `lodging_areas.sort_order`,
 * carried through on every unit in the area. 0 for a unit with no expanded
 * area, the same value an unranked area's `sort_order` reads as.
 */
function areaSortOrder(unit: LodgingUnitRow): number {
  return unit.area_sort_order ?? 0
}

/**
 * Which of these parties share an occupied LEAF code with at least one
 * OTHER party in the list — keyed by `partyKey`, the project's one stable
 * identity for a roster party.
 *
 * THE ONE DEFINITION OF OVERLAP. A combined container rolls every one of its
 * rooms' parties onto one slot (`indexPayload`'s roll-up), so two households
 * in DISJOINT rooms of one building land in the same slot that a plain leaf
 * would only ever hold for parties genuinely sharing a room.
 * `docs/architecture/lodging-occupancy.md` is explicit that this is
 * legitimate: "An extended family spanning two or more registrations may
 * occupy one house together, each registration in its own room. This is not
 * sharing a unit." Sharing is a concern only when occupied LEAF codes
 * intersect — not merely when two parties land in the same slot, and not
 * merely when two parties land on the same CARD.
 *
 * `consentFlag` below (the slot-level amber flag) and `LodgingUnitCard`'s
 * per-party `sharedSlot` (the card-level "did not request sharing" chip on
 * `FamilyCard`) both read this ONE routine rather than each re-deriving "do
 * these parties overlap" in their own words. That duplication is exactly how
 * the bug this function fixes came back one level down in task-11's first
 * round: the slot flag was gated on overlap, but `FamilyCard`'s `sharedSlot`
 * was still `parties.length > 1` — a merged card's two disjoint-room
 * households still chipped "did not request sharing", the identical bug
 * restated per-party instead of per-slot.
 *
 * Reads `occupiedLeafCodes` — `occupiedCodes`, the same authority the board and
 * `dragPlacement` use, with every named CONTAINER expanded to the rooms beneath
 * it. The expansion is why `units` is a parameter: without it the comparison is
 * of names rather than of rooms, and a party on a building does not overlap a
 * party in that building's room. A plain leaf slot is unaffected either way —
 * its parties all name that one leaf code, which expands to itself and
 * trivially overlaps every other party there, exactly as before this existed.
 */
export function overlappingPartyKeys(
  parties: RosterPartyRow[],
  units: LodgingUnitRow[]
): Set<string> {
  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))
  const ownersByCode = new Map<string, RosterPartyRow[]>()
  for (const party of parties) {
    for (const code of occupiedLeafCodes(party, units, unitsByCode)) {
      const owners = ownersByCode.get(code)
      if (owners) owners.push(party)
      else ownersByCode.set(code, [party])
    }
  }

  const overlapping = new Set<string>()
  for (const owners of ownersByCode.values()) {
    if (owners.length < 2) continue
    for (const owner of owners) overlapping.add(partyKey(owner))
  }
  return overlapping
}

/**
 * Which of these parties hold an entire building, keyed by `partyKey` —
 * kindred#2008's placement marker.
 *
 * Read against each party's OWN occupied leaves (`occupiedLeafCodes`), never
 * the slot's combined membership. Two households splitting one combined
 * house between disjoint rooms is the Front/Back case `overlappingPartyKeys`
 * already treats as NOT a share of a room; it is likewise not a whole-
 * building HOLD for either one of them individually, even though the CARD
 * they share is structurally the whole building — the marker is about a
 * placement, not a card. See `unitLevel.ts`'s `wholeBuildingHeld` for the
 * grain (immediate parent, ruled on #2008) and why a one-room "building" can
 * never qualify.
 */
export function wholeBuildingHolders(
  parties: RosterPartyRow[],
  units: LodgingUnitRow[]
): Set<string> {
  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))
  const holders = new Set<string>()
  for (const party of parties) {
    const leaves = occupiedLeafCodes(party, units, unitsByCode)
    if (wholeBuildingHeld(leaves, units)) holders.add(partyKey(party))
  }
  return holders
}

/**
 * Consent flagging, on the resolved ELIGIBILITY rather than the registration
 * gate.
 *
 * Share intent lives in two CampMinder fields asked at different times. Staff
 * treat the later Family Camp information form as authoritative, and the Go
 * ingest resolves the two into one verdict — see DeriveShareEligibility. This
 * function reads that verdict and never re-derives it.
 *
 * WHY NOT THE GATE. `share_cabin_gate` is the registration answer alone, and
 * flagging on it was wrong in both directions on 2026 data: 1 household said no
 * at registration and then named a partner on the form (flagged, though
 * legitimately placed), while 51 said yes-or-maybe and then declined on the
 * form (silent, and read as permissive). The silent direction is ~17x the noisy
 * one, which is why it moved.
 *
 * WORDING IS LOAD-BEARING. The form has no "we do not want to share" option —
 * the four live choices are NEAR / "No requests" / WITH-named /
 * WITH-similarly-aged — so `declined` is always the ABSENCE of a WITH token,
 * never a recorded refusal. 106 of 165 form-declined households for 2026 had
 * asked to be housed NEAR someone. Saying they "declined" would put a claim in
 * a staff member's mouth that the family never made; "did not request sharing"
 * is true of all of them.
 *
 * `named` does not flag. Mutuality needs request names resolved to households
 * (spec §7.3, unbuilt), and `named` is most of the eligible pool, so flagging
 * it would fire mostly on the legitimate case. The panel shows the names and
 * staff judge — which is the resolution C1 already settled on after §11's
 * own claim about the one flagged unit turned out to be false.
 */
export function consentFlag(
  parties: RosterPartyRow[],
  units: LodgingUnitRow[]
): ConsentFlag | null {
  if (parties.length < 2) return null

  // The rule is OVERLAP, not co-location on one card — see
  // `overlappingPartyKeys`. `units` is passed through for the container
  // expansion that makes the overlap a comparison of ROOMS rather than of the
  // names a placement happened to use.
  //
  // The overlapping subset is then the SUBJECT of everything below, not just
  // the trigger for it. A combined house rolls every room's party onto one
  // slot, so a family alone in its own room sits beside a pair genuinely
  // sharing another; counting it would put a family in the reason line that
  // `docs/architecture/lodging-occupancy.md` says is not sharing at all
  // ("each registration in its own room. This is not sharing a unit"). That
  // is the same bug as gating on `parties.length > 1`, one level further in —
  // it survived the slot-level and per-party fixes because a card mixing
  // sharers with non-sharers is the only shape that exposes it, and 2026's
  // combined houses hold two disjoint parties apiece.
  const overlapping = overlappingPartyKeys(parties, units)
  if (overlapping.size === 0) return null
  const sharing = parties.filter((party) => overlapping.has(partyKey(party)))

  // Adult weekends have NO share question at all -- the fields are partition
  // ["Camper"] and no Adult-Share field exists -- so a person-grain party
  // carries no answer to judge. Returning null here is not "no problem found";
  // it is "not checked", and the board says so rather than rendering a clean
  // slot that was never examined. Read off `sharing` for the same reason the
  // counts are: a person-grain party in its own room is not part of the
  // question being asked about the ones that overlap.
  if (sharing.some((party) => party.grain === 'person')) return null

  let declinedCount = 0
  let unansweredCount = 0
  let conflictCount = 0
  for (const party of sharing) {
    if (party.share?.answers_conflict === true) conflictCount += 1
    // Absent eligibility is UNKNOWN, never open. These columns are written by
    // family_camp_derived, so they are empty until it re-runs, and empty must
    // fall to the side that does not consent.
    const eligibility: ShareEligibilityValue = party.share?.eligibility ?? 'unknown'
    switch (eligibility) {
      case 'declined':
        declinedCount += 1
        break
      case 'unknown':
        unansweredCount += 1
        break
      case 'open':
      case 'named':
        // Both consent to sharing. `named` is not verified mutual — that needs
        // request names resolved to households (spec §7.3, unbuilt) — so the
        // panel shows the names and staff judge. Flagging it would fire on the
        // majority of eligible households.
        break
      default: {
        // Exhaustiveness guard. An implicit default would route a NEW
        // eligibility value into the consenting arm above — failing permissive,
        // which is the exact direction this whole surface exists to close.
        // A fifth value must break the build, not silently consent.
        const unhandled: never = eligibility
        throw new Error(`Unhandled share eligibility: ${String(unhandled)}`)
      }
    }
  }

  if (declinedCount === 0 && unansweredCount === 0 && conflictCount === 0) return null
  return {
    declinedCount,
    unansweredCount,
    conflictCount,
    reason: consentReason(declinedCount, unansweredCount, conflictCount),
  }
}

/**
 * Wording for a consent flag. Reports only what was RECORDED.
 *
 * "did not request sharing" rather than "declined": the form has no refusal
 * option, so this state is the absence of a share request, and most of the
 * households in it asked to be housed near someone instead.
 */
function consentReason(
  declinedCount: number,
  unansweredCount: number,
  conflictCount: number
): string {
  const parts: string[] = []
  if (declinedCount > 0) {
    parts.push(
      declinedCount === 1
        ? `1 family ${SHARE_WORDING.declined}`
        : `${String(declinedCount)} families ${SHARE_WORDING.declined}`
    )
  }
  if (unansweredCount > 0) {
    parts.push(
      unansweredCount === 1
        ? "1 family hasn't answered the cabin form"
        : `${String(unansweredCount)} families haven't answered the cabin form`
    )
  }
  if (conflictCount > 0) {
    parts.push(
      conflictCount === 1
        ? `1 family's two ${SHARE_WORDING.conflict}`
        : `${String(conflictCount)} families' two ${SHARE_WORDING.conflict}`
    )
  }
  return parts.join(', ')
}

/**
 * Index a payload into the pieces both the board and its tab count need.
 *
 * `drawn` is the ONE definition of which units get a card. The tab count and
 * the board read it through the same function on purpose — two copies of the
 * predicate is how a tab starts promising a number of cards the board does not
 * draw.
 */
/**
 * Whether this unit is inventory the weekend is planned against.
 *
 * 21 of the property's 102 leaf units are permanent full-time staff housing
 * (per the lodging registry), occupied by staff who are not enrolled per
 * session and so never appear on a roster. None of the 21 has a measured
 * `sleeps` — nobody has ever counted their beds, because they were never
 * inventory. Their cards are always empty, and since drag placement every drawn
 * card is an enabled drop target — an empty card reads as a room a family can
 * be dropped into, which is how a family lands in an occupied staff cabin.
 *
 * Read off RESOLVED availability rather than the standing role, because a
 * staff cabin can be released to families for one weekend and hiding the
 * cabin staff just released would make that capability useless. The converse
 * is deliberately NOT symmetric: a family cabin held back this weekend — a
 * burst pipe, say — keeps its card and gets a "Held" badge, because it is
 * still inventory and staff reason about adjacency. See `unitBadges.ts`:
 * reserved units are badged, not hidden.
 */
function isPlanningInventory(unit: LodgingUnitRow): boolean {
  return unit.inventory_class !== 'staff_default' || unit.is_family_available === true
}

function indexPayload(parties: RosterPartyRow[], units: LodgingUnitRow[]) {
  const unitsByCode = new Map(units.map((unit) => [unit.code, unit]))

  // Which units get a card, at each tree's resolved level. Replaces the old
  // "every non-container leaf" rule: a combined container IS a card now, and
  // the rooms it replaces are not.
  const candidates = drawnUnits(units)
  const drawnByCode = new Map(candidates.map((unit) => [unit.code, unit]))

  // A placement names leaves, or a container, or a mix. Map each named code
  // onto the card that currently REPRESENTS it — itself if it is drawn, else
  // the nearest drawn ancestor (rolled up), else every drawn leaf it covers
  // (fanned down). Nobody falls off the board at any draw level.
  const cardCodesFor = (named: string): string[] => {
    if (drawnByCode.has(named)) return [named]
    const unit = unitsByCode.get(named)
    if (unit === undefined) return []
    // Roll up: walk to the drawn ancestor.
    //
    // REJECTED as the "whole building" grain for #2008/#2009, deliberately.
    // This walk stops at the nearest DRAWN ancestor, which depends on
    // `is_combined` — a VIEW-level fact that flips when staff merge or split
    // a card — not on registry structure. Using it for "whole building"
    // would make the same placement read as holding a whole building only
    // while its house happens to be combined, and stop the moment somebody
    // splits it back to rooms. #2008 ruled a purely structural grain instead
    // (immediate parent, never walk-to-root either) — see `buildingKey` and
    // `buildingGroups` in `unitLevel.ts`, which this function does not call
    // and must not be made to.
    let cursor = unit
    const seen = new Set<string>()
    while ((cursor.parent_code ?? '') !== '' && !seen.has(cursor.code)) {
      seen.add(cursor.code)
      const parent = unitsByCode.get(cursor.parent_code ?? '')
      if (parent === undefined) break
      if (drawnByCode.has(parent.code)) return [parent.code]
      cursor = parent
    }
    // Fan down: a container drawn below itself. The DRAWN DESCENDANTS, not the
    // drawn leaves — `coveredCodes` would walk past a combined intermediate to
    // rooms that are not drawn, filter to nothing, and rail a party off a board
    // that is showing the very card representing it.
    return representingCodes(unit, units, new Set(drawnByCode.keys()))
  }

  const partiesByCode = new Map<string, RosterPartyRow[]>()
  const unplaced: RosterPartyRow[] = []
  const offBoard: RosterPartyRow[] = []

  for (const party of parties) {
    const isPlaced = (party.unit_name ?? '').length > 0
    if (!isPlaced) {
      unplaced.push(party)
      continue
    }
    // De-duplicated: a party naming two rooms of one combined house must land
    // on that house ONCE, not twice.
    const codes = [...new Set(occupiedCodes(party).flatMap(cardCodesFor))]
    // Placed, but on nothing this board can draw. Either a code the payload has
    // no unit for, or a container with nothing drawable beneath it — childless,
    // or every room missing. There is no card to put it on, but it IS placed
    // and the unplaced rail would be a lie.
    if (codes.length === 0) {
      offBoard.push(party)
      continue
    }
    // A party holding several rooms appears on each of them. That is the point:
    // rooms it occupies rendered empty is what sent staff to the wrong cabin.
    for (const code of codes) {
      const bucket = partiesByCode.get(code)
      if (bucket) bucket.push(party)
      else partiesByCode.set(code, [party])
    }
  }

  // A deactivated room is not bookable, and staff housing was never planning
  // inventory at all, so both clutter the board — unless somebody is still in
  // one, in which case hiding it would drop them.
  const drawn = candidates.filter(
    (unit) =>
      (unit.is_active !== false && isPlanningInventory(unit)) ||
      (partiesByCode.get(unit.code)?.length ?? 0) > 0
  )

  return { drawn, partiesByCode, unplaced, offBoard }
}

export function buildBoard(parties: RosterPartyRow[], units: LodgingUnitRow[]): BoardModel {
  const { drawn, partiesByCode, unplaced, offBoard } = indexPayload(parties, units)

  // `partyKeys` rather than a running total: a family holding four rooms sits
  // on four slots, and the header says "families", not cards. Counting the
  // slot entries would report four families standing where one is.
  const buckets = new Map<
    string,
    { name: string; sortOrder: number; slots: BoardSlot[]; partyKeys: Set<string> }
  >()
  let flaggedCount = 0
  for (const unit of drawn) {
    const slotParties = partiesByCode.get(unit.code) ?? []
    const consent = consentFlag(slotParties, units)
    if (consent) flaggedCount += 1

    const key = areaKey(unit)
    const bucket = buckets.get(key) ?? {
      name: areaName(unit),
      sortOrder: areaSortOrder(unit),
      slots: [],
      partyKeys: new Set<string>(),
    }
    // Units are pushed in the PAYLOAD's order and never re-sorted here — the
    // repository's own query already sorts `area.sort_order,name`, so a
    // unit's position within its area stays alphabetical without this
    // function touching it (owner ruling, kindred#2076: "intra unit remains
    // alpha"). Only which AREA a unit's slot lands in, and where that area
    // falls below, changes.
    bucket.slots.push({ unit, parties: slotParties, consent })
    for (const slotParty of slotParties) bucket.partyKeys.add(partyKey(slotParty))
    buckets.set(key, bucket)
  }

  // Ordered by the Manage screen's area rank (kindred#2076) — the board
  // must key off the SAME order staff set there (`LodgingAreasDrawer`'s
  // reorder), not off the area name. Areas tied on rank, including two
  // areas that both carry no rank (0), fall back to the name so the order
  // is always fully determined — never left depending on payload order.
  // The hue assignment below rides this same order; the owner has ruled the
  // resulting recolour on a reorder is expected and not to be protected
  // against (area colour carries no meaning staff read).
  const orderedKeys = [...buckets.keys()].sort((a, b) => {
    const left = buckets.get(a)
    const right = buckets.get(b)
    const leftOrder = left?.sortOrder ?? 0
    const rightOrder = right?.sortOrder ?? 0
    if (leftOrder !== rightOrder) return leftOrder - rightOrder
    return (left?.name ?? '').localeCompare(right?.name ?? '')
  })

  const areas: BoardArea[] = orderedKeys.map((key, index) => {
    const bucket = buckets.get(key)
    const slots = bucket?.slots ?? []
    return {
      key,
      name: bucket?.name ?? '',
      hue: AREA_HUES[index % AREA_HUES.length] ?? AREA_HUES[0],
      slots,
      partyCount: bucket?.partyKeys.size ?? 0,
      buildingCount: buildingsSpanned(
        slots.map((slot) => slot.unit),
        units
      ),
    }
  })

  return { areas, unplaced, offBoard, flaggedCount }
}

/**
 * How many slot cards the board will draw — what the Board tab counts.
 *
 * Shares `indexPayload` with `buildBoard` so the tab cannot promise a number
 * of cards the board does not draw.
 */
export function countBoardSlots(parties: RosterPartyRow[], units: LodgingUnitRow[]): number {
  return indexPayload(parties, units).drawn.length
}
