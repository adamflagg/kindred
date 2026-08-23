/**
 * A write-in: a named occupant the system does not know about — kindred#2078.
 *
 * Owner ruling, 2026-08-09: *"only one, hold is the write in"*. Staff never
 * used Hold to reserve an empty room. They used it to record somebody sleeping
 * in one — almost always non-rostered weekend staff — so the room read as
 * *empty and closed* when in truth it was *full*. There is ONE control and one
 * action; the occupant name is what the row was always for.
 *
 * ## What a write-in is a fact ABOUT — and what it is not
 *
 * A SPACE, and a PLAN. It says somebody is in this room; it says nothing about
 * whether the room is staff housing or family inventory, which is the separate
 * staff↔family ROLE question. kindred#2382 split those two apart after they
 * had shared one boolean:
 *
 * | fact | stored in | scoped to |
 * |---|---|---|
 * | staff↔family ROLE | `lodging_availability` | the WEEKEND — every plan sees it |
 * | write-in OCCUPANCY | `lodging_write_ins` / `_draft` | the SCENARIO that made it |
 *
 * The occupancy is scenario-scoped because not every write-in is non-rostered
 * staff: some are paper registrations for families arriving with no children,
 * and that is a modelling choice belonging to the plan that made it. The role
 * is not, because a release names no occupant — "we're moving staff to X for
 * weekend Y" is true whichever plan you are looking at.
 *
 * ## Why this is a module and not an inline `=== false`
 *
 * The board already had that expression, spelled `held`, in three places. One
 * of them was load-bearing in a way a rename would have silently broken:
 * #2093's forest open-tint suppresses itself on a written-into room, and it did
 * so by testing `unit.family_available_override === false` — a PROXY for "is
 * somebody in it". Reading the fact through one named function is what let the
 * proxy be retired here, once, instead of in every consumer: that field now
 * answers the ROLE alone, and `write_ins` answers this one.
 *
 * ## What is deliberately NOT here
 *
 * No fallback from `name` to `note`. 1500000148 moved every historical note
 * into `occupant_name` and cleared the column behind it, because the same
 * string rendered as both the occupant's NAME and the card's italic reason line
 * printed twice on one card. A fallback would restore that by another route.
 *
 * No fallback from `write_ins` to `family_available_override === false` either,
 * and that one was deliberately removed rather than never written — see
 * `coveringWriteIns`.
 */
import type { LodgingUnitRow, WriteInCoverRow } from '../../types/lodging'

/** Who is in a room, and anything staff said about them. */
/**
 * What a write to `set_availability` says.
 *
 * ⚠️ IT LIVED IN `UnitAvailabilityControl.tsx` UNTIL kindred#2072, and moved
 * here when that control was cut from the board (vocabulary §3: the `Released`
 * badge and the `Release` / `Clear` control both need a staff unit or an
 * existing override, and this board has neither). Nothing renders that control
 * any more, so the type had to leave with it — and this is the right home,
 * because every remaining producer of this write is a WRITE-IN: the Assign
 * modal creates one, and each `WriteInCard`'s pencil and X edit and remove one.
 *
 * The `familyAvailable: true` arm survives in the shape rather than in any UI:
 * the endpoint still accepts it, and releasing a staff cabin to families is a
 * registry edit on the season's row (Manage → Lodging) rather than a
 * per-weekend override.
 */
