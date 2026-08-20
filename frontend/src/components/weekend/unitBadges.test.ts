/**
 * The availability badge, which is the only place a staff member reads the
 * resolved answer to "can a family go in this cabin this weekend?".
 *
 * It used to switch on a three-value `reservation_state` enum. 1500000135
 * collapsed that to `family_available_override`, because the three values were
 * REASONS rather than states: the resolved question is binary, and each value
 * only meant anything read against the unit's role, so `released_to_family` on
 * a family_pool unit was storable and meaningless. The reason survives as free
 * text on `reason` and no longer drives the badge.
 *
 * "Staff" and "Released" are unchanged on purpose -- they are already the
 * staff-facing wording and must not drift. "Held" DID change, once, and only
 * as a word: kindred#2078's owner ruling is that a hold IS a write-in, so the
 * badge reads "Write-in" and KEEPS ITS SLATE TONE. No new colour is introduced
 * for a fact the board already had a colour for.
 *
 * Fictional data throughout.
 */
import { describe, expect, it } from 'vitest'

import type { LodgingUnitRow, WriteInCoverRow } from '../../types/lodging'
import { availabilityAction, reservationBadge, shareabilityBadge } from './unitBadges'

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
    shareability: 'single_party',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.5,
    map_y: 0.5,
    ...overrides,
  }
}

