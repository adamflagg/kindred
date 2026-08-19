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
 * ## Why this is not `needsFit`
 *
 * `needsFit` (kindred#1912) answers the same shape of question for the card's
 * drag-time hatch, and shares this module's `fits/partial/unmet` vocabulary
 * and its `worseOf` precedence — imported, not re-declared. What it does not
 * share is the DIMENSION TABLE, deliberately: its list drives a mark painted
 * on ~82 cards mid-drag, whereas a row in this list has room for a sentence.
 * Adding bathroom and capacity there to reach them here would have changed a
 * shipped board treatment as a side effect.
 *
 * ⚠️ THE TWO TABLES HAVE DIVERGED, and the divergence is a live decision
 * rather than an oversight. `needsFit` was seeded with power ALONE; kindred#2224
 * added `needs_fridge` there and NOT here, and kindred#2438 added
 * `needs_step_free` on the same terms — so a family whose housing narrative
 * asks for a fridge or for step-free access is hatched mid-drag on a cabin
 * that cannot supply it and annotated `fits` in this picker (and reported
 * `settled` by `rosterAttention`'s `VERIFIABLE_NEEDS`, which carries neither).
 * Whether those needs earn a sentence here and a roster-row reason there is a
 * staff-copy question that belongs with kindred#2072's ruled glyph set
 * (bathroom · power · fridge) — it is not settled by this comment, and the
 * step-free need is not in that ruled set at all. Until it is, do not assume
 * silence here means the need does not apply.
 *
 * The power rule is stated in both places. ⚠️ CHANGE ONE, CHANGE
 * BOTH — same field (`power_coverage`, never the raw `has_power`), same
 * grading, same `unknown → fits`.
 */
import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { partyIdentityLabel } from './householdIdentity'
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

const FITS: DimensionVerdict = { fit: 'fits', note: null }

/**
 * Does the space give this party its own bathroom?
 *
 * Reads `unit.bathroom` — the candidate row's own field, which is also what
 * the card's amenity strip prints, so the annotation can never contradict the
 * card it sits inside. It is NOT `party.effective_bathroom`: that is the
 * server's answer about the placement the party already has, and every party
 * in this list has none.
 *
 * `unknown` (and an absent field) report `fits` with no note. The absence of
 * evidence is not evidence of absence — the same bar `needsFit`'s `unknown`
 * coverage and `rosterAttention`'s `is_confirmed` gate already apply.
 */
function bathroomVerdict(party: RosterPartyRow, unit: LodgingUnitRow): DimensionVerdict {
  if (party.flags?.needs_private_bathroom !== true) return FITS
  const bathroom = unit.bathroom ?? 'unknown'
  if (bathroom === 'private' || bathroom === 'unknown') return FITS
  // Same wording as `rosterAttention`'s `VERIFIABLE_NEEDS` entry for this
  // need. Staff read both surfaces; two phrasings of one fact read as two
  // facts.
  return { fit: 'unmet', note: 'No private bathroom' }
}

/**
 * Does the space have power where this party needs it?
 *
 * ⚠️ The twin of `needsFit`'s POWER dimension — see the module doc. Uses
 * `power_coverage`, the server's resolution over the unit's LEAF descendants,
 * never the raw `has_power`: twelve of the fourteen 2026 family-pool
 * containers record `has_power = 0` while every leaf beneath them has power,
 * so the raw flag marks twelve entirely-powered buildings unpowered.
 *
 * SOME is softer than NONE here, as it is there: a building where some rooms
 * have power is a real improvement on one where none do.
 */
function powerVerdict(party: RosterPartyRow, unit: LodgingUnitRow): DimensionVerdict {
  if (party.flags?.needs_power !== true) return FITS
  const coverage = unit.power_coverage ?? 'unknown'
  if (coverage === 'none') return { fit: 'unmet', note: 'No power' }
  if (coverage === 'some') return { fit: 'partial', note: 'Some rooms have power' }
  return FITS
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
 */
function capacityVerdict(
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  units: LodgingUnitRow[]
): DimensionVerdict {
  const capacity = effectiveSleeps(unit, units)
  if (capacity === null) return FITS
  const beds = partyBeds(party)
  if (beds <= capacity) return FITS
  return {
    fit: 'unmet',
    note: `Over capacity · needs ${String(beds)}, sleeps ${String(capacity)}`,
  }
}

/**
 * How well one party fits one candidate space.
 *
 * `needs_accommodation` and `accommodation_is_mandatory` are deliberately
 * absent, for the reason `rosterAttention`'s `VERIFIABLE_NEEDS` gives: they
 * name no specific amenity, so no field on any cabin settles them and an
 * annotation here could only restate the flag. And there is no step-free
 * dimension to add — `is_accessible` exists on the UNIT with nothing on the
 * party side asking for it.
 *
 * @param units The whole registry, needed only to total a combined house's
 *   capacity. `[]` is correct for every leaf.
 */
export function candidateFit(
  party: RosterPartyRow,
  unit: LodgingUnitRow,
  units: LodgingUnitRow[] = []
): PlacementCandidate {
  const verdicts = [
    bathroomVerdict(party, unit),
    powerVerdict(party, unit),
    capacityVerdict(party, unit, units),
  ]
  let fit: CandidateFitLevel = 'fits'
  const notes: string[] = []
  for (const verdict of verdicts) {
    fit = worseOf(verdict.fit, fit)
    if (verdict.note !== null) notes.push(verdict.note)
  }
  return { party, fit, notes }
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
  units: LodgingUnitRow[] = []
): PlacementCandidate[] {
  return parties
    .map((party) => candidateFit(party, unit, units))
    .sort((a, b) => {
      const byFit = DISPLAY_ORDER.indexOf(a.fit) - DISPLAY_ORDER.indexOf(b.fit)
      if (byFit !== 0) return byFit
      const bySort = (a.party.sort_name ?? '').localeCompare(b.party.sort_name ?? '')
      if (bySort !== 0) return bySort
      return partyIdentityLabel(a.party).localeCompare(partyIdentityLabel(b.party))
    })
}
