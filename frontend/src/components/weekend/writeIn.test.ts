/**
 * A write-in is a named occupant of a space — kindred#2078, kindred#2382, kindred#2381.
 *
 * The single definition of "who is written into this space", and the one the
 * board reads. It exists because #2093's forest open-tint was written against
 * the PROXY `unit.family_available_override === false` under the name `held`,
 * and a rename alone would have left the tint keyed on a spelling rather than
 * on the fact.
 *
 * THAT PROXY IS GONE, which is what these tests pin. kindred#2382 moved
 * occupancy into its own table and stopped the wire spelling one as
 * `family_available_override === false`; that field answers the staff↔family
 * ROLE and nothing else. Every fixture below that means "somebody is in it"
 * therefore carries a `write_ins` entry, and a bare `false` means "closed by
 * role", which names nobody.
 *
 * PLURAL since kindred#2381. A merged container draws in place of its rooms,
 * so a card can cover several written-into rooms at once and every one of them
 * has to reach the screen.
 *
 * Fictional data throughout. Production write-in notes are real family and
 * staff names; nothing here is dumped from any database.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, WriteInCoverRow } from '../../types/lodging'
import { hasWriteIn, writeInDemand, writeInEntries } from './writeIn'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 4,
    bathroom: 'shared',
    bathroom_group: '',
    near_bathhouse: false,
    has_power: false,
    has_ac: false,
    has_fridge: false,
    is_accessible: false,
    is_confirmed: false,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    family_available_override: null,
    occupant_name: '',
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

/** The server-resolved cover, which is the ONLY source of "somebody is in it". */
function cover(overrides: Partial<WriteInCoverRow> = {}): WriteInCoverRow {
  return {
    unit_id: 'u1',
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    occupant_name: '',
    note: '',
    ...overrides,
  }
}