/**
 * The server-resolved write-in cover, which is the ONLY way the wire says
 * "somebody is in this space" since kindred#2382 PR 4.
 *
 * `family_available_override === false` used to mean it too, as a compat shim
 * while the split landed in four parts. It answers the staff↔family ROLE alone
 * now, so every fixture below meaning "written into" carries one of these and a
 * bare `false` means "closed by role", which names nobody.
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

describe('reservationBadge', () => {
  it('badges a building row so nobody reads an aggregate as a bookable room', () => {
    expect(reservationBadge(unit({ is_container: true }))).toEqual({
      label: 'Building',
      className: 'bg-muted text-muted-foreground',
    })
  })

  it('still says Building on a MERGED building nobody has written into', () => {
    // The structural fact does not stop being true because the card is drawn.
    // "Building" is the fallback here, not the first answer.
    expect(reservationBadge(unit({ is_container: true, is_combined: true }))?.label).toBe(
      'Building'
    )
  })

  it('says Write-in on a MERGED building somebody has been written into', () => {
    // A combined container IS the card the board draws (`drawnUnits`) and IS a
    // drop target (`resolveDrop`), so it reads its availability like any other
    // drawn unit. Badging it "Building" while `availabilityAction` offers to
    // CLEAR the write-in is the exact drift this module exists to prevent.
    expect(
      reservationBadge(unit({ is_container: true, is_combined: true, write_ins: [cover()] }))?.label
    ).toBe('Write-in')
  })

  it('keeps saying Building on a SPLIT container carrying an override', () => {
    // A split container gets no card at all, so there is nothing to badge and
    // no action to agree with. Unchanged, deliberately.
    expect(reservationBadge(unit({ is_container: true, write_ins: [cover()] }))?.label).toBe(
      'Building'
    )
  })

  it('leaves an ordinary available family cabin unbadged', () => {
    expect(reservationBadge(unit())).toBeNull()
  })

  it('badges a family cabin written into for this weekend', () => {
    // Somebody the system does not know about is sleeping here -- most often
    // non-rostered weekend staff. The unit is still planning inventory -- it is
    // inventory that is unavailable, not inventory that is missing -- which is
    // why this is "Write-in" and not "Staff".
    const badge = reservationBadge(
      unit({
        write_ins: [cover({ occupant_name: 'Emma Johnson' })],
        occupant_name: 'Emma Johnson',
        is_family_available: false,
      })
    )

    expect(badge?.label).toBe('Write-in')
    expect(badge?.className).toBe(
      'bg-slate-200 text-slate-800 dark:bg-slate-800 dark:text-slate-200'
    )
  })

  it('badges permanent staff housing as staff', () => {
    const badge = reservationBadge(
      unit({ inventory_class: 'staff_default', is_family_available: false })
    )

    expect(badge?.label).toBe('Staff')
    expect(badge?.className).toBe(
      'bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300'
    )
  })

  it('badges a staff cabin opened to families for this weekend', () => {
    const badge = reservationBadge(
      unit({
        inventory_class: 'staff_default',
        family_available_override: true,
        is_family_available: true,
      })
    )

    expect(badge?.label).toBe('Released')
    expect(badge?.className).toBe(
      'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
    )
  })

  it('reads null and false as different answers on the override', () => {
    // The trap this pins: `!unit.family_available_override` is true for BOTH,
    // so a falsy test would badge every unbadged family cabin as "Released".
    // None means "no row, ask the role"; false means "closed by role".
    expect(reservationBadge(unit({ family_available_override: null }))).toBeNull()
    expect(
      reservationBadge(unit({ family_available_override: false, is_family_available: false }))
        ?.label
    ).toBeUndefined()
  })

  it('does not badge a role-closed cabin as a write-in, because it names nobody', () => {
    // kindred#2382 PR 4. `false` used to BE the write-in — occupancy and the
    // staff↔family role shared one boolean — so a bare `false` badged
    // "Write-in" and the card claimed an occupant that exists in no row.
    //
    // NO BADGE REPLACES IT, deliberately. 1500000162 moved every occupancy row
    // out of `lodging_availability` and no writer creates another
    // (`set_availability` only ever writes `true` there), so this state is
    // unreachable rather than merely rare — and naming it would mean inventing
    // a staff-facing word for it, which is a product decision and not a side
    // effect of a storage split.
    expect(
      reservationBadge(unit({ family_available_override: false, is_family_available: false }))
    ).toBeNull()
    // A write-in on the same cabin still badges, which is the half that must
    // not be lost with it.
    expect(
      reservationBadge(unit({ write_ins: [cover()], is_family_available: false }))?.label
    ).toBe('Write-in')
  })

  it('does not badge a staff cabin as Released merely for lacking an override', () => {
    // The mirror of the case above, on the other branch: `staff_default` with
    // no row is ordinary staff housing, not a release.
    const badge = reservationBadge(
      unit({
        inventory_class: 'staff_default',
        family_available_override: null,
        is_family_available: false,
      })
    )

    expect(badge?.label).toBe('Staff')
  })

  it('does not badge an ordinary family cabin as Released', () => {
    // `family_available_override: true` on a family_pool unit is redundant but
    // perfectly storable -- it simply agrees with the role. "Released" means a
    // STAFF cabin opened to families for this weekend, so applying it here
    // would invent a distinction the property does not have and put a badge on
    // most of the board. BOTH branches read the override against the role;
    // this is the assertion that pins the Released half of that.
    expect(reservationBadge(unit({ family_available_override: true }))).toBeNull()
  })

  it('ignores the reason text entirely, because the rule never branches on it', () => {
    const held = reservationBadge(
      unit({
        write_ins: [cover({ note: 'Burst pipe' })],
        reason: 'Burst pipe',
        is_family_available: false,
      })
    )
    const alsoHeld = reservationBadge(
      unit({ write_ins: [cover()], reason: '', is_family_available: false })
    )

    expect(held?.label).toBe('Write-in')

    expect(held).toEqual(alsoHeld)
  })
})

describe('reservationBadge — the write-in gate’s two halves (kindred#2252, re-homed by #2072)', () => {
  /*
   * ⚠️ THESE MOVED HERE FROM `LodgingUnitCard.test.tsx`, and the move is the
   * point rather than a tidy-up.
   *
   * `writeInBadgeApplies` was exported so the unit card could suppress the
   * "Write-in" chip without re-deriving the gate. kindred#2072 struck EVERY
   * reservation badge from that card, so the card can no longer exercise the
   * gate at all — and the two halves it protects are still live for
   * `MapUnitPopover`, which draws the chip. Pinned against `reservationBadge`
   * directly, where no change to a card surface can take them away again.
   */
  it('badges a written-into family room "Write-in"', () => {
    expect(
      reservationBadge(unit({ write_ins: [cover()], is_family_available: false }))?.label
    ).toBe('Write-in')
  })

  it('badges a written-into STAFF cabin "Staff", never "Write-in"', () => {
    // The `inventory_class !== 'staff_default'` half. A staff cabin written
    // into for the weekend carries a cover exactly as a family room's write-in
    // does, so reading `hasWriteIn` alone would swallow the "Staff" chip.
    expect(
      reservationBadge(
        unit({
          inventory_class: 'staff_default',
          write_ins: [cover()],
          is_family_available: false,
        })
      )?.label
    ).toBe('Staff')
  })

  it('reads the OCCUPANCY table, never the raw role override', () => {
    // The `hasWriteIn` half. Since kindred#2382 `family_available_override`
    // answers the staff↔family ROLE and names nobody, so a `false` on it is
    // not a write-in — 1500000162 left no such row behind for it to be wrong
    // about.
    expect(reservationBadge(unit({ family_available_override: false }))).toBeNull()
  })
})

