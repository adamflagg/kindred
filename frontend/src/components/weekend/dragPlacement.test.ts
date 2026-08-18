/**
 * Resolving a drop into a write intent is a pure function, so every decision
 * that matters — which drops are no-ops, which are refused, which grain the
 * write names — is testable without a pointer. jsdom cannot do pointer drags;
 * this is where the behaviour actually lives.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type {
  LodgingUnitRow,
  RosterPartyRow,
  WeekendRoster,
  WriteInCoverRow,
} from '../../types/lodging'
import {
  UNPLACED_DROPPABLE_ID,
  applyPlacement,
  isValidMergeTarget,
  mergeDragId,
  partyGrainBody,
  resolveDrop,
  resolveMergeDrop,
  resolvePickerPlacement,
  unitDroppableId,
} from './dragPlacement'
import { partyKey } from './partyKey'

function unit(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
  return {
    unit_id: 'u1',
    code: 'cedar-1',
    name: 'Cedar 1',
    area_code: 'CG',
    area_name: 'Cedar Grove',
    sleeps: 5,
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
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

/**
 * The server-resolved write-in cover — the ONLY way the wire says "somebody is
 * in this space" since kindred#2382 PR 4 retired the
 * `family_available_override === false` shim.
 */
function cover(overrides: Partial<WriteInCoverRow> = {}): WriteInCoverRow {
  return {
    unit_id: 'u1',
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    occupant_name: 'Emma Johnson',
    note: '',
    ...overrides,
  }
}

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    person_cm_id: 0,
    display_name: 'Johnson',
    sort_name: 'Johnson',
    adults: [],
    children: [],
    party_size: 3,
    unit_code: '',
    unit_name: '',
    unit_codes: [],
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    ...overrides,
  }
}

const CEDAR_1 = unit()
const CEDAR_2 = unit({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })

describe('unitDroppableId', () => {
  it('round-trips a code containing the separator', () => {
    // Unit codes are ingest-derived strings, not a controlled vocabulary. A
    // naive `split(':')[1]` loses everything after the first separator, which
    // silently retargets the drop at a DIFFERENT unit rather than failing.
    const weird = unit({ unit_id: 'u9', code: 'health-center::room-5', name: 'Health Center 5' })
    const target = resolveDrop({
      activeId: partyKey(party()),
      overId: unitDroppableId(weird.code),
      parties: [party()],
      units: [weird],
    })
    expect(target).toEqual({
      kind: 'place',
      party: party(),
      unitId: 'u9',
      unitCode: 'health-center::room-5',
      unitName: 'Health Center 5',
    })
  })
})

