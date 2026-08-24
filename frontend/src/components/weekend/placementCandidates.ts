/**
 * Which family to put in THIS space — the list behind the unit card's
 * typeahead (kindred#2080).
 *
 * ## It annotates and orders. It never hides.
 *
 * Owner ruling 2026-08-07, restated 2026-08-09, and it is the opposite of what
 * a "filtered picker" instinct suggests. The reason is arithmetic rather than
 * taste: of 118 production 2026 units, **36** answer the bathroom need and
 * **36 have no power at all**, while of 479 2026 registrations **66** ask for
 * a bathroom in the unit and **48** ask for power. A list filtered to "what
 * fits" would be empty most of the time, which would make this new path WEAKER
 * than the drag it exists to shorten — staff would go back to dragging.
 *
 * ⚠️ THE SUPPLY FIGURE MOVED TWICE ON 2026-08-20 AND IS EASY TO QUOTE STALE.
 * It read **6** while the need was graded on exclusivity; kindred#2501 moved
 * the axis to presence (6 → 28) and kindred#2502's `_resolve_bathroom` then
 * gave 8 of the 15 containers the bathroom their rooms record (28 → 36). The
 * ruling survives the improvement — 36 of 118 still empties a filtered list —
 * but the old number understates the supply by six times. The power figure is
 * `power_coverage: 'none'`, which is what `needGlyphs` grades; 49 rows carry a
 * raw `has_power = 0`, and that is the container trap, not the supply.
 *
 * So `placementCandidates` returns exactly as many rows as it is given, always.
 * The fit verdict is an ANNOTATION and a SORT KEY, never a gate. The refusals
 * that do exist are the drag path's own, in `resolveDrop`, and they are
 * refusals of writes that cannot succeed rather than fit judgements.
 *
 * This is a DELIBERATE DIVERGENCE from summer (CLAUDE.md §4). Summer's
 * `BunkSwapModal` is the same interaction — a picker started from a bunk — and
 * it DOES hide, via `utils/bunkSwap.ts`'s `isEligibleSwapTarget`. Two things
 * make that right there and wrong here: summer's filter removes a handful of
 * ineligible bunks from a long list where this one would remove nearly
 * everything, and summer's gender rule is a HARD constraint where amenity fit
 * on this board is explicitly advisory (`dragPlacement.ts`: "It never
 * validates fit").
 *
 * ## Why this is not `partyAttention`
 *
 * `partyAttention` answers "does this party's CURRENT cabin fit?" and returns
 * `{ level: 'unplaced' }` before it ever reads its unit argument — so every
 * row in this list, all of them unplaced by definition, would annotate
 * identically no matter which unit was passed. Its `needs_private_bathroom`
 * check reads `party.effective_bathroom`, the server's verdict on the
 * placement the party already has, which is exactly the wrong question for a
 * CANDIDATE. This asks the other question, off the candidate unit's own
 * fields.
 *
 * ## Why this is not `needsFit` — and what they now share
 *
 * `needsFit` (kindred#1912) answers the same shape of question for the card's
 * drag-time hatch. Since kindred#2072 both read ONE grading, `needGlyphs.ts`,
 * so a (need, party, cabin) triple can no longer get two answers. What still
 * differs is SCOPE, and each scope is written down where it lives: the hatch
 * grades three needs (bathroom would hatch 82 of 118 cards on any pick-up —
 * 112 before #2501 and #2502 moved the axis and resolved the containers),
 * this grades all four plus capacity.
 *
 * ⚠️ AND ONE READING, which is this module's own contribution to that
 * consolidation. A candidate has NO PLACEMENT, so its bathroom must be graded
 * against the cabin under consideration and never against
 * `party.effective_bathroom` — the server's verdict on a placement it does not
 * have, which would annotate every unplaced party identically on every cabin.
 * That is `needGlyphs`' `prospective` reading, and this module is why it
 * exists. `partyAttention`, by contrast, asks the PLACED question and returns
 * `{ level: 'unplaced' }` before it ever reads its unit argument, which is
 * what makes it the wrong function for this list.
 *
 * ## The notes shrank on purpose
 *
 * They used to name each unmet need. The rows draw the need GLYPHS now, and
 * N2 makes the glyph the mark — a sentence beside a red bathroom glyph saying
 * the bathroom is missing states one fact twice, the same reason
 * `No private bathroom` was struck from the family card. `notes` is therefore
 * what no glyph can say, which today is capacity alone.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { unplacedFilterGroup, type UnplacedFilterKey } from './unplacedFilters'
import { partyIdentityLabel } from './householdIdentity'
import { resolveNeedGlyphs } from './needGlyphs'
import { worseOf, type NeedsFit } from './needsFit'
import { effectiveSleeps, partyBeds } from './rosterAttention'
import { coveringWriteIns, writeInDemand } from './writeIn'

/** The picker's verdict for one party against one space. `needsFit`'s vocabulary. */
export type CandidateFitLevel = NeedsFit

