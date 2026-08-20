/**
 * Which family to put in THIS space — the list behind the unit card's
 * typeahead (kindred#2080).
 *
 * ## It annotates and orders. It never hides.
 *
 * Owner ruling 2026-08-07, restated 2026-08-09, and it is the opposite of what
 * a "filtered picker" instinct suggests. The reason is arithmetic rather than
 * taste: of 118 production 2026 units, **6** carry a private bathroom and
 * **49 have no power**, while of 459 2026 registrations **63** ask for a
 * private bathroom and **47** ask for power. A list filtered to "what fits"
 * would be empty most of the time, which would make this new path WEAKER than
 * the drag it exists to shorten — staff would go back to dragging.
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
 * grades three needs (bathroom would hatch 112 of 118 cards on any pick-up),
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
import { partyIdentityLabel } from './householdIdentity'
import { resolveNeedGlyphs } from './needGlyphs'
import { worseOf, type NeedsFit } from './needsFit'
import { effectiveSleeps, partyBeds } from './rosterAttention'

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
function capacityVerdict(
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  units: LodgingUnitRow[],
  occupied: number
): DimensionVerdict {
  const capacity = effectiveSleeps(unit, units)
  if (capacity === null) return { fit: 'fits', note: null }
  const beds = partyBeds(party)
  // `Math.max(0, …)` for the same reason the header does it: a room already
  // over its capacity has nothing left, never a negative number of beds.
  const free = Math.max(0, capacity - occupied)
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
  occupied = 0
): PlacementCandidate {
  // ONE grading, in `needGlyphs.ts`, read in its PROSPECTIVE sense — see that
  // module's `NeedReading`. All four ruled needs, where this table used to
  // carry two: a family whose narrative asks for a fridge or for step-free
  // access was hatched mid-drag on a cabin that could not supply it and
  // annotated `fits` right here.
  const glyphs = resolveNeedGlyphs(party, unit, 'prospective')
  const capacity = capacityVerdict(party, unit, units, occupied)

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
  return parties
    .map((party) => candidateFit(party, unit, units, occupied))
    .sort((a, b) => {
      const byFit = DISPLAY_ORDER.indexOf(a.fit) - DISPLAY_ORDER.indexOf(b.fit)
      if (byFit !== 0) return byFit
      const bySort = (a.party.sort_name ?? '').localeCompare(b.party.sort_name ?? '')
      if (bySort !== 0) return bySort
      return partyIdentityLabel(a.party).localeCompare(partyIdentityLabel(b.party))
    })
}