describe('availabilityAction', () => {
  // The action lives beside the badge, in the same module, because the card
  // must not say two things about one cabin: a card badged "Held" offering to
  // "Hold" it is the drift this prevents.

  it('offers NOTHING on an ordinary family cabin — the write-in left this strip', () => {
    // This used to return a `hold`/"Write in" action, and it is the assertion
    // that changed most in the 2026-08-18 ruling. Creating a write-in is now
    // the card's own family box: type a name, and if no registered family
    // matches, that text becomes the write-in. Two typeable boxes asking who
    // is sleeping in one cabin was the thing the ruling removed.
    expect(availabilityAction(unit())).toBeNull()
  })

  it('offers to release permanent staff housing', () => {
    // Rare and explicit, not absent. One season of data corroborates that staff
    // cabins are never released; it does not prove it, so the capability stays.
    expect(
      availabilityAction(unit({ inventory_class: 'staff_default', is_family_available: false }))
    ).toEqual({
      kind: 'release',
      label: 'Release',
      familyAvailable: true,
      prompt: 'reason',
      unitId: 'u1',
      unitName: 'Cedar 1',
    })
  })

  it('offers NOTHING on a written-into family cabin — the removal is on its card', () => {
    // kindred#2381, superseding #2252's 'Clear Write-in' label. That label was
    // right while the strip was the only thing on the card naming what a click
    // removes; it stopped being true once a card could cover four write-ins
    // and each got its own X. The strip is back to ROLE rows only.
    expect(
      availabilityAction(
        unit({
          write_ins: [cover({ note: 'Burst pipe' })],
          reason: 'Burst pipe',
          is_family_available: false,
        })
      )
    ).toBeNull()
  })

  it('offers to clear a role row with `null`, which DELETES it', () => {
    // There is no value meaning "normal": writing one would pin the unit
    // against a later change to its role.
    expect(
      availabilityAction(unit({ family_available_override: true, is_family_available: true }))
    ).toEqual({
      kind: 'clear',
      label: 'Clear',
      familyAvailable: null,
      prompt: 'none',
      unitId: 'u1',
      unitName: 'Cedar 1',
    })
  })

  it('offers to clear a released staff cabin, naming its own row', () => {
    // This branch clears a RELEASE, not a write-in, and it fires ahead of the
    // write-in gate so a staff cabin that a relative's write-in also covers
    // keeps the clear its badge names.
    expect(
      availabilityAction(
        unit({
          inventory_class: 'staff_default',
          family_available_override: true,
          is_family_available: true,
        })
      )
    ).toMatchObject({ kind: 'clear', label: 'Clear' })
  })

  it('offers to clear a row that merely agrees with the unit role', () => {
    // Redundant but storable, and reachable by a hand-edited row rather than
    // by this control. Clearing it is the only way to stop it pinning the unit
    // against a later registry edit, so the action must not be withheld just
    // because the resolved answer looks ordinary.
    expect(availabilityAction(unit({ family_available_override: true }))?.kind).toBe('clear')
    expect(
      availabilityAction(
        unit({
          inventory_class: 'staff_default',
          family_available_override: false,
          is_family_available: false,
        })
      )?.kind
    ).toBe('clear')
  })

  it('reads null and false as different answers, exactly as the badge does', () => {
    // The trap. `unit.family_available_override !== null` is the test; a
    // truthiness test (`if (unit.family_available_override)`) treats an
    // ordinary cabin's null and a held cabin's false alike, and whichever way
    // that branch falls, `clear` becomes either unreachable or offered on every
    // ordinary cabin. Null must fall through to nothing; false must clear.
    expect(availabilityAction(unit({ family_available_override: null }))).toBeNull()
    expect(
      availabilityAction(unit({ family_available_override: false, is_family_available: false }))
        ?.kind
    ).toBe('clear')
    // And a write-in, which is a different row in a different table, offers
    // NOTHING here: its removal is the X on its own card (kindred#2381).
    expect(
      availabilityAction(unit({ write_ins: [cover()], is_family_available: false }))
    ).toBeNull()
  })

  it('offers nothing on a plain family cabin — creating a write-in left this strip entirely', () => {
    // The 2026-08-18 ruling: a write-in is created by typing into the card's
    // own family box, so this strip has no write-in action to offer and no
    // occupancy gate to apply. It used to return a `hold` here, and to refuse
    // one on an occupied card (#2090) — both are gone together.
    expect(availabilityAction(unit())).toBeNull()
  })

  it('takes no occupancy argument at all any more', () => {
    // The signature IS the guarantee: with the write-in branch gone, every
    // action left is about the unit's ROLE row, which a placed family has
    // never had any bearing on. A second parameter would be the #2090 gate
    // growing back.
    expect(availabilityAction).toHaveLength(1)
  })

  it('offers nothing on a SPLIT container', () => {
    // Still nothing, and for the reason that survived: a split container gets
    // no card (`drawnUnits` descends past it) and `resolveDrop` rejects it as
    // a target, so an availability row written against it is one no surface
    // could ever show or act on.
    expect(availabilityAction(unit({ is_container: true }))).toBeNull()
  })

  it('offers nothing on a MERGED building, like every other card', () => {
    // This once asserted a `hold`, and the reasoning behind it still matters:
    // a COMBINED container is the one card the board draws in place of its
    // rooms, so refusing it a write-in left the four `default_combined`
    // buildings in the 2026 registry with no path at all — their rooms have no
    // cards to carry one either. The 2026-08-18 ruling keeps that guarantee
    // and moves it: the path is the card's own family box, which is reachable
    // on a combined container whether or not it already holds a family.
    expect(availabilityAction(unit({ is_container: true, is_combined: true }))).toBeNull()
  })

  it('offers nothing on a MERGED building that has been written into', () => {
    // It may cover four rows at once and the strip carries ONE action, so no
    // button here could name which of the four a click would destroy. Each
    // write-in is removed by the X on its own card (kindred#2381).
    expect(
      availabilityAction(unit({ is_container: true, is_combined: true, write_ins: [cover()] }))
    ).toBeNull()
  })

  it('offers nothing on a MERGED building either — but the write-in path is no longer closed', () => {
    // This strip stays silent on a combined container, as on every other card.
    // What CHANGED is what that silence costs: it used to mean a partly-filled
    // merged building had no write-in path at all, because its rooms lose their
    // own cards to the merge and #2090's gate refused the building. The box on
    // the card now takes it. See `LodgingUnitCard`'s `canPickFamily`.
    expect(availabilityAction(unit({ is_container: true, is_combined: true }))).toBeNull()
  })
})