describe('resolveDrop', () => {
  it('places an unplaced party onto a unit', () => {
    const p = party()
    const intent = resolveDrop({
      activeId: partyKey(p),
      overId: unitDroppableId('cedar-1'),
      parties: [p],
      units: [CEDAR_1],
    })
    expect(intent).toEqual({
      kind: 'place',
      party: p,
      unitId: 'u1',
      unitCode: 'cedar-1',
      unitName: 'Cedar 1',
    })
  })

  it('moves a placed party to a different unit', () => {
    const p = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    const intent = resolveDrop({
      activeId: partyKey(p),
      overId: unitDroppableId('cedar-2'),
      parties: [p],
      units: [CEDAR_1, CEDAR_2],
    })
    expect(intent).toMatchObject({ kind: 'place', unitId: 'u2' })
  })

  it('unplaces a placed party dropped on the queue', () => {
    const p = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    const intent = resolveDrop({
      activeId: partyKey(p),
      overId: UNPLACED_DROPPABLE_ID,
      parties: [p],
      units: [CEDAR_1],
    })
    expect(intent).toEqual({ kind: 'unplace', party: p })
  })

  it('is a no-op when a party is dropped back on the unit it already occupies', () => {
    // Not merely wasteful. `place_party` would write the row it already wrote,
    // and every write flips `staff_touched` — a one-way flag — so a dropped
    // drag that changed nothing would still mark the placement as a staff
    // decision.
    const p = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('cedar-1'),
        parties: [p],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })

  it('is a no-op when an already-unplaced party is dropped on the queue', () => {
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: UNPLACED_DROPPABLE_ID,
        parties: [p],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })

  it('refuses a drop on a unit the payload does not carry', () => {
    // Never invent a unit_id. The write would 404 at best and place the party
    // somewhere nobody chose at worst.
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('does-not-exist'),
        parties: [p],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })

  it('refuses a drop on a NON-combined container', () => {
    // A non-combined building carries the beds its halves already report and
    // never gets a card on the board (boardLayout's first invariant) — but the
    // map draws buildings too and is a projection of the same model, so this
    // stays reachable there even though the board itself never offers it.
    const building = unit({ unit_id: 'u7', code: 'lodge', name: 'The Lodge', is_container: true })
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('lodge'),
        parties: [p],
        units: [building],
      })
    ).toBeNull()
  })

  it('accepts a drop on a COMBINED container — it is the new card type', () => {
    // Task 6 draws a combined container's OWN row in place of its rooms
    // (unitLevel.ts, drawnUnits), and LodgingUnitCard registers a live,
    // highlighting droppable for every drawn slot. Refusing here would make
    // that card a drop target that silently eats the family: no error, no
    // toast, no move. This is the mutation-checked fix for that bug.
    const building = unit({
      unit_id: 'u7',
      code: 'lodge',
      name: 'The Lodge',
      is_container: true,
      is_combined: true,
    })
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('lodge'),
        parties: [p],
        units: [building],
      })
    ).toMatchObject({ kind: 'place', unitId: 'u7', unitCode: 'lodge', unitName: 'The Lodge' })
  })

  it('returns null for an unknown drag id', () => {
    expect(
      resolveDrop({
        activeId: 'household-999999',
        overId: unitDroppableId('cedar-1'),
        parties: [party()],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })

  it('returns null when the drag ended over nothing', () => {
    const p = party()
    expect(
      resolveDrop({ activeId: partyKey(p), overId: null, parties: [p], units: [CEDAR_1] })
    ).toBeNull()
  })

  it('returns null for a droppable id that is neither a unit nor the queue', () => {
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: 'some-other-thing',
        parties: [p],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })

  it('places into a unit that already holds another party', () => {
    // Sharing is real and deliberately unguarded here: occupancy (#1907) is
    // unmodelled and the fit check is advisory, so the board must not refuse
    // the drop. `consentFlag` raises the amber flag afterwards, which is the
    // designed outcome — a human look, not a blocked interaction.
    const sitting = party({
      household_cm_id: 202,
      display_name: 'Garcia',
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
      unit_codes: ['cedar-1'],
    })
    const moving = party()
    expect(
      resolveDrop({
        activeId: partyKey(moving),
        overId: unitDroppableId('cedar-1'),
        parties: [sitting, moving],
        units: [CEDAR_1],
      })
    ).toMatchObject({ kind: 'place', unitId: 'u1' })
  })

  it('collapses a multi-room party onto a single unit', () => {
    // NOT merge-by-drag, which is out of scope until #1940 lets the board draw
    // a multi-room placement. This is the opposite direction: a party the
    // board renders in "Placed outside the board" being given ONE room, which
    // is an ordinary POST naming one unit and makes the card drawable again.
    const merged = party({
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      unit_codes: ['cedar-1', 'cedar-2'],
      is_merged_slot: true,
    })
    expect(
      resolveDrop({
        activeId: partyKey(merged),
        overId: unitDroppableId('cedar-2'),
        parties: [merged],
        units: [CEDAR_1, CEDAR_2],
      })
    ).toMatchObject({ kind: 'place', unitId: 'u2' })
  })

  it('unplaces a multi-room party dropped on the queue', () => {
    const merged = party({
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      unit_codes: ['cedar-1', 'cedar-2'],
      is_merged_slot: true,
    })
    expect(
      resolveDrop({
        activeId: partyKey(merged),
        overId: UNPLACED_DROPPABLE_ID,
        parties: [merged],
        units: [CEDAR_1, CEDAR_2],
      })
    ).toEqual({ kind: 'unplace', party: merged })
  })

  it('refuses a drop onto a held unit (#2087) — a hold blocks placement outright', () => {
    // Owner ruling on #2090: a hold is global and blocks placement, not merely
    // dimmed. This is the load-bearing check, since `resolveDrop` is the only
    // path #2080's picker reaches — a `disabled`-only fix would not cover it.
    const held = unit({ write_ins: [cover()], is_family_available: false })
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('cedar-1'),
        parties: [p],
        units: [held],
      })
    ).toBeNull()
  })

  it('refuses a drop into a ROOM of a building somebody is written into', () => {
    // The split case. Staff wrote into the whole house while it was merged,
    // then split it: the row still names the house, which now has no card, and
    // without the server's resolved cover this drop went through — a family
    // into a space somebody is already sleeping in, with nothing on screen to
    // warn them. The refusal reads the COVER, so both directions of the tree
    // arrive here as the same fact.
    const room = unit({
      code: 'house-a',
      write_ins: [
        {
          unit_id: 'id-house',
          unit_code: 'house',
          unit_name: 'House',
          occupant_name: 'Liam Garcia',
          note: '',
        },
      ],
    })
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('house-a'),
        parties: [p],
        units: [room],
      })
    ).toBeNull()
  })

  it('refuses a whole-house drop when one of its ROOMS is written into', () => {
    // The mirror case, and the one that predates the split fix: merge a
    // building over a written-into room and the room stops being drawn, so the
    // building's card said nothing about the caretaker in it and took the drop.
    const house = unit({
      code: 'house',
      is_container: true,
      is_combined: true,
      write_ins: [
        {
          unit_id: 'id-house-a',
          unit_code: 'house-a',
          unit_name: 'House A',
          occupant_name: 'Ava Martinez',
          note: '',
        },
      ],
    })
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('house'),
        parties: [p],
        units: [house],
      })
    ).toBeNull()
  })

  it('still accepts a drop onto an ordinary unheld unit (regression guard)', () => {
    const unheld = unit({ family_available_override: null, is_family_available: true })
    const p = party()
    expect(
      resolveDrop({
        activeId: partyKey(p),
        overId: unitDroppableId('cedar-1'),
        parties: [p],
        units: [unheld],
      })
    ).toMatchObject({ kind: 'place', unitId: 'u1' })
  })

  it('refuses to move a party carrying neither CampMinder id', () => {
    // The roster service emits household_cm_id = 0 for a household whose
    // record failed to resolve, and `partyKey` falls back to display_name for
    // exactly that reason — so such a party HAS a drag id and can be picked
    // up. Every write names one grain (`PartyGrainRequest` requires exactly
    // one of the two to be non-zero), so letting the drop through would fire a
    // guaranteed 422 and roll the card back with an error staff cannot act on.
    const orphan = party({ household_cm_id: 0, person_cm_id: 0, display_name: 'Unresolved' })
    expect(
      resolveDrop({
        activeId: partyKey(orphan),
        overId: unitDroppableId('cedar-1'),
        parties: [orphan],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })
})

const WING = unit({ unit_id: 'u10', code: 'wing', name: 'The Wing', is_container: true })
const WING_R1 = unit({ unit_id: 'u11', code: 'wing-r1', name: 'Wing Room 1', parent_code: 'wing' })
const WING_R2 = unit({ unit_id: 'u12', code: 'wing-r2', name: 'Wing Room 2', parent_code: 'wing' })
const OTHER_HOUSE_R1 = unit({
  unit_id: 'u13',
  code: 'other-r1',
  name: 'Other House Room 1',
  parent_code: 'other-house',
})

describe('isValidMergeTarget', () => {
  it('accepts a sibling sharing a non-empty parent_code', () => {
    expect(isValidMergeTarget(WING_R1, WING_R2)).toBe(true)
  })

  it('refuses a room with no parent at all', () => {
    expect(isValidMergeTarget(CEDAR_1, CEDAR_2)).toBe(false)
  })

  it('refuses two rooms under different parents', () => {
    expect(isValidMergeTarget(WING_R1, OTHER_HOUSE_R1)).toBe(false)
  })

  it('refuses a room dropped on itself', () => {
    expect(isValidMergeTarget(WING_R1, WING_R1)).toBe(false)
  })

  it('refuses when no card is being dragged', () => {
    expect(isValidMergeTarget(null, WING_R2)).toBe(false)
  })
})

describe('resolveMergeDrop', () => {
  it('promotes the shared parent when a room is dropped on its sibling', () => {
    expect(
      resolveMergeDrop({
        activeId: mergeDragId('wing-r1'),
        overId: mergeDragId('wing-r2'),
        units: [WING, WING_R1, WING_R2],
      })
    ).toEqual({ parentCode: 'wing', combined: true })
  })

  it('refuses a drop onto a NON-sibling — a room under a different parent', () => {
    expect(
      resolveMergeDrop({
        activeId: mergeDragId('wing-r1'),
        overId: mergeDragId('other-r1'),
        units: [WING_R1, OTHER_HOUSE_R1],
      })
    ).toBeNull()
  })

  it('refuses a room with no parent_code — nothing to promote it to', () => {
    expect(
      resolveMergeDrop({
        activeId: mergeDragId('cedar-1'),
        overId: mergeDragId('cedar-2'),
        units: [CEDAR_1, CEDAR_2],
      })
    ).toBeNull()
  })

  it('refuses a room dropped on itself', () => {
    expect(
      resolveMergeDrop({
        activeId: mergeDragId('wing-r1'),
        overId: mergeDragId('wing-r1'),
        units: [WING_R1],
      })
    ).toBeNull()
  })

  it('refuses when the active id is not merge-shaped — a party drag, not a card drag', () => {
    // The gender-rule analogue: anything that is not shaped like THIS gesture
    // is null, not a guess. A party's drag id is its `partyKey`, which is
    // never `merge:`-prefixed.
    expect(
      resolveMergeDrop({
        activeId: partyKey(party()),
        overId: mergeDragId('wing-r2'),
        units: [WING_R1, WING_R2],
      })
    ).toBeNull()
  })

  it('refuses when the over id is not merge-shaped — the ordinary unit droppable', () => {
    // Both ids must carry the `merge:` prefix, never just one — otherwise a
    // card dragged over an ordinary party-drop target could be misread as a
    // completed merge.
    expect(
      resolveMergeDrop({
        activeId: mergeDragId('wing-r1'),
        overId: unitDroppableId('wing-r2'),
        units: [WING_R1, WING_R2],
      })
    ).toBeNull()
  })

  it('refuses when the over id names a unit the payload does not carry', () => {
    expect(
      resolveMergeDrop({
        activeId: mergeDragId('wing-r1'),
        overId: mergeDragId('does-not-exist'),
        units: [WING_R1],
      })
    ).toBeNull()
  })

  it('returns null when the drag ended over nothing', () => {
    expect(
      resolveMergeDrop({
        activeId: mergeDragId('wing-r1'),
        overId: null,
        units: [WING_R1, WING_R2],
      })
    ).toBeNull()
  })
})

describe('partyGrainBody', () => {
  it('names household_cm_id alone for a household party', () => {
    expect(partyGrainBody(party())).toEqual({ household_cm_id: 101 })
  })

  it('names person_cm_id alone for a person party', () => {
    // An adult weekend enrols individuals. `PartyGrainRequest` counts fields
    // that are NON-ZERO, so a stray `person_cm_id: 0` beside a real household
    // id happens to pass — but the schema's rule is "name exactly one", and
    // sending the other id is a claim about the party that is not true. This
    // honours the rule rather than the leniency.
    const adult = party({ grain: 'person', household_cm_id: 0, person_cm_id: 5150 })
    expect(partyGrainBody(adult)).toEqual({ person_cm_id: 5150 })
  })
})

describe('applyPlacement', () => {
  function roster(parties: RosterPartyRow[], counts = {}): WeekendRoster {
    return {
      year: 2026,
      session_cm_id: 1000001,
      session_name: 'Family Camp Weekend 1',
      session_type: 'family',
      parties,
      units: [CEDAR_1, CEDAR_2],
      counts: {
        parties_total: parties.length,
        parties_assigned: parties.filter((p) => (p.unit_name ?? '') !== '').length,
        parties_unassigned: parties.filter((p) => (p.unit_name ?? '') === '').length,
        ...counts,
      },
    } as WeekendRoster
  }

  it('moves the party onto the target unit', () => {
    const p = party()
    const next = applyPlacement(roster([p]), {
      kind: 'place',
      party: p,
      unitId: 'u1',
      unitCode: 'cedar-1',
      unitName: 'Cedar 1',
    })
    expect(next.parties?.[0]).toMatchObject({
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
      unit_codes: ['cedar-1'],
    })
  })

  it('clears the placement when unplacing', () => {
    const p = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    const next = applyPlacement(roster([p]), { kind: 'unplace', party: p })
    expect(next.parties?.[0]).toMatchObject({ unit_code: '', unit_name: '', unit_codes: [] })
  })

  it('drops the merged-slot marker when a multi-room party collapses to one room', () => {
    // Left set, `buildBoard` would keep reading a merge that no longer exists.
    // The optimistic row has to be the row the server will return, not a
    // half-updated one — otherwise the card jumps a second time on refetch.
    const merged = party({
      unit_code: '',
      unit_name: 'Cedar 1 + Cedar 2',
      unit_codes: ['cedar-1', 'cedar-2'],
      is_merged_slot: true,
    })
    const next = applyPlacement(roster([merged]), {
      kind: 'place',
      party: merged,
      unitId: 'u2',
      unitCode: 'cedar-2',
      unitName: 'Cedar 2',
    })
    expect(next.parties?.[0]).toMatchObject({
      unit_code: 'cedar-2',
      unit_codes: ['cedar-2'],
      is_merged_slot: false,
    })
  })

  it('does not mutate the snapshot the rollback depends on', () => {
    // THE test for this function. `onMutate` hands the pre-mutation object to
    // `onError` as the rollback value; an in-place edit would make the
    // rollback restore the optimistic state and the card would never come
    // back. React Query's structural sharing does not save us here — the
    // snapshot is the same object we are handed.
    const p = party()
    const before = roster([p])
    const snapshot = structuredClone(before)

    applyPlacement(before, {
      kind: 'place',
      party: p,
      unitId: 'u1',
      unitCode: 'cedar-1',
      unitName: 'Cedar 1',
    })

    expect(before).toEqual(snapshot)
  })

  it('keeps the assigned/unassigned counts honest when placing', () => {
    // The stats bar reads these. Left alone, placing the last unplaced family
    // leaves the bar claiming somebody is still homeless for the length of the
    // refetch — and `shouldOfferSeed` keys on `parties_assigned === 0`, so an
    // un-updated count keeps offering to seed a plan staff have started.
    const p = party()
    const next = applyPlacement(roster([p]), {
      kind: 'place',
      party: p,
      unitId: 'u1',
      unitCode: 'cedar-1',
      unitName: 'Cedar 1',
    })
    expect(next.counts).toMatchObject({ parties_assigned: 1, parties_unassigned: 0 })
  })

  it('keeps the counts honest when unplacing', () => {
    const p = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    const next = applyPlacement(roster([p]), { kind: 'unplace', party: p })
    expect(next.counts).toMatchObject({ parties_assigned: 0, parties_unassigned: 1 })
  })

  it('leaves the counts alone when a placed party moves between units', () => {
    const p = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    const next = applyPlacement(roster([p]), {
      kind: 'place',
      party: p,
      unitId: 'u2',
      unitCode: 'cedar-2',
      unitName: 'Cedar 2',
    })
    expect(next.counts).toMatchObject({ parties_assigned: 1, parties_unassigned: 0 })
  })

  it('leaves the counts alone when the moved party is not in the snapshot', () => {
    // The row update is guarded on a `partyKey` match but the count delta was
    // not, so a party absent from the snapshot moved the counters without
    // moving a row — `parties_assigned` could exceed the number of placed
    // parties. Reachable when a refetch lands between drag start and
    // `onMutate` and drops the party.
    const moving = party()
    const other = party({ household_cm_id: 202, display_name: 'Garcia' })
    const next = applyPlacement(roster([other]), {
      kind: 'place',
      party: moving,
      unitId: 'u1',
      unitCode: 'cedar-1',
      unitName: 'Cedar 1',
    })
    expect(next.counts).toMatchObject({ parties_assigned: 0, parties_unassigned: 1 })
  })

  it('touches only the moved party', () => {
    const moving = party()
    const other = party({ household_cm_id: 202, display_name: 'Garcia' })
    const next = applyPlacement(roster([moving, other]), {
      kind: 'place',
      party: moving,
      unitId: 'u1',
      unitCode: 'cedar-1',
      unitName: 'Cedar 1',
    })
    expect(next.parties?.[1]).toEqual(other)
  })
})

describe('resolvePickerPlacement', () => {
  /*
   * kindred#2080's placement path. The point of these tests is that there is
   * only ONE path: the picker must produce the intent the equivalent DROP
   * would produce, and inherit every refusal, rather than growing a parallel
   * set of rules that can drift.
   */
  it('produces the same intent an equivalent drop would', () => {
    const p = party()
    const viaPicker = resolvePickerPlacement({
      party: p,
      unitCode: 'cedar-1',
      parties: [p],
      units: [CEDAR_1],
    })
    const viaDrop = resolveDrop({
      activeId: partyKey(p),
      overId: unitDroppableId('cedar-1'),
      parties: [p],
      units: [CEDAR_1],
    })
    expect(viaPicker).toEqual(viaDrop)
    expect(viaPicker).toEqual({
      kind: 'place',
      party: p,
      unitId: 'u1',
      unitCode: 'cedar-1',
      unitName: 'Cedar 1',
    })
  })

  it('inherits the held-space refusal rather than adding a second one', () => {
    // #2087/#2199 put the refusal in `resolveDrop` precisely because #2080
    // reaches placement without touching a `useDroppable`. A picker-layer
    // check of its own would be the second copy that comment exists to
    // prevent.
    const p = party()
    const held = unit({ write_ins: [cover()], is_family_available: false })
    expect(
      resolvePickerPlacement({ party: p, unitCode: 'cedar-1', parties: [p], units: [held] })
    ).toBeNull()
  })

  it('refuses a party carrying neither CampMinder id', () => {
    const nameless = party({ household_cm_id: 0, person_cm_id: 0, display_name: 'Unresolved' })
    expect(
      resolvePickerPlacement({
        party: nameless,
        unitCode: 'cedar-1',
        parties: [nameless],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })

  it('refuses a container the tree has not combined', () => {
    const split = unit({ is_container: true, is_combined: false })
    const p = party()
    expect(
      resolvePickerPlacement({ party: p, unitCode: 'cedar-1', parties: [p], units: [split] })
    ).toBeNull()
  })

  it('refuses a unit the payload does not carry', () => {
    const p = party()
    expect(
      resolvePickerPlacement({ party: p, unitCode: 'nowhere-9', parties: [p], units: [CEDAR_1] })
    ).toBeNull()
  })

  it('does nothing for a party already alone in that unit', () => {
    // Every write flips one-way `staff_touched`, so a no-op must stay a no-op
    // on this path too.
    const settled = party({ unit_code: 'cedar-1', unit_name: 'Cedar 1', unit_codes: ['cedar-1'] })
    expect(
      resolvePickerPlacement({
        party: settled,
        unitCode: 'cedar-1',
        parties: [settled],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })

  it('resolves the party against the CURRENT roster, not the row it was handed', () => {
    // The list is rendered from a snapshot. If a refetch lands between render
    // and click, the party the row closed over may be gone — and inventing a
    // write for a party the roster no longer has is how a placement lands on
    // a stale identity.
    const stale = party({ household_cm_id: 999, display_name: 'Departed' })
    expect(
      resolvePickerPlacement({
        party: stale,
        unitCode: 'cedar-1',
        parties: [party()],
        units: [CEDAR_1],
      })
    ).toBeNull()
  })
})