export interface UnitAvailabilityWrite {
  /**
   * The unit the write NAMES, which is not always the card it came from.
   *
   * A write-in covers a space and the board draws whichever level the unit
   * tree resolves to, so a room can inherit its building's write-in and a
   * merged building one of its rooms'. Removing one has to target the unit
   * that HOLDS the row — the card's own id would delete nothing, and the unit
   * holding the row has no card of its own.
   *
   * TWO CALLERS: the Assign modal, which always names the card's own unit,
   * and each `WriteInCard`'s corner X, which sends this same write bound to
   * the row that card draws. The field carries the target either way.
   */
  unitId: string
  /** That unit's name, for the confirmation toast. */
  unitName: string
  familyAvailable: boolean | null
  /** Who is in the room. `''` on a clear. */
  occupantName: string
  /** The write-in's optional note. `''` on a clear. */
  reason: string
  /**
   * How many people the write-in is for (kindred#2503). `null` is a REAL
   * value — "nobody recorded a count" — never a missing one, matching
   * `WriteInOccupant.partySize` above: most write-ins are non-rostered staff
   * and staff will type nothing, so `null` is the common case and stays that
   * way, not a legacy branch on its way out.
   *
   * FOUR PRODUCERS, not three (kindred#2540 fix-round CHEAP 6 — this
   * paragraph used to say three and describe a form that, by the time this
   * PR landed, already touched the field). The Assign modal's `People`
   * field sends what staff typed, or `null` when they typed nothing. The
   * X (`onRemove`) sends `null` unconditionally — harmless, because
   * `family_available: null` deletes the row before `set_availability` ever
   * reaches the party-size upsert. The pencil (`onEdit`) sends whatever its
   * OWN `People` field currently holds: seeded from the row's recorded count
   * when the pencil opens, and staff's own edit if they changed it —
   * `WriteInCard.tsx`'s `onEdit` prop doc and `LodgingUnitCard.tsx`'s call
   * site both spell out the forward. `party_size` rides in every write-in
   * upsert's payload regardless of what else the form asked about, so a save
   * that sent `null` here on an unrelated note edit would silently erase a
   * count a staff member had already recorded — the data-loss guard the
   * pencil's own form now carries.
   *
   * THE FOURTH never touches this TypeScript type at all:
   * `_seed_write_ins` (`api/services/lodging_write_service.py`) copies one
   * weekend's write-ins into a scenario server-side, row for row, and
   * carries `party_size` along unchanged for the identical reason this
   * guard exists here — a dropped count is not a smaller row, it is a
   * DIFFERENT one, and an unsized copy of a sized write-in would silently
   * widen "2 of 5 beds" into "the whole cabin".
   */
  partySize: number | null
}

export interface WriteInOccupant {
  /**
   * The occupant's name, or `''` when nobody named them.
   *
   * Empty is reachable and is not an error: the write schema is permissive
   * where the control is not (an ingest or a fixture has no author to ask), and
   * a row written before 1500000148 whose note was empty backfills to nothing.
   */
  name: string
  /**
   * The optional note beside the name — "so next week's staff can act on it".
   *
   * PROSPECTIVE ONLY. 1500000148 cleared the note of every row it copied, so
   * no historical write-in carries one and an empty column here is correct
   * rather than a bug.
   */
  note: string
  /**
   * How many people the row is for, or `null` when nobody recorded a count.
   *
   * `null` means *occupies wholesale* — never "zero people" — and it is the
   * PERMANENT common case, not a legacy or transitional one: most write-ins
   * are non-rostered staff, and staff will type nothing. `writeInDemand`
   * (below) is the one place that reading turns into arithmetic; this field
   * exists so `WriteInCard`'s pencil (a later task) can seed an edit form
   * from a recorded size instead of starting blank every time.
   */
  partySize: number | null
}

/**
 * WHO is in this space and WHOSE row says so, kept together — one entry per
 * write-in covering the unit.
 *
 * A PAIR rather than two functions returning two arrays, which is what this
 * was until kindred#2381 (`writeInOccupant` / `writeInSource`). Splitting them
 * was right while there was exactly one cover: "who is in this space" is what
 * the card prints and "whose row is this" is what a CLEAR has to name, and
 * sending the card's own id for an inherited write-in would delete nothing at
 * all. With N covers on one card the two answers have to stay lined up — the X
 * drawn on the third card must delete the THIRD row — and index alignment held
 * by hand across two arrays is the invariant that rots first.
 */
export interface WriteInEntry {
  occupant: WriteInOccupant
  source: WriteInSource
}

/**
 * Where a unit's write-in is recorded.
 *
 * A room can inherit its building's row and a merged building one of its
 * rooms', so this is not always the unit the card draws.
 */
export interface WriteInSource {
  /** The unit the `lodging_write_ins` row belongs to — a removal's target. */
  unitId: string
  unitCode: string
  unitName: string
  /** Whether the row is this unit's own, rather than inherited through the tree. */
  isOwn: boolean
}