export interface PlacementCandidate {
  party: RosterPartyRow
  fit: CandidateFitLevel
  /**
   * What is wrong, in staff words, worst dimension first. EMPTY for a party
   * that fits — there is nothing to say, and a row reading "fine" on every
   * card says nothing at all.
   *
   * Never medical narrative, and never a tracker id: these strings are
   * printed to staff.
   */
  notes: string[]
}

/** One row's worth of verdict. `null` notes mean "nothing to say". */
interface DimensionVerdict {
  fit: CandidateFitLevel
  note: string | null
}

/**
 * Will they all sleep here?
 *
 * ANNOTATED, NEVER REFUSED — the owner was explicit: drag permits an
 * over-capacity placement today, so the picker must too. Beds, not people:
 * `partyBeds` is the roster's own reading, which already drops blank and
 * placeholder adult slots and discounts a child under 18 months.
 *
 * `effectiveSleeps` rather than `unit.sleeps`, so a combined house is judged
 * by its whole-house total (its own delta plus its rooms) rather than by
 * whatever the container row happens to carry. An unmeasured space says
 * nothing: `null` is "nobody has counted", not "sleeps nobody".
 *
 * ⚠️ THE ONLY DIMENSION LEFT THAT WRITES A NOTE, and that is the rule rather
 * than an accident of what survived. The four ruled NEEDS draw a glyph on
 * every candidate row (kindred#2072), and N2 makes the glyph itself the mark
 * — a note beside a red bathroom glyph saying the bathroom is missing states
 * one fact twice, which is exactly why `No private bathroom` was struck from
 * the family card. Capacity has no glyph, so it keeps its sentence.
 *
 * ⚠️ IT GRADES THE BEDS LEFT, NOT THE ROOM (owner ruling 2026-08-20), AND IT
 * DID NOT USED TO. `beds <= capacity` asked "would this party fit an empty
 * room", while the header above these rows has asked "will they fit in what
 * is LEFT" since the 2026-08-19 ruling — it prints "2 of 4 beds free". The
 * two disagreed in the one direction that misleads: Aspen sleeps 4 and holds
 * 2, so a three-bed household's row printed a bold green `fits`, and the card
 * behind the dialog read 5/4 in red the moment staff clicked it. The 08-19
 * ruling settled what the header COUNTS and never what the row GRADES, which
 * is why this went back to the owner: *"grade against the remainder,
 * otherwise it makes no sense."*
 *
 * The note counts free beds for the same reason — "sleeps 4" is no longer the
 * number being graded against, so printing it beside "needs 3" invited the
 * reader to do the subtraction the row had just refused to do.
 *
 * @param occupied Beds already taken on this card, which a candidate has to
 *   fit AROUND. `0` for an empty room, and the default — a caller with no
 *   occupancy figure must get the reading this had before, not a room graded
 *   as full.
 */
