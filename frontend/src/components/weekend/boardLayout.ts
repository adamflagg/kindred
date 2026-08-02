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
 *    go to `offBoard`, never to the unplaced rail (they ARE placed) and never
 *    to nowhere. `buildBoard` is total: every input party comes out in exactly
 *    one of slots / unplaced / offBoard.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'

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
  /** Not placed anywhere. Ranked; see `rankUnplaced`. */
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
 * Consent flagging, spec §11.
 *
 * Fires on an EXPLICIT `no_share` only. Whether `maybe_mutual` + `maybe_mutual`
 * counts as mutual, and whether a blank gate (45 of 452 for 2026) counts as
 * consent, are deferred to C2 — neither occurs in placed data, so they change
 * nothing until staff drag a card.
 *
 * Declining is the ordinary answer and contradicts nothing on its own; it only
 * becomes a defect when somebody else is in the room.
 *
 * WHAT THE FLAG ACTUALLY MEANS, measured on 2026 rather than assumed. It fires
 * exactly once, on the unit spec §11 predicted. But §11 calls that case "a
 * family that said no is sharing with strangers", and that is FALSE: §11
 * checked surnames, billing addresses and phone numbers, and never read the two
 * request texts. Each household names the other by name, one of them marking it
 * "(priority)". The placement is mutual, reciprocated and deliberate.
 *
 * So this flags a household whose recorded GATE contradicts that household's
 * OWN request text — not a placement error. That is still worth surfacing, and
 * the flag's wording reports only the recorded answer for exactly that reason.
 * Resolving request names to households would let C2 suppress it, and that is
 * spec §7.3, unbuilt. Meanwhile the design already resolves it the honest way:
 * the card flags, and one click shows the request text that explains it.
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
  for (const party of parties) {
    // Absent eligibility is UNKNOWN, never open. These columns are written by
    // family_camp_derived, so they are empty until it re-runs, and empty must
    // fall to the side that does not consent.
    switch (party.share?.eligibility ?? 'unknown') {
      case 'declined':
        declinedCount += 1
        break
      case 'unknown':
        unansweredCount += 1
        break
      default:
        // `open` and `named` both consent to sharing. `named` is not verified
        // mutual -- that needs request names resolved to households (spec
        // §7.3, unbuilt) -- so the panel shows the names and staff judge.
        // Flagging it would fire on the majority of eligible households.
        break
    }
  }

  if (declinedCount === 0 && unansweredCount === 0) return null
  return { declinedCount, unansweredCount, reason: consentReason(declinedCount, unansweredCount) }
}

/** Wording for a consent flag. Reports only what was recorded. */
function consentReason(declinedCount: number, unansweredCount: number): string {
  const parts: string[] = []
  if (declinedCount > 0) {
    parts.push(
      declinedCount === 1
        ? '1 family declined sharing'
        : `${String(declinedCount)} families declined sharing`
    )
  }
  if (unansweredCount > 0) {
    parts.push(
      unansweredCount === 1
        ? "1 family hasn't answered the cabin form"
        : `${String(unansweredCount)} families haven't answered the cabin form`
    )
  }
  return parts.join(', ')
}

/**
 * Rank the unplaced rail.
 *
 * §3.7 wanted a mandatory accommodation OR "a share request whose partner is
 * not yet placed". The partner leg DOES NOT EXIST: no request names are
 * resolved to households (spec §7.3, unbuilt). So this ranks on the
 * accommodation alone, and the rail says so on the surface rather than
 * implying a completeness it does not have.
 */
function rankUnplaced(parties: RosterPartyRow[]): RosterPartyRow[] {
  return [...parties].sort((a, b) => {
    const aMandatory = a.flags?.accommodation_is_mandatory === true
    const bMandatory = b.flags?.accommodation_is_mandatory === true
    if (aMandatory !== bMandatory) return aMandatory ? -1 : 1
    return (a.display_name ?? '').localeCompare(b.display_name ?? '')
  })
}

/**
 * Index a payload into the pieces both the board and its tab count need.
 *
 * `drawn` is the ONE definition of which units get a card. The tab count and
 * the board read it through the same function on purpose — two copies of the
 * predicate is how a tab starts promising a number of cards the board does not
 * draw.
 */
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
    // A merge carries no unit code — the API sends the merge's display name
    // instead — so there is no card to put it on, but it is placed all the
    // same and the rail would be a lie.
    const code = party.unit_code ?? ''
    const unit = code.length > 0 ? leafByCode.get(code) : undefined
    if (unit === undefined) {
      offBoard.push(party)
      continue
    }
    const bucket = partiesByCode.get(code)
    if (bucket) bucket.push(party)
    else partiesByCode.set(code, [party])
  }

  // A deactivated room is not bookable, so it clutters the board — unless
  // somebody is still in it, in which case hiding it would drop them.
  const drawn = [...leafByCode.values()].filter(
    (unit) => unit.is_active !== false || (partiesByCode.get(unit.code)?.length ?? 0) > 0
  )

  return { drawn, partiesByCode, unplaced, offBoard }
}

export function buildBoard(parties: RosterPartyRow[], units: LodgingUnitRow[]): BoardModel {
  const { drawn, partiesByCode, unplaced, offBoard } = indexPayload(parties, units)

  const buckets = new Map<string, { name: string; slots: BoardSlot[]; partyCount: number }>()
  let flaggedCount = 0
  for (const unit of drawn) {
    const slotParties = partiesByCode.get(unit.code) ?? []
    const consent = consentFlag(slotParties)
    if (consent) flaggedCount += 1

    const key = areaKey(unit)
    const bucket = buckets.get(key) ?? { name: areaName(unit), slots: [], partyCount: 0 }
    bucket.slots.push({ unit, parties: slotParties, consent })
    bucket.partyCount += slotParties.length
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
      partyCount: bucket?.partyCount ?? 0,
    }
  })

  return { areas, unplaced: rankUnplaced(unplaced), offBoard, flaggedCount }
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
