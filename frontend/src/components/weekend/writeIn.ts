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
  /**
   * WHICH ROW this write is about, when it changes the occupant's own name
   * (kindred#2583 step 4, owner ruling 2026-08-29).
   *
   * `null` RENAMES NOBODY — the Assign modal's create, resolved by
   * `occupantName` exactly as it was. A string is the name the pencil LOADED,
   * and the server compare-and-swaps on it: it resolves that row, writes
   * `occupantName` onto it, and answers 409 if the row is not there rather
   * than falling through to a create.
   *
   * WHY IT EXISTS. Under Design B `(unitId, occupantName)` IS the row's
   * address, so a rename is the one edit that cannot address itself. A write
   * carrying only the new name misses the occupant-keyed finder, and the
   * moment step 8 narrows the unique index that miss becomes a CREATE — one
   * rename leaving two rows, the old occupant still in the cabin, and nothing
   * on screen saying so. #2583's ruling names the two ways out
   * (`previous_occupant_name`, or a delete-then-create dance) and forbids this
   * step's UI from offering a bare in-place rename without one of them.
   *
   * ⚠️ `''` IS A NAME, NOT AN ABSENCE, which is why this is `string | null`
   * and not a blank-defaulted string. A write-in whose occupant nobody named
   * is real and drawn on the board as `UNNAMED_OCCUPANT`, and naming it is the
   * ONLY edit its pencil can make — `WriteInCard.trySubmit` refuses to save a
   * blank. Collapsing `''` into "no rename" would leave exactly that row on
   * the bare-rename path this field closes.
   */
  previousOccupantName: string | null
}

/**
 * What the card's corner × asks the server to remove.
 *
 * DELIBERATELY NOT a `UnitAvailabilityWrite` with a flag. The × used to send
 * `familyAvailable: null`, which is the CLEAR-THIS-UNIT-ENTIRELY verb — the
 * staff↔family role row AND every occupancy row on the unit. That is the same
 * thing as "remove this occupant" only while a cabin can hold one write-in;
 * the moment step 8 narrows the unique index, one click on one occupant's card
 * deletes the co-occupant beside them. `DELETE /api/lodging/write-ins`
 * (kindred#2583 step 7) is the verb that names its row, and this is what a
 * component hands it.
 *
 * The clear verb is unchanged and still reachable — see `LodgingUnitCard`'s
 * own well, where an occupant NOBODY NAMED still uses it, because a blank name
 * addresses no row.
 */