/**
 * What to print for a write-in whose `occupant_name` is blank.
 *
 * SHARED, because two surfaces now draw the same occupant and a room that
 * reads "Occupant not named" on the board and blank on the map is two
 * different answers to one question. `WriteInCard` held this privately until
 * kindred#2499 gave the map an occupant list of its own.
 *
 * Not the empty string and not "Unknown": the row asserts that somebody is in
 * the room, and only their NAME is missing.
 */
export const UNNAMED_OCCUPANT = 'Occupant not named'

/** The name to print for a write-in occupant, blank-safe. */
export function writeInOccupantLabel(occupant: WriteInOccupant): string {
  return occupant.name !== '' ? occupant.name : UNNAMED_OCCUPANT
}

/**
 * Every write-in closing this space for this weekend, in the server's order.
 *
 * "This space", not "this unit": a building's write-in closes its rooms and a
 * room's closes its building as a whole-house let, and the board draws
 * whichever level the unit tree resolves to. The server does that walk
 * (`write_in_covers`) and this reads its answer.
 *
 * PLURAL since kindred#2381, and the arity is the fix rather than a
 * generalisation. A merged container stands in for its rooms, so the four
 * write-ins one 2026 building carries in a single weekend all land on one
 * card — and returning the first hid three occupants while making each clear
 * read as a failed click, because the card immediately re-populated with the
 * next name. An assignment survives a merge and a split by having the drawn
 * card carry however many leaves it covers; this is a write-in doing the same.
 *
 * ORDERED BY THE SERVER (`code` at every level), never re-sorted here: two
 * places deciding the sequence is two places that can disagree about it.
 */
export function writeInEntries(unit: LodgingUnitRow): WriteInEntry[] {
  return coveringWriteIns(unit).map((cover) => {
    const unitCode = cover.unit_code ?? ''
    return {
      occupant: {
        name: (cover.occupant_name ?? '').trim(),
        note: (cover.note ?? '').trim(),
        partySize: cover.party_size ?? null,
      },
      source: {
        unitId: cover.unit_id ?? '',
        unitCode,
        unitName: cover.unit_name ?? '',
        isOwn: unitCode === unit.code,
      },
    }
  })
}

/**
 * Whether ANY write-in closes this space.
 *
 * The gate every consumer that only needs the yes/no reads — the drop refusal
 * (`dragPlacement`), its affordance half on the card, and the "Write-in" chip.
 * Spelled once so a merged card covering four occupants and a room covering
 * one are the same answer to those three, which `!== null` on a single cover
 * silently stopped being.
 */
export function hasWriteIn(unit: LodgingUnitRow): boolean {
  return coveringWriteIns(unit).length > 0
}

/**
 * The server-resolved covers, and NOTHING else.
 *
 * ## Why the old fallback is gone rather than merely unused
 *
 * This used to synthesise a cover from `unit.family_available_override ===
 * false` plus the unit's own `occupant_name`, for a payload from a server older
 * than `write_in_covers`. That fallback was safe only while `false` MEANT an
 * occupancy — which it did, because the wire spelled one that way as a compat
 * shim while kindred#2382 was landing in four parts.
 *
 * PR 4 retired the shim. `family_available_override` now answers the
 * staff↔family ROLE alone, so a `false` is "closed by role" and names nobody:
 * reading it here would report an occupant the cabin does not have, on a card
 * whose whole job is to say who is in the room. A permissive default is the
 * usual danger (`shareabilityBadge` makes that argument at its own), but a
 * fabricated occupant is not the conservative answer — it is a different wrong
 * one, and it would also block placement into a cabin that is merely closed.
 *
 * There is no gap left to guard. `write_ins` is built for every unit the API
 * returns, and a unit with neither a cover nor a role row is simply open. The
 * `?? []` is for the FIELD being absent from an older payload, not for a unit
 * the walk declined to answer for.
 *
 * EXPORTED so the board, the Assign modal and the map peek each hand THEIR
 * covers to `writeInDemand` rather than re-deriving "which write-ins cover
 * this unit" on their own — the same drift `hasWriteIn`'s doc warns about.
 * Round 2 of kindred#2528's scan already caught one site hand-rolling
 * `writeInEntries(unit).length > 0` where `hasWriteIn(unit)` existed; this is
 * that lesson applied before a second site can repeat it.
 */
export function coveringWriteIns(unit: LodgingUnitRow): WriteInCoverRow[] {
  return unit.write_ins ?? []
}

