/**
 * How full a unit is allowed to get on an ADULT weekend (kindred#2765, owner
 * ruling 2026-09-23). Warning only: nothing here refuses a placement.
 *
 * On an adult weekend (Women's / Men's) every guest registers individually
 * and is their own party of one, so beds stop being the limit — friends share
 * a bed or take a couch. The staff rule, written down in
 * `docs/architecture/lodging-occupancy.md`, is that a camper cabin holds up
 * to 8 and everything else usually holds one. So:
 *
 * | weekend | unit                                   | judged against      |
 * |---------|----------------------------------------|---------------------|
 * | family  | anything                               | its beds, unchanged |
 * | adult   | `shareable`, not a container           | 8 guests            |
 * | adult   | anything else (single-party, `unknown`, a container — combined or not) | nothing: no claim |
 *
 * A COMBINED CONTAINER IS A DROP TARGET (`dragPlacement.ts`) and still gets no
 * ceiling: it is a house, and a house on an adult weekend is "other lodging".
 * The registry's `shareability` marks every 12+ bed family-pool cabin
 * `shareable` (kindred#2026), which is exactly the camper-cabin set.
 *
 * Every adult test in the weekend UI goes through `isAdultSessionType`; the
 * pure helpers here and in `needsFit`, `placementCandidates` and `writeIn`
 * take an `isAdult: boolean` rather than inferring it from party grain.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { buildBoard, partySize } from './boardLayout'
import { partyKey } from './partyKey'
import { coveringWriteIns, writeInDemand } from './writeIn'

/**
 * The guests a shared cabin holds on an adult weekend. THE one definition —
 * every surface that states the ceiling reads this.
 */
export const ADULT_SHARED_CABIN_GUESTS = 8

/**
 * Does the 8-guest ceiling apply to this unit on an adult weekend?
 *
 * `is_container`, not `is_combined`: a combined house is drawn as one card and
 * accepts drops, but it is not a camper cabin, and an uncombined one is never
 * drawn at all.
 */
export function isAdultSharedCabin(unit: LodgingUnitRow): boolean {
  return unit.shareability === 'shareable' && unit.is_container !== true
}

/**
 * What a unit's occupancy is judged against — the table in the module doc.
 *
 * `limit` is the number every "free" and "over" figure subtracts from:
 * - `beds`   — a family weekend; `null` means nobody measured the unit.
 * - `guests` — an adult shared cabin; always the ceiling.
 * - `none`   — an adult weekend's other lodging; `null`, and deliberately so:
 *   `writeInDemand` answers `usable: false` for it, so no surface can publish
 *   a free count or an over-capacity mark from it.
 */
export type OccupancyClaim =
  | { kind: 'beds'; limit: number | null }
  | { kind: 'guests'; limit: number }
  | { kind: 'none'; limit: null }

export function occupancyClaim(
  unit: LodgingUnitRow,
  beds: number | null,
  isAdult: boolean
): OccupancyClaim {
  if (!isAdult) return { kind: 'beds', limit: beds }
  if (isAdultSharedCabin(unit)) return { kind: 'guests', limit: ADULT_SHARED_CABIN_GUESTS }
  return { kind: 'none', limit: null }
}

/** `N guests · N beds` — the neutral figure for a unit that makes no claim. */
export function guestsAndBeds(guests: number, beds: number | null): string {
  const guestWord = `${String(guests)} guest${guests === 1 ? '' : 's'}`
  if (beds === null) return guestWord
  return `${guestWord} · ${String(beds)} bed${beds === 1 ? '' : 's'}`
}

/** The stats bar's figures on an adult weekend — see `adultLodgingTally`. */
export interface AdultLodgingTally {
  /** Every guest with a cabin: `sharedGuests + otherGuests`. */
  placed: number
  /** Guests in the open shared cabins that make up `sharedPlaces`. */
  sharedGuests: number
  /** `ADULT_SHARED_CABIN_GUESTS` × the drawn shared cabins open this weekend. */
  sharedPlaces: number
  /** Guests anywhere else: houses, rooms, a closed cabin, or off the board. */
  otherGuests: number
}

/**
 * The adult stats bar: guests placed, and the shared-cabin places as the only
 * fixed denominator — "84 placed · 52 of 240 shared-cabin places · 32 in
 * other lodging".
 *
 * The family bar's "beds" and "N spare / N short" figures do not survive at
 * person grain: they compare parties against family SPACES, which reports a
 * false shortage on a weekend where guests share.
 *
 * - Built over the BOARD's own model (`buildBoard`), so a guest counts where
 *   the board draws them and a card the board does not draw is not a cabin.
 * - A shared cabin enters the denominator when the server calls it open
 *   (`is_family_available`), which since kindred#2765 charges an unsized
 *   write-in one guest on an adult weekend — so a cabin holding a note-style
 *   write-in stays in, and its card reads "1 of 8" rather than vanishing from
 *   the bar. Only guests in those same cabins count against it; everyone else
 *   is "other lodging", including a combined shareable house.
 * - A write-in is a guest: its `party_size`, or ONE when unsized (owner
 *   ruling 2026-09-23). Read through `writeInDemand`'s `sized`, so it is the
 *   same number the card prints.
 * - A guest drawn on two cards (a placement straddling rooms) counts once,
 *   and in the shared cabins if either card is one.
 */
export function adultLodgingTally(
  parties: RosterPartyRow[],
  units: LodgingUnitRow[]
): AdultLodgingTally {
  const board = buildBoard(parties, units)
  const sharedParty = new Map<string, number>()
  const otherParty = new Map<string, number>()
  let sharedWriteIns = 0
  let otherWriteIns = 0
  let openSharedCabins = 0

  for (const area of board.areas) {
    for (const slot of area.slots) {
      const shared = isAdultSharedCabin(slot.unit) && slot.unit.is_family_available === true
      if (shared) openSharedCabins += 1
      const writeIns = writeInDemand(null, coveringWriteIns(slot.unit), true).sized
      if (shared) sharedWriteIns += writeIns
      else otherWriteIns += writeIns
      for (const party of slot.parties) {
        ;(shared ? sharedParty : otherParty).set(partyKey(party), partySize(party))
      }
    }
  }
  for (const party of board.offBoard) otherParty.set(partyKey(party), partySize(party))
  for (const key of sharedParty.keys()) otherParty.delete(key)

  const sum = (counts: Map<string, number>) => [...counts.values()].reduce((a, b) => a + b, 0)
  const sharedGuests = sum(sharedParty) + sharedWriteIns
  const otherGuests = sum(otherParty) + otherWriteIns
  return {
    placed: sharedGuests + otherGuests,
    sharedGuests,
    sharedPlaces: openSharedCabins * ADULT_SHARED_CABIN_GUESTS,
    otherGuests,
  }
}