export interface WriteInRemoval {
  /**
   * The unit that HOLDS the row, not the card it was clicked on — the same
   * target `UnitAvailabilityWrite.unitId` carries, and for the same reason: a
   * room can inherit its building's write-in and the building may have no card
   * of its own.
   */
  unitId: string
  /**
   * That unit's name.
   *
   * ⚠️ NOTHING READS IT TODAY, and the comment here used to claim an error
   * message that does not exist (kindred#2603 review). `useUnitAvailability`'s
   * removal forwards only `unitId` and `occupantName` to `deleteWriteIn`, and
   * its `onError` raises the server's own message. It is carried because
   * `UnitAvailabilityWrite.unitName` beside it is carried — the two describe
   * the same target and diverging their shapes would be the worse of the two
   * costs — and it is the field a message naming the cabin would use. Kept
   * with the claim corrected rather than deleted from one of the pair.
   */
  unitName: string
  /**
   * WHICH occupant. The other half of the Design B address. Never blank here:
   * a blank name addresses nothing, and the card sends the clear verb instead.
   */
  occupantName: string
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
  /**
   * A key for THIS entry, unique within the unit's list and stable across
   * re-renders — what the two surfaces that draw an occupant list read for
   * their React `key`, and what `MapUnitPopover` dedupes a cluster on.
   *
   * ⚠️ IT IS NOT THE ROW'S RECORD ID. Publishing that is Design A of the
   * write-in addressing question, which is unanswered, so this is composed
   * from what the wire already carries: `source.unitId`, plus an occurrence
   * number among the covers of this unit that share it.
   *
   * ⇒ IDENTICAL TO `source.unitId` wherever a unit contributes ONE cover,
   * which — while `idx_lodging_write_in_unique` stands — is everywhere. That
   * is deliberate: `source.unitId` is exactly what both call sites used, and
   * anything else here would be a behaviour change dressed as a no-op.
   *
   * The occurrence number, not the position in the list, so a key does not
   * move when an unrelated cover is added above it; and not the occupant's
   * name, so renaming an occupant does not remount their card mid-edit.
   */
  key: string
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
  // How many covers naming this unit have been seen already, so the second
  // one gets a key of its own — see `WriteInEntry.key`. Empty for every card
  // in production today, because the unique index still forbids the second
  // row.
  const seenPerUnit = new Map<string, number>()
  return coveringWriteIns(unit).map((cover) => {
    const unitCode = cover.unit_code ?? ''
    const unitId = cover.unit_id ?? ''
    const seen = seenPerUnit.get(unitId) ?? 0
    seenPerUnit.set(unitId, seen + 1)
    return {
      occupant: {
        name: (cover.occupant_name ?? '').trim(),
        note: (cover.note ?? '').trim(),
        partySize: cover.party_size ?? null,
      },
      source: {
        unitId,
        unitCode,
        unitName: cover.unit_name ?? '',
        isOwn: unitCode === unit.code,
      },
      key: seen === 0 ? unitId : `${unitId}#${String(seen)}`,
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
 * `spots_family_available` read the other, and the pair sits on one screen.
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
 * `known` asks whether every party on this card was SIZED by a human. A
 * recorded size is a fact; an ancestor taking the whole card is a fact (the
 * house is let whole); a wholesale guess about a room that may be shared is
 * not.
 *
 * ⚠️ IT GATES NOTHING IN PRODUCTION ANY MORE, and that is a ruling rather than
 * an oversight — this paragraph used to end *"it gates the Assign modal's
 * header and its candidate rows, which state facts rather than floors"*, and
 * that stopped being true inside kindred#2543's own review. The owner extended
 * the ruling to the modal: *"sure modal can follow the floor, roll that fix in
 * as well."* `capacitySentence` and `capacityVerdict` now read `usable` like
 * the board does, and the header's `occupancy not counted (write-in)` sentence
 * is deleted. `known` is KEPT because it is still the only answer to *"did a
 * human count these people"* — a different question from *"may this number be
 * printed"* — and because it is half of the mirror: `write_in_demand` returns
 * it too, with the same paragraph.
 *
 * ⚠️ `usable` IS A DIFFERENT QUESTION, and reading `known` for it is the
 * defect kindred#2543 was filed for (owner ruling 2026-08-29). It asks whether
 * `consumed` may be PUBLISHED, and it is what the BOARD's drag marks read.
 * `known === false` means three different things and only one of them makes
 * `consumed` meaningless:
 *
 * | # | situation | `consumed` |
 * |---|---|---|
 * | 1 | nobody measured the card | `0`, and meaningless |
 * | 2 | unsized cover on an unmeasured LEAF | the whole card |
 * | 3 | unsized cover on a measured leaf | a real FLOOR |
 *
 * Only (1) withholds. (2) and (3) publish, because an unsized cover is already
 * charged the whole capacity of the unit it NAMES and a party cannot exceed
 * the leaf it sleeps in — so the remainder can only understate what is free,
 * never overstate it. The card used to withhold on all three while the stats
 * bar published a number for the same card; that divergence is what this
 * split closes.
 *
 * ⇒ `usable` IS `capacity !== null` today, in every branch, and it is a
 * returned field rather than a re-derivation at each call site for the same
 * reason the two sums are: it is decided where `consumed` is decided. A future
 * branch that makes `consumed` meaningless again says so here, once.
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
): { consumed: number; sized: number; known: boolean; usable: boolean } {
  // `usable` is NOT vacuously true the way `known` is: with no covers there is
  // no unsized party to spoil `known`, but this branch runs BEFORE the
  // capacity guard, so an unmeasured card reaches it — and an unmeasured,
  // uncovered room must not read as a known zero.
  if (covers.length === 0) return { consumed: 0, sized: 0, known: true, usable: capacity !== null }

  // A fact about people, not about the card — see the doc above. Computed
  // before either guard so neither one can discard it.
  const sized = covers.reduce((total, c) => {
    const relation = c.relation ?? 'own'
    if (relation === 'ancestor' || c.party_size == null) return total
    return total + c.party_size
  }, 0)

  if (capacity === null) {
    // Nothing to subtract from. `consumed` is meaningless here — the ONE
    // meaning of `known: false` that also withholds `usable`, and the reason
    // the two are separate fields. `sized` survives regardless.
    return { consumed: 0, sized, known: false, usable: false }
  }

  if (covers.some((c) => (c.relation ?? 'own') === 'ancestor')) {
    // Whole-card, and order-independent by construction: a pre-pass, not a
    // value the loop happens to have accumulated so far. `known=true`
    // unconditionally, because the guard above has already returned for
    // every unmeasured card.
    return { consumed: capacity, sized, known: true, usable: true }
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
      // measured, so nothing on this card is offerable. `usable` is TRUE and
      // the two are not in tension: "the whole card is taken" is a bound, not
      // a guess, and 0 free is a number both surfaces can state.
      return { consumed: capacity, sized, known: false, usable: true }
    }
    consumed += sourceCapacity
  }
  return { consumed: Math.min(consumed, capacity), sized, known, usable: true }
}

/**
 * The counts the `People` control offers — blank, then these.
 *
 * ONE LIST, TWO SURFACES: the Assign modal's write-in form and `WriteInCard`'s
 * pencil both import it, for the same reason `writeInDemand` is imported rather
 * than re-derived. Two lists are two answers to "what can a write-in be for".
 *
 * ⚠️ A CONTROL THAT CANNOT EXPRESS A BAD VALUE, replacing one that had to
 * refuse them (owner ruling 2026-08-23). `<input type="number">` sanitises
 * anything unparseable to `''` before React sees it, making `abc`
 * indistinguishable from an untouched field; the only surviving signal,
 * `validity.badInput`, reaches nothing because React suppresses `onChange`
 * whenever the value string does not change — which is every keystroke into an
 * already-blank field, and blank is how the control opens. A `<select>` cannot
 * emit a value that is not an option, so `0`, fractions, exponent notation and
 * unparseable text are not refused: they cannot be expressed.
 *
 * BOUND 20, NOT THE UNIT'S CAPACITY, and both halves are deliberate.
 * Measured against the registry: the largest unit sleeps 19, so 20 covers
 * every real cabin; and 15 of 118 units record no capacity at all, so a
 * capacity-derived list would collapse to blank-only on exactly the units
 * where writing a headcount down matters most.
 *
 * It also keeps OVER-CAPACITY reachable, which is an acceptance criterion of
 * kindred#2503 rather than an oversight: six people written into a four-bed
 * room is what the card's red figure exists to show, and `sized` is left
 * uncapped through the whole rule so it can. A list stopping at the room's own
 * capacity would make that state unenterable and quietly retire the red.
 */
export const PARTY_SIZE_CHOICES: readonly number[] = Array.from({ length: 20 }, (_, i) => i + 1)

/**
 * `PARTY_SIZE_CHOICES`, plus a recorded count the list cannot otherwise express.
 *
 * ⚠️ A `<select>` WHOSE VALUE MATCHES NO OPTION FALLS BACK TO ITS FIRST ONE,
 * silently (kindred#2540 final scan, FINDING 4). The first option here is the
 * blank em dash, which means WHOLESALE -- so a row holding 25 opened its
 * pencil reading "the whole room" while the card beside it drew a red `25/4`.
 * Two answers about one row, on one screen.
 *
 * It is reachable because the bound is a CONTROL affordance, not a rule:
 * `AvailabilityWriteRequest.party_size` is `Field(None, ge=1)` with no upper
 * bound and the PocketBase column is `max: null`, deliberately, so that an
 * over-capacity count stays writable. Nothing in the product writes above 20
 * today -- both surfaces cap there and the two seed paths copy verbatim -- so
 * this needs an API or import caller. That is exactly why it must not be
 * silent when it happens.
 *
 * APPENDED rather than sorted in, so the ordinary 1-20 run is undisturbed and
 * the odd value sits at the end where its magnitude puts it. Keyed on the
 * RECORDED count rather than the draft, so it survives the staff member
 * picking another value and changing their mind back.
 */
export function partySizeOptions(recorded: number | null): readonly number[] {
  if (recorded === null || PARTY_SIZE_CHOICES.includes(recorded)) return PARTY_SIZE_CHOICES
  return [...PARTY_SIZE_CHOICES, recorded]
}
