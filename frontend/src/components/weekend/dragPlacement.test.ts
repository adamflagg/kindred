/**
 * Resolving a drop into a write intent is a pure function, so every decision
 * that matters — which drops are no-ops, which are refused, which grain the
 * write names — is testable without a pointer. jsdom cannot do pointer drags;
 * this is where the behaviour actually lives.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow, WeekendRoster } from '../../types/lodging'
import {
  UNPLACED_DROPPABLE_ID,
  applyPlacement,
  partyGrainBody,
  resolveDrop,
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
    allocation_default: 'family_pool',
    reservation_state: null,
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
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

  it('refuses a drop on a container row', () => {
    // Containers never get a card (boardLayout's first invariant), so this is
    // unreachable through the board today. It is pinned because the map draws
    // buildings, and the map is a projection of the same model.
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