describe('shareabilityBadge', () => {
  // kindred#2026. The unit half of "may two families sleep here", distinct
  // from the household half (`share_eligibility`) that the party cards carry.

  it('marks a unit a second party may be placed into', () => {
    expect(shareabilityBadge(unit({ shareability: 'shareable' }))?.label).toBe('Shared OK')
  })

  it('says nothing on a one-family room', () => {
    // 74 of 118 registry rows are single_party, so badging them would put a
    // chip on most of the board to state the default expectation. Silence
    // here is the SAFE direction: it advertises no permission.
    expect(shareabilityBadge(unit({ shareability: 'single_party' }))).toBeNull()
  })

  it('says so out loud when nobody has classified the unit', () => {
    // NOT silence, and this is the whole reason the column is a select rather
    // than a bool. After 1500000145's backfill no registry row is unknown, so
    // this chip only ever appears on a hand-created unit — where it is the one
    // prompt a staffer gets to answer the question before the board is worked.
    expect(shareabilityBadge(unit({ shareability: 'unknown' }))?.label).toBe('Sharing unset')
  })

  it('treats an absent field as unclassified rather than as permission', () => {
    // Pydantic defaults render optional in TypeScript, so a payload built by
    // an older server arrives with the key missing. Undefined must land on the
    // same non-permissive answer as an empty column, never on 'shareable'.
    const withoutField = unit()
    delete (withoutField as Partial<LodgingUnitRow>).shareability
    expect(shareabilityBadge(withoutField)?.label).toBe('Sharing unset')
  })
})