/**
 * What the write-ins covering this card take from it.
 *
 * ⚠️ THE MIRROR of `write_in_demand` in `api/services/lodging_rules.py`. Keep
 * the two in step — the card's numerator, the Assign modal's header and the
 * map peek read this one, while `is_family_available` and
 * `beds_family_available` read the other, and the pair sits on one screen.
 * The same pairing discipline `effectiveSleeps` documents for
 * `_effective_sleeps`.
 *
 * It takes a CAPACITY and COVERS, not a unit and the registry, because
 * `MapUnitPopover` never receives the full registry — its own `units` prop is
 * documented as "only a cluster's members… cannot answer the question
 * alone". Each cover now publishes its own `unit_sleeps` (the effective
 * capacity of the unit the row NAMES), which is what makes that possible.
 *
 * TWO SUMS, and collapsing them is the mistake this shape exists to stop:
 *
 * `sized` is what the NUMERATOR prints — recorded counts from the card's own
 * row and from written-into rooms beneath it, and nothing else. Never a
 * wholesale fallback, which would put a headcount nobody recorded on the
 * card; never an ancestor's count, which is a fact about the house rather
 * than about this room. It is a PRE-PASS over every non-ancestor cover
 * carrying a recorded `party_size`, computed before either guard below runs
 * and never depending on `capacity` — a cabin nobody has measured, holding a
 * two-person write-in, still prints `2/-`, not `-/-`. `sized` is also
 * deliberately UNCAPPED, unlike `consumed`: a hand-typed count above the
 * card's own beds is what drives kindred#2503's over-capacity red, so the
 * numerator has to carry the true recorded figure.
 *
 * `consumed` is what the BEDS arithmetic pays — the same recorded counts plus
 * the wholesale fallback plus an ancestor's whole-card claim.
 *
 * `known` asks whether `consumed` is a FACT, and gates kindred#2528's two
 * drag-time capacity marks. A recorded size is a fact; an ancestor taking the
 * whole card is a fact (the house is let whole); a wholesale guess about a
 * room that may be shared is not.
 *
 * AN ANCESTOR TAKES THE WHOLE CARD, decided by a PRE-PASS over `covers`
 * rather than inside the per-cover loop, so the answer cannot depend on where
 * in the list the ancestor sits. The house was let whole and a room inside it
 * is not separately lettable — the alternative, each room subtracting the
 * ancestor's size, spends one party once per room and would report a
 * seven-bed house holding four people as having five beds free.
 */
export function writeInDemand(
  capacity: number | null,
  covers: WriteInCoverRow[]
): { consumed: number; sized: number; known: boolean } {
  if (covers.length === 0) return { consumed: 0, sized: 0, known: true }

  // A fact about people, not about the card — see the doc above. Computed
  // before either guard so neither one can discard it.
  const sized = covers.reduce((total, c) => {
    const relation = c.relation ?? 'own'
    if (relation === 'ancestor' || c.party_size == null) return total
    return total + c.party_size
  }, 0)

  if (capacity === null) {
    // Nothing to subtract from. `consumed` is meaningless here and callers
    // must read `known` before using it. `sized` survives regardless.
    return { consumed: 0, sized, known: false }
  }

  if (covers.some((c) => (c.relation ?? 'own') === 'ancestor')) {
    // Whole-card, and order-independent by construction: a pre-pass, not a
    // value the loop happens to have accumulated so far. `known=true`
    // unconditionally, because the guard above has already returned for
    // every unmeasured card.
    return { consumed: capacity, sized, known: true }
  }

  let consumed = 0
  let known = true
  for (const c of covers) {
    if (c.party_size != null) {
      consumed += c.party_size
      continue
    }
    known = false
    // The cover's OWN unit's beds, published by the server (`unit_sleeps`)
    // rather than looked up here — the map popover has no registry to look
    // it up in.
    const sourceCapacity = c.unit_sleeps ?? null
    if (sourceCapacity === null) {
      // An unbounded wholesale claim: somebody is in a space nobody
      // measured, so nothing on this card is offerable.
      return { consumed: capacity, sized, known: false }
    }
    consumed += sourceCapacity
  }
  return { consumed: Math.min(consumed, capacity), sized, known }
}