describe('writeInEntries', () => {
  it('names the occupant of a room somebody has been written into', () => {
    expect(
      writeInEntries(
        unit({
          write_ins: [cover({ occupant_name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun' })],
          occupant_name: 'Emma Johnson',
          reason: 'Kitchen lead, Fri–Sun',
          is_family_available: false,
        })
      ).map((entry) => entry.occupant)
    ).toEqual([{ name: 'Emma Johnson', note: 'Kitchen lead, Fri–Sun', partySize: null }])
  })

  it('is empty for a room the ROLE closed, which names nobody', () => {
    // kindred#2382. `family_available_override === false` used to BE the
    // write-in — the occupancy and the staff↔family role shared one boolean.
    // With the two apart, a bare `false` is a role decision ("closed this
    // weekend") with no occupant behind it, and reading it as a write-in would
    // have the card report somebody who exists in no row anywhere.
    const roleClosed = unit({ family_available_override: false, is_family_available: false })
    expect(writeInEntries(roleClosed)).toEqual([])
    expect(hasWriteIn(roleClosed)).toBe(false)
  })

  it('is empty for a room nobody has written into', () => {
    // `null` on the override means "no row for this weekend, ask the unit's
    // role" — not "closed". Collapsing the two is the failure `reservationBadge`
    // documents at length, arriving one module over.
    expect(writeInEntries(unit())).toEqual([])
    expect(writeInEntries(unit({ family_available_override: null }))).toEqual([])
  })

  it('is empty for a staff cabin RELEASED to families', () => {
    // A release opens a room; it names no occupant. `true` and `false` are
    // opposite answers and only one of them is a write-in.
    expect(
      writeInEntries(
        unit({
          inventory_class: 'staff_default',
          family_available_override: true,
          reason: 'Overflow',
        })
      )
    ).toEqual([])
  })

  it('still reports a write-in whose occupant nobody named', () => {
    // Reachable from a row written before 1500000148, or through the API,
    // which is permissive where the control is not. The room is still closed,
    // so reporting "no write-in" here would hand it back to the open-tint and
    // send staff at the one room they may not fill.
    const entries = writeInEntries(unit({ write_ins: [cover()], is_family_available: false }))
    expect(entries.map((entry) => entry.occupant)).toEqual([
      { name: '', note: '', partySize: null },
    ])
  })

  it('treats a whitespace-only occupant as unnamed rather than as a name', () => {
    expect(
      writeInEntries(
        unit({ write_ins: [cover({ occupant_name: '   ' })], is_family_available: false })
      ).map((entry) => entry.occupant)
    ).toEqual([{ name: '', note: '', partySize: null }])
  })

  it('does not fall back to the note when the occupant is unnamed', () => {
    // 1500000148 MOVED every historical note into `occupant_name` and cleared
    // the column behind it, precisely so one string cannot render twice on one
    // card. A fallback here would restore that double-print by another route.
    expect(
      writeInEntries(
        unit({
          write_ins: [cover({ note: 'Back Monday' })],
          reason: 'Back Monday',
          is_family_available: false,
        })
      ).map((entry) => entry.occupant)
    ).toEqual([{ name: '', note: 'Back Monday', partySize: null }])
  })

  it('treats a payload with no write_ins key at all as uncovered', () => {
    // The field is OPTIONAL on the wire, so an older or partial payload omits
    // it entirely. `undefined` is "no cover", never a crash on `.length`.
    const bare = unit()
    delete (bare as { write_ins?: unknown }).write_ins
    expect(writeInEntries(bare)).toEqual([])
    expect(hasWriteIn(bare)).toBe(false)
  })
})

describe('a write-in resolved through the unit tree', () => {
  /*
   * THE ROW NAMES ONE UNIT; IT CLOSES A SPACE. The server resolves which units
   * a write-in covers (`write_in_covers`), because the board draws whichever
   * level the tree resolves to and a merge or split moves that level under
   * staff's feet. Read through this module, both directions arrive as the same
   * fact — which is the whole reason the fact has a name.
   */
  const inherited = unit({
    code: 'house-a',
    write_ins: [
      {
        unit_id: 'id-house',
        unit_code: 'house',
        unit_name: 'House',
        occupant_name: 'Liam Garcia',
        note: 'Back Monday',
      },
    ],
  })

  it('names the occupant of a room its BUILDING was written into', () => {
    expect(writeInEntries(inherited).map((entry) => entry.occupant)).toEqual([
      { name: 'Liam Garcia', note: 'Back Monday', partySize: null },
    ])
  })

  it('reports the row it came from, and that it is not this unit’s own', () => {
    expect(writeInEntries(inherited).map((entry) => entry.source)).toEqual([
      { unitId: 'id-house', unitCode: 'house', unitName: 'House', isOwn: false },
    ])
  })

  it('marks a unit’s OWN row as its own, so the card does not attribute it elsewhere', () => {
    const own = unit({
      code: 'cedar-1',
      write_ins: [
        {
          unit_id: 'u1',
          unit_code: 'cedar-1',
          unit_name: 'Cedar 1',
          occupant_name: 'Emma Johnson',
          note: '',
        },
      ],
    })

    expect(writeInEntries(own)[0]?.source.isOwn).toBe(true)
  })

  it('reads the cover and never the old proxy, so a role row cannot fake one', () => {
    // THE COMPAT SHIM, retired by kindred#2382 PR 4. This used to synthesise a
    // cover from `family_available_override === false` plus the unit's own
    // `occupant_name`, because the wire had no other way to say "somebody is in
    // it". It has one now — `write_ins` is resolved server-side on every unit —
    // and the old spelling means something else entirely, so reading it would
    // report an occupant a role-closed cabin does not have.
    expect(
      writeInEntries(
        unit({
          family_available_override: false,
          occupant_name: 'Emma Johnson',
          is_family_available: false,
        })
      )
    ).toEqual([])
  })

  it('says nothing when neither a cover nor an own row closes the space', () => {
    expect(writeInEntries(unit())).toEqual([])
    expect(hasWriteIn(unit())).toBe(false)
  })
})

describe('a merged container over several written-into rooms', () => {
  /*
   * THE REPORTED CASE — kindred#2381. A container that draws combined stands in
   * for its rooms, so all four of its written-into leaves resolve onto its one
   * card. Returning one of them hid three occupants and made each clear look
   * like a failed click as the card re-populated with the next name.
   */
  const merged = unit({
    unit_id: 'id-house',
    code: 'house',
    name: 'House',
    is_container: true,
    is_combined: true,
    write_ins: [
      cover({
        unit_id: 'id-back',
        unit_code: 'house-back',
        unit_name: 'House Back',
        occupant_name: 'Emma Johnson',
      }),
      cover({
        unit_id: 'id-loft',
        unit_code: 'house-loft',
        unit_name: 'House Loft',
        occupant_name: 'Liam Garcia',
      }),
      cover({
        unit_id: 'id-side',
        unit_code: 'house-side',
        unit_name: 'House Side',
        occupant_name: 'Olivia Martinez',
      }),
    ],
  })

  it('names every occupant the card covers, in the order the server sent them', () => {
    expect(writeInEntries(merged).map((entry) => entry.occupant.name)).toEqual([
      'Emma Johnson',
      'Liam Garcia',
      'Olivia Martinez',
    ])
  })

  it('pairs each occupant with the row that holds it, so a removal targets that row', () => {
    // The pairing is the point of one entry rather than two parallel arrays:
    // an X drawn on the third card must delete the THIRD row, and index
    // alignment maintained by hand is exactly the invariant that rots.
    expect(writeInEntries(merged).map((entry) => entry.source.unitId)).toEqual([
      'id-back',
      'id-loft',
      'id-side',
    ])
    expect(writeInEntries(merged).every((entry) => !entry.source.isOwn)).toBe(true)
  })

  it('reports the space as covered', () => {
    expect(hasWriteIn(merged)).toBe(true)
  })
})

describe('two write-ins on ONE unit', () => {
  /*
   * DARK ON ARRIVAL. `idx_lodging_write_in_unique` still forbids a second row
   * per unit-weekend, so this payload is one only a fixture can build — the
   * client half of "two write-ins in one shareable cabin", landing ahead of
   * the index change that makes it reachable.
   *
   * WHY A KEY AT ALL. `LodgingUnitCard` and `MapUnitPopover` both drew their
   * occupant lists with `key={entry.source.unitId}`, and the map additionally
   * DEDUPED on it through a `Set` — so two occupants of one cabin were two
   * React siblings sharing a key on the board (stale DOM reuse across
   * re-renders, a correctness bug rather than a warning) and one occupant on
   * the map. `entry.key` is what both read now.
   *
   * ⚠️ IT IS NOT THE ROW'S RECORD ID, deliberately. Publishing that is Design
   * A of the addressing question (OQ-1), which is unanswered — so the key is
   * composed from what the wire already carries: the unit, plus an occurrence
   * number among covers sharing it. That makes it IDENTICAL to the old
   * `source.unitId` wherever a unit contributes one cover, which is
   * everywhere today.
   */
  const shared = unit({
    unit_id: 'id-ridge-d',
    code: 'ridge-d',
    name: 'Ridge D',
    sleeps: 15,
    write_ins: [
      cover({
        unit_id: 'id-ridge-d',
        unit_code: 'ridge-d',
        unit_name: 'Ridge D',
        occupant_name: 'Emma Johnson',
        party_size: 3,
      }),
      cover({
        unit_id: 'id-ridge-d',
        unit_code: 'ridge-d',
        unit_name: 'Ridge D',
        occupant_name: 'Liam Garcia',
        party_size: 4,
      }),
    ],
  })

  it('names both occupants, in the order the server sent them', () => {
    expect(writeInEntries(shared).map((entry) => entry.occupant.name)).toEqual([
      'Emma Johnson',
      'Liam Garcia',
    ])
    expect(writeInEntries(shared).every((entry) => entry.source.isOwn)).toBe(true)
  })

  it('gives them distinct keys, so they are two React siblings and not one', () => {
    const keys = writeInEntries(shared).map((entry) => entry.key)
    expect(new Set(keys).size).toBe(2)
  })

  it('leaves a lone cover keyed exactly as it was, which is what keeps this dark', () => {
    // The old key WAS `source.unitId`, and every production card has one cover
    // per source unit. Anything else here would be a behaviour change dressed
    // as a no-op.
    const single = unit({
      write_ins: [cover({ unit_id: 'u9', occupant_name: 'Ava Martinez' })],
    })
    expect(writeInEntries(single).map((entry) => entry.key)).toEqual(['u9'])
  })

  it('pays for both parties, so the cabin has eight beds left and not eleven', () => {
    // `writeInDemand` never deduped — the collapse was upstream of it, in the
    // payload. This pins that the pair arrives whole.
    expect(writeInDemand(15, shared.write_ins ?? []).sized).toBe(7)
  })
})

describe('writeInDemand', () => {
  // THE MIRROR of `write_in_demand` in api/services/lodging_rules.py. The same
  // cases in the same order, deliberately: this pair is what stops the card
  // and the stats bar answering "is there room here" two different ways, and a
  // case added on one side and not the other is how that starts.
  //
  // It takes a CAPACITY and COVERS, not a unit and the registry, because
  // `MapUnitPopover` has no registry — its `units` prop is one cluster's
  // members and its own doc says so. Each cover publishes its `unit_sleeps`.
  const demandCover = (over: Partial<WriteInCoverRow>): WriteInCoverRow => ({
    unit_id: 'u',
    unit_code: 'c',
    unit_name: 'n',
    occupant_name: '',
    note: '',
    party_size: null,
    relation: 'own',
    unit_sleeps: null,
    ...over,
  })

  it('is nothing on a card with no write-ins', () => {
    expect(writeInDemand(15, [])).toEqual({ consumed: 0, sized: 0, known: true, usable: true })
  })

  it('takes a recorded size', () => {
    expect(
      writeInDemand(15, [demandCover({ relation: 'own', party_size: 2, unit_sleeps: 15 })])
    ).toEqual({ consumed: 2, sized: 2, known: true, usable: true })
  })

  it('takes the whole room when nobody recorded a size, and reports none sized', () => {
    // `sized: 0` is the em dash's meaning. A wholesale fallback must never
    // reach the numerator — it would print a headcount nobody wrote down.
    expect(
      writeInDemand(15, [demandCover({ relation: 'own', party_size: null, unit_sleeps: 15 })])
    ).toEqual({ consumed: 15, sized: 0, known: false, usable: true })
  })

  it('takes each written-into room’s own beds on a combined house', () => {
    // A combined container with no figure of its own: own 0, rooms 3 + 1 + 2 + 2.
    const rooms = [3, 1, 2, 2].map((n) =>
      demandCover({ relation: 'descendant', party_size: null, unit_sleeps: n })
    )
    expect(writeInDemand(8, rooms)).toEqual({ consumed: 8, sized: 0, known: false, usable: true })
  })

  it('sums a mixture both ways and withholds the claim', () => {
    const rooms = [
      demandCover({ relation: 'descendant', party_size: 2, unit_sleeps: 3 }),
      demandCover({ relation: 'descendant', party_size: null, unit_sleeps: 1 }),
      demandCover({ relation: 'descendant', party_size: null, unit_sleeps: 2 }),
      demandCover({ relation: 'descendant', party_size: null, unit_sleeps: 2 }),
    ]
    expect(writeInDemand(8, rooms)).toEqual({ consumed: 7, sized: 2, known: false, usable: true })
  })

  it('lets an ancestor take the whole card without printing its size', () => {
    // A house written into whole, then split. Printing 2 on both rooms would
    // spend one two-person party twice on one screen.
    expect(
      writeInDemand(4, [demandCover({ relation: 'ancestor', party_size: 2, unit_sleeps: 7 })])
    ).toEqual({ consumed: 4, sized: 0, known: true, usable: true })
  })

  it('answers the same regardless of where the ancestor cover sits in the list', () => {
    // Mirrors a reviewer-verified Python fix-round finding: the ancestor
    // branch must be a PRE-PASS over the covers, not a value the per-cover
    // loop happens to have accumulated by the time it reaches the ancestor —
    // otherwise the same set of covers in a different order answers
    // differently (`known` in particular, since an unsized descendant seen
    // before the ancestor sets `known = false` before the loop would ever
    // reach the ancestor's early return).
    const unsizedDescendant = demandCover({
      relation: 'descendant',
      party_size: null,
      unit_sleeps: 3,
    })
    const ancestor = demandCover({ relation: 'ancestor', party_size: 2, unit_sleeps: 7 })
    const forward = writeInDemand(4, [unsizedDescendant, ancestor])
    const backward = writeInDemand(4, [ancestor, unsizedDescendant])
    expect(forward).toEqual({ consumed: 4, sized: 0, known: true, usable: true })
    expect(backward).toEqual(forward)
  })

  it('caps consumption at the card but never caps the recorded size', () => {
    // A hand-typed count above the card's own beds is over capacity, which is
    // a real state the card reddens for — `sized` has to carry the true
    // recorded figure or that overage would be invisible.
    const demand = writeInDemand(4, [
      demandCover({ relation: 'own', party_size: 9, unit_sleeps: 4 }),
    ])
    expect(demand.consumed).toBe(4)
    expect(demand.sized).toBe(9)
  })

  it('withholds everything when an unsized cover names an unmeasured unit', () => {
    expect(
      writeInDemand(8, [
        demandCover({ relation: 'descendant', party_size: null, unit_sleeps: null }),
      ])
    ).toEqual({ consumed: 8, sized: 0, known: false, usable: true })
  })

  it('is never known on a card nobody measured, but a recorded size still survives', () => {
    // `sized` is computed before the capacity guard and never depends on
    // capacity — a cabin nobody has measured, holding a two-person write-in,
    // still prints 2/-, not -/-.
    expect(writeInDemand(null, [demandCover({ relation: 'own', party_size: 2 })])).toEqual({
      consumed: 0,
      sized: 2,
      known: false,
      usable: false,
    })
  })

  it('is never known on a card nobody measured, even with an ancestor cover', () => {
    // Mirror of Python's `test_an_unmeasured_card_is_not_known_even_with_an_ancestor_cover`.
    // An ancestor cover only tells you the whole card is taken, not how big
    // the card is — so a capacity nobody measured stays unknown even here.
    // This pins the GUARD ORDERING: the `capacity === null` guard has to run
    // before the ancestor pre-pass, or this answers `known: true` instead —
    // an ancestor cover asserting occupancy is not the same fact as a
    // measured card, and only the capacity guard can tell them apart.
    expect(
      writeInDemand(null, [demandCover({ relation: 'ancestor', party_size: 2, unit_sleeps: 7 })])
        .known
    ).toBe(false)
  })

  // ------------------------------------------------------------------
  // `usable` — kindred#2543, owner ruling 2026-08-29. MIRROR of the Python
  // block of the same name in `tests/unit/api/services/test_lodging_rules.py`.
  //
  // `known=false` means three different things and only one of them makes
  // `consumed` meaningless: an unmeasured CARD. An unsized cover — on a
  // measured leaf or an unmeasured one — still leaves a number the card may
  // publish, because a party cannot exceed the leaf it sleeps in, so the
  // remainder is a FLOOR. `known` asks "did somebody size every party";
  // `usable` asks "may this number be published".
  // ------------------------------------------------------------------

  it('publishes a partly-sized card’s consumption even though it is not known', () => {
    // CASE 3, and the case the ruling exists for: a container of 10, one
    // cover sized at 2, one unsized cover on a measured room of 3. 5 is a
    // floor, and it is the number the stats bar already publishes.
    const demand = writeInDemand(10, [
      demandCover({ relation: 'descendant', party_size: 2, unit_sleeps: 3 }),
      demandCover({ relation: 'descendant', party_size: null, unit_sleeps: 3 }),
    ])
    expect(demand).toEqual({ consumed: 5, sized: 2, known: false, usable: true })
  })

  it('publishes an unbounded wholesale claim too — it leaves nothing, which is a fact', () => {
    // CASE 2. `consumed === capacity`, so the remainder is 0 — exactly what
    // `free_family_spots` publishes for the same card.
    expect(
      writeInDemand(8, [
        demandCover({ relation: 'descendant', party_size: null, unit_sleeps: null }),
      ]).usable
    ).toBe(true)
  })

  it('publishes nothing about a card nobody measured', () => {
    // CASE 1, and the trap. `consumed` comes back as 0 there and means
    // nothing — there was no capacity to subtract it from. Reading `usable`
    // as "not known" would offer an unmeasured, written-into cabin as wholly
    // free.
    expect(writeInDemand(null, [demandCover({ relation: 'own', party_size: 2 })]).usable).toBe(
      false
    )
    // The UNSIZED cover on a measured leaf, at an unmeasured card. Python's
    // `test_an_unmeasured_card_is_the_one_thing_that_is_not_usable` asserts all
    // three and this side asserted two (kindred#2604 review). It is the middle
    // one that pins the guard ORDER: a leaf of 3 is exactly the shape case 3
    // publishes a floor from, and it must still withhold when the CARD itself
    // is unmeasured, because there is no capacity to subtract the 3 from.
    expect(
      writeInDemand(null, [demandCover({ relation: 'own', party_size: null, unit_sleeps: 3 })])
        .usable
    ).toBe(false)
    expect(
      writeInDemand(null, [demandCover({ relation: 'ancestor', party_size: 2, unit_sleeps: 7 })])
        .usable
    ).toBe(false)
  })

  it('is exactly whether the card was measured, over every branch', () => {
    // MIRROR of Python's `test_usable_is_exactly_whether_the_card_was_measured`,
    // and the case this side was missing (kindred#2604 review). The whole rule
    // stated once over every branch of it: `consumed` is publishable if and
    // only if there was a capacity to subtract it from. A new branch that makes
    // `consumed` meaningless again has to break THIS test, rather than a
    // caller's re-derivation of the rule.
    //
    // ⚠️ IT GUARDS MORE HERE THAN IT DOES IN PYTHON, which is why its absence
    // mattered. `write_in_demand`'s `usable` has no production consumer at all
    // -- `free_family_spots` reads `.consumed` -- while THIS one is the board's
    // gate: `LodgingUnitCard`'s `writeInSpotsUsable` feeds `DragCapacity.known`,
    // which `hasNoRoom` reddens the N/M figure from and `resolveDragFit` washes
    // the match from. The exhaustive guard existed only on the side where a
    // regression is invisible and harmless.
    const shapes: WriteInCoverRow[][] = [
      [],
      [demandCover({ relation: 'own', party_size: 2, unit_sleeps: 15 })],
      [demandCover({ relation: 'own', party_size: null, unit_sleeps: 15 })],
      [demandCover({ relation: 'own', party_size: null, unit_sleeps: null })],
      [demandCover({ relation: 'ancestor', party_size: 2, unit_sleeps: 7 })],
      [
        demandCover({ relation: 'descendant', party_size: 2, unit_sleeps: 3 }),
        demandCover({ relation: 'descendant', party_size: null, unit_sleeps: 3 }),
      ],
      [
        demandCover({ relation: 'descendant', party_size: null, unit_sleeps: null }),
        demandCover({ relation: 'descendant', party_size: 2, unit_sleeps: 3 }),
      ],
    ]
    for (const covers of shapes) {
      const shape = JSON.stringify(covers.map((c) => [c.relation, c.party_size, c.unit_sleeps]))
      expect(writeInDemand(9, covers).usable, shape).toBe(true)
      expect(writeInDemand(null, covers).usable, shape).toBe(false)
    }
  })

  it('does not inherit `known`’s vacuous truth on an uncovered card', () => {
    // `known` is true with no covers — there is no unsized party to spoil it
    // — whether or not anybody measured the card. `usable` must not be:
    // `writeInDemand(null, [])` answering "publish 0" is how an unmeasured,
    // uncovered room reads as a known zero. `LodgingUnitCard` folded
    // `capacityKnown` back in by hand for exactly this; the rule answers it
    // itself now.
    expect(writeInDemand(null, [])).toEqual({ consumed: 0, sized: 0, known: true, usable: false })
    expect(writeInDemand(15, []).usable).toBe(true)
  })
})