/**
 * kindred#2179 — the warning this issue exists for, and the one occupancy mark
 * on this board that is genuinely RARE.
 *
 * Its opposite number, the shared-space ring, was STRUCK on 2026-08-09 for
 * firing constantly: it lit the buildings designed to hold several families,
 * which is every dormitory- and village-style unit every weekend. This chip is
 * the inverse population — `single_party` is 74 of the 118 registry rows, and a
 * second party in one of them is an anomaly rather than the designed case.
 *
 * Counts OVERLAPPING parties, never the card's raw party count. The caller
 * passes `overlappingPartyKeys(...).size`, so two households in disjoint rooms
 * of one building never reach the > 1 branch — the same "disjoint means no
 * shared bedroom" reasoning that killed the ring.
 */
/*
 * ⚠️ `sharingConflictBadge`'s describe was here and went with the function —
 * kindred#2072 struck the `One-family space` chip it drew (vocabulary §3).
 * It never fired: all 23 room-sharing cards in the registry are classified
 * `shareable`. Its absence from the card is pinned in
 * `LodgingUnitCard.test.tsx`, "the marks kindred#2072 STRUCK from the unit
 * card".
 */

describe('a write-in inherited from elsewhere in the tree', () => {
  /*
   * The board draws whichever level the tree resolves to, so the card carrying
   * a write-in is often not the unit the row names: split a written-into
   * building and its rooms carry it; merge over a written-into room and the
   * building does. Both must BADGE the fact, and neither offers a strip action
   * for it: since kindred#2381 a card may cover several write-ins at once, and
   * each is removed by the X on its own `WriteInCard` — the only control that
   * can name one row out of four.
   */
  const coverFromBuilding = {
    unit_id: 'id-house',
    unit_code: 'house',
    unit_name: 'House',
    occupant_name: 'Liam Garcia',
    note: '',
  }

  it('badges a room whose BUILDING was written into', () => {
    expect(reservationBadge(unit({ code: 'house-a', write_ins: [coverFromBuilding] }))?.label).toBe(
      'Write-in'
    )
  })

  it('offers no strip action, because the removal lives on the card', () => {
    // kindred#2381. The strip carries ONE action, so on a merged building over
    // four write-ins it could name only one of the four rows — and it did:
    // clearing re-resolved the card to the next occupant, so the click read as
    // a no-op and four of them destroyed four rows without ever disclosing
    // that more than one existed. Removal is now the X on each `WriteInCard`,
    // which can only delete the row it sits on.
    expect(availabilityAction(unit({ code: 'house-a', write_ins: [coverFromBuilding] }))).toBeNull()
  })

  it('offers nothing on a card covered by a relative’s write-in, occupied or not', () => {
    expect(availabilityAction(unit({ code: 'house-a', write_ins: [coverFromBuilding] }))).toBeNull()
  })

  it('names the card’s OWN unit on the actions it does still return', () => {
    // A released staff cabin is the reachable one: its `clear` names its own
    // row. The unit pair is asserted rather than left off, so it cannot go
    // quietly missing from the payload the board sends.
    const action = availabilityAction(
      unit({ inventory_class: 'staff_default', family_available_override: true })
    )

    expect(action?.kind).toBe('clear')
    expect(action?.unitId).toBe('u1')
    expect(action?.unitName).toBe('Cedar 1')
  })

  it('badges a MERGED building written into through one of its rooms', () => {
    const fromRoom = {
      unit_id: 'id-house-a',
      unit_code: 'house-a',
      unit_name: 'House A',
      occupant_name: 'Ava Martinez',
      note: '',
    }

    expect(
      reservationBadge(
        unit({ code: 'house', is_container: true, is_combined: true, write_ins: [fromRoom] })
      )?.label
    ).toBe('Write-in')
    expect(
      availabilityAction(
        unit({ code: 'house', is_container: true, is_combined: true, write_ins: [fromRoom] })
      )
    ).toBeNull()
  })
})