/**
 * The UNIT-ONLY half of `capacityVerdict`, split out so a list of candidates
 * computes it once instead of once per party (kindred#2540 final scan,
 * FINDING 10).
 *
 * `effectiveSleeps` walks a container's leaves and `writeInDemand` reduces the
 * cover list; neither reads the PARTY. `capacityVerdict` ran both from inside
 * `parties.map(...)`, so a modal over ~80 unplaced parties did 80 identical
 * passes — and `candidates` is memoised on the typed filter, so it re-ran on
 * every keystroke in the search box.
 */
export interface UnitCapacityReading {
  readonly capacity: number | null
  readonly consumed: number
  readonly known: boolean
}

export function readUnitCapacity(
  unit: LodgingUnitRow,
  units: LodgingUnitRow[]
): UnitCapacityReading {
  const capacity = effectiveSleeps(unit, units)
  if (capacity === null) return { capacity: null, consumed: 0, known: false }
  const { consumed, known } = writeInDemand(capacity, coveringWriteIns(unit))
  return { capacity, consumed, known }
}

function capacityVerdict(
  party: RosterPartyRow,
  reading: UnitCapacityReading,
  occupied: number
): DimensionVerdict {
  const { capacity, consumed, known } = reading
  if (capacity === null) return { fit: 'fits', note: null }
  // A written-into room has an occupant `occupied` never counts — a write-in
  // is not a party (kindred#2439) — so its beds have to come from
  // `writeInDemand`, the SAME reading the card's own drag marks fold in
  // (`writeInKnown` in `LodgingUnitCard`, since kindred#2503) and the Assign
  // modal's header states as "N of M beds free". `known` is what decides
  // whether there is a fact to grade against, not `hasWriteIn`: a fully- or
  // partly-unsized cover still asserts an occupant nothing has counted, so
  // this row falls back to the unmeasured-capacity reading above rather than
  // claim a number it does not have. Once every cover on the card carries a
  // recorded `party_size` (or an ancestor's whole-card claim), `consumed`
  // folds into `occupied` exactly as a placed party's own beds already do —
  // a written-into cabin is graded, not exempted, the moment its occupancy
  // is a fact rather than a guess.
  if (!known) return { fit: 'fits', note: null }
  const beds = partyBeds(party)
  // `Math.max(0, …)` for the same reason the header does it: a room already
  // over its capacity has nothing left, never a negative number of beds.
  const free = Math.max(0, capacity - occupied - consumed)
  if (beds <= free) return { fit: 'fits', note: null }
  return {
    fit: 'unmet',
    note: `Over capacity · needs ${String(beds)}, ${String(free)} free`,
  }
}

/**
 * How well one party fits one candidate space.
 *
 * `needs_accommodation` and `accommodation_is_mandatory` are deliberately
 * absent, for the reason `rosterAttention`'s own scope gives: they name no
 * specific amenity, so no field on any cabin settles them and an annotation
 * here could only restate the flag.
 *
 * ⚠️ THIS PARAGRAPH USED TO END "and there is no step-free dimension to add —
 * `is_accessible` exists on the UNIT with nothing on the party side asking for
 * it." That was true when written and is now FALSE twice over: kindred#2438
 * added `needs_step_free` on the party, and this function grades it — the body
 * five lines below calls `resolveNeedGlyphs`, whose closed set carries it.
 * Corrected rather than deleted, because the reasoning it gave for the two
 * accommodation flags is still exactly right.
 *
 * @param units The whole registry, needed only to total a combined house's
 *   capacity. `[]` is correct for every leaf.
 * @param occupied Beds already taken on this card — see `capacityVerdict`.
 */
