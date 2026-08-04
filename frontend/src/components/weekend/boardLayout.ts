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
 * 1. **Containers never get a card.** A building row carries the beds its
 *    halves already report; drawing it double-counts them (408 against a true
 *    389). Owner-confirmed.
 * 2. **No party is ever dropped.** A party can be placed somewhere the board
 *    structurally cannot draw — a merge carries no `unit_code` at all, and an
 *    assignment can name a container or a unit absent from the payload. Those
 *    go to `offBoard`, never to the unplaced corner queue (they ARE placed) and
 *    never to nowhere. `buildBoard` is total: every input party comes out in
 *    exactly one of slots / unplaced / offBoard.
 */
import type { LodgingUnitRow, RosterPartyRow, ShareEligibilityValue } from '../../types/lodging'
import { partyKey } from './partyKey'

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
export function consentFlag(parties: RosterPartyRow[]): ConsentFlag | null {
  if (parties.length < 2) return null

  // Adult weekends have NO share question at all -- the fields are partition
  // ["Camper"] and no Adult-Share field exists -- so a person-grain party
  // carries no answer to judge. Returning null here is not "no problem found";
  // it is "not checked", and the board says so rather than rendering a clean
  // slot that was never examined.
  if (parties.some((party) => party.grain === 'person')) return null

  let declinedCount = 0
  let unansweredCount = 0
  let conflictCount = 0
  for (const party of parties) {
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
  // Every leaf unit can hold a party, including a deactivated one — the
  // registry can be edited out from under a live assignment.
  const leafByCode = new Map<string, LodgingUnitRow>()
  for (const unit of units) {
    if (unit.is_container === true) continue
    leafByCode.set(unit.code, unit)
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
    // An unresolvable code is dropped rather than disqualifying the whole
    // placement. A room missing from the payload should cost the family that
    // room, not hide the family.
    const codes = occupiedCodes(party).filter((code) => leafByCode.has(code))
    // Placed, but on nothing this board can draw — a container, or a name the
    // payload has no unit for. There is no card to put it on, but it IS placed
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
  const drawn = [...leafByCode.values()].filter(
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
  const buckets = new Map<string, { name: string; slots: BoardSlot[]; partyKeys: Set<string> }>()
  let flaggedCount = 0
  for (const unit of drawn) {
    const slotParties = partiesByCode.get(unit.code) ?? []
    const consent = consentFlag(slotParties)
    if (consent) flaggedCount += 1

    const key = areaKey(unit)
    const bucket = buckets.get(key) ?? {
      name: areaName(unit),
      slots: [],
      partyKeys: new Set<string>(),
    }
    bucket.slots.push({ unit, parties: slotParties, consent })
    for (const slotParty of slotParties) bucket.partyKeys.add(partyKey(slotParty))
    buckets.set(key, bucket)
  }

  // Sorted so a hue is stable for an area regardless of the payload's unit
  // order — the map (Step 6) and the board must agree about which area is
  // which colour, and both read this.
  const orderedKeys = [...buckets.keys()].sort((a, b) => {
    const left = buckets.get(a)?.name ?? ''
    const right = buckets.get(b)?.name ?? ''
    return left.localeCompare(right)
  })

  const areas: BoardArea[] = orderedKeys.map((key, index) => {
    const bucket = buckets.get(key)
    return {
      key,
      name: bucket?.name ?? '',
      hue: AREA_HUES[index % AREA_HUES.length] ?? AREA_HUES[0],
      slots: bucket?.slots ?? [],
      partyCount: bucket?.partyKeys.size ?? 0,
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