describe('the badge and the clear must name the SAME row', () => {
  /*
   * `availabilityAction` lives beside `reservationBadge` so the two cannot
   * drift — a card badged "Write-in" that offers to "Write in" says two things
   * about one cabin. Once a write-in can be INHERITED, that invariant grows
   * teeth: a card can carry its own availability row AND a relative's
   * write-in at the same time. The strip resolves the ROLE rows only — a
   * write-in is removed from its own card since kindred#2381 — so a card the
   * badge calls "Write-in" must offer no strip action at all rather than one
   * that quietly unmakes something the reader was not looking at.
   */
  const coverFromBuilding = {
    unit_id: 'id-house',
    unit_code: 'house',
    unit_name: 'House',
    occupant_name: 'Liam Garcia',
    note: '',
  }

  it('clears the BUILDING’s write-in on a room carrying a stale release of its own', () => {
    // Reachable through the API, which does not check an override against the
    // unit's role — `true` on a family_pool row agrees with that role and no
    // surface writes it, but nothing deletes one either. The badge reads
    // "Write-in" here, so the clear must be the write-in.
    const stale = unit({
      unit_id: 'u-room',
      code: 'house-a',
      name: 'House A',
      family_available_override: true,
      write_ins: [coverFromBuilding],
    })

    expect(reservationBadge(stale)?.label).toBe('Write-in')
    // No strip action at all: the badge names the write-in, and a write-in is
    // removed from its own card. The stale role row becomes clearable again
    // once nothing is written into the space.
    expect(availabilityAction(stale)).toBeNull()
  })

  it('still clears its OWN row on a released staff cabin, which is what its badge names', () => {
    // The other side of the same rule, and why this is not simply "the cover
    // always wins": a released staff cabin badges "Released" off its own row,
    // so that is the row its clear has to name — even when a relative's
    // write-in also covers it.
    const released = unit({
      unit_id: 'u-room',
      code: 'house-a',
      name: 'House A',
      inventory_class: 'staff_default',
      family_available_override: true,
      write_ins: [coverFromBuilding],
    })

    expect(reservationBadge(released)?.label).toBe('Released')
    expect(availabilityAction(released)?.unitId).toBe('u-room')
  })
})