export function candidateFit(
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  units: LodgingUnitRow[] = [],
  occupied = 0,
  // OPTIONAL, and defaulted so every existing caller is unchanged: this is the
  // unit-only reading `placementCandidates` computes ONCE for a whole list
  // (kindred#2540 final scan, FINDING 10). Passing it is a pure optimisation —
  // `readUnitCapacity(unit, units)` is exactly what the default does.
  reading: UnitCapacityReading = readUnitCapacity(unit, units)
): PlacementCandidate {
  // ONE grading, in `needGlyphs.ts`, read in its PROSPECTIVE sense — see that
  // module's `NeedReading`. All four ruled needs, where this table used to
  // carry two: a family whose narrative asks for a fridge or for step-free
  // access was hatched mid-drag on a cabin that could not supply it and
  // annotated `fits` right here.
  const glyphs = resolveNeedGlyphs(party, unit, 'prospective')
  const capacity = capacityVerdict(party, reading, occupied)

  let fit: CandidateFitLevel = capacity.fit
  for (const glyph of glyphs) fit = worseOf(glyph.verdict, fit)
  return { party, fit, notes: capacity.note === null ? [] : [capacity.note] }
}

/** Best first — the reverse of `needsFit`'s worst-first `FIT_ORDER`. */
const DISPLAY_ORDER: readonly CandidateFitLevel[] = ['fits', 'partial', 'unmet']

/**
 * Every party, annotated and ordered by fit. NOTHING IS OMITTED — see the
 * module doc for why that is a ruling rather than an oversight.
 *
 * Ties break on `sort_name` then the identity label, the same key
 * `FloatingUnplacedBadge` sorts its queue by, so the two lists of the same
 * parties do not disagree about their order.
 */
export function placementCandidates(
  parties: RosterPartyRow[],
  unit: LodgingUnitRow,
  units: LodgingUnitRow[] = [],
  occupied = 0
): PlacementCandidate[] {
  // ONCE for the whole list, not once per party — see `readUnitCapacity`.
  const reading = readUnitCapacity(unit, units)
  return parties
    .map((party) => candidateFit(party, unit, units, occupied, reading))
    .sort((a, b) => {
      const byFit = DISPLAY_ORDER.indexOf(a.fit) - DISPLAY_ORDER.indexOf(b.fit)
      if (byFit !== 0) return byFit
      const bySort = (a.party.sort_name ?? '').localeCompare(b.party.sort_name ?? '')
      if (bySort !== 0) return bySort
      return partyIdentityLabel(a.party).localeCompare(partyIdentityLabel(b.party))
    })
}

/**
 * Split an already-ordered candidate list into a pinned band and the rest —
 * the Assign modal's half of kindred#2480 (owner pick "B", 2026-08-24).
 *
 * ## This is the "never hide" ruling holding, not bending
 *
 * The module doc above rules that a fit-filtered list would be empty most of
 * the time, so this list never removes anyone. A GROUP pin is a different
 * axis and removes nobody either: both halves come back, and the caller
 * renders them one after the other. The arithmetic that makes hiding wrong
 * here makes pinning right — on a 62-party weekend, 4 ask for a bathroom, so
 * hiding would leave 4 rows while pinning surfaces those 4 and keeps 58.
 *
 * ## Why the fit order survives inside each band
 *
 * The input is already sorted by fit then name, and a stable partition keeps
 * that order in both halves. So an over-capacity family never floats above one
 * that fits merely because it asked for a bathroom — the band groups, it does
 * not promote. Fit remains the primary signal; the group is a lens over it.
 *
 * A `null` group is the no-pick case and puts everyone in `rest`, which is
 * exactly today's list.
 */
export function partitionByGroup(
  candidates: PlacementCandidate[],
  group: UnplacedFilterKey | null
): { pinned: PlacementCandidate[]; rest: PlacementCandidate[] } {
  if (!group) return { pinned: [], rest: candidates }
  const { matches } = unplacedFilterGroup(group)
  const pinned: PlacementCandidate[] = []
  const rest: PlacementCandidate[] = []
  for (const candidate of candidates) {
    if (matches(candidate.party)) pinned.push(candidate)
    else rest.push(candidate)
  }
  return { pinned, rest }
}
