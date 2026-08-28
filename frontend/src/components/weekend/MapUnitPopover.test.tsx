/**
 * The in-place peek. Fictional data throughout.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow, WriteInCoverRow } from '../../types/lodging'
import type { MapUnit } from './mapModel'
import { MapUnitPopover } from './MapUnitPopover'
import { partyKey } from './partyKey'

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

function row(overrides: Partial<LodgingUnitRow> = {}): LodgingUnitRow {
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
    // ⚠️ THE RESOLVED COVERAGES DEFAULT TO `none`, AND THAT IS THE FIXTURE
    // CHANGE THAT MATTERS. This helper used to set none of them, so every
    // amenity assertion in this file was answered by the RAW columns beside
    // them — which encoded "the map lists what the registry ROW says", the
    // pre-kindred#1912 rule the unit card abandoned when it moved to
    // `power_coverage`. A container's own row is `has_power: false` while
    // every leaf beneath it is powered, so that rule draws no plug on twelve
    // entirely-powered buildings.
    //
    // `none` rather than `unknown` so a test that wants a mark has to SAY so,
    // matching `AssignFamilyModal.test.tsx`'s and `LodgingUnitCard.test.tsx`'s
    // own unit helpers — three suites, one default, so a fixture copied
    // between them keeps meaning the same thing.
    power_coverage: 'none',
    ac_coverage: 'none',
    fridge_coverage: 'none',
    has_ramp: '',
    ramp_coverage: 'none',
    is_confirmed: false,
    is_active: true,
    is_container: false,
    inventory_class: 'family_pool',
    shareability: 'single_party',
    family_available_override: null,
    reason: '',
    is_family_available: true,
    map_x: 0.4,
    map_y: 0.5,
    ...overrides,
  }
}

function party(name: string): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 9001,
    person_cm_id: 0,
    display_name: name,
    adults: [],
    children: [],
    party_size: 3,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    },
  }
}

function mapUnit(unit: LodgingUnitRow, parties: RosterPartyRow[] = []): MapUnit {
  return {
    unit,
    parties,
    consent: null,
    hue: 'hsl(160 45% 42%)',
    // What `buildMapModel` computes for an ORDINARY room (kindred#2183) — one
    // room, its own capacity. A combined house overrides both; see the
    // container tests at the foot of this file.
    roomCount: 1,
    capacity: unit.sleeps ?? null,
    // Nothing straddles: the ordinary case, and what `buildMapModel` computes
    // for a party wholly inside the room it is drawn on. The spanning fixtures
    // override it — see the over-capacity block below.
    spanWidth: 0,
    x: 0.4,
    y: 0.5,
  }
}

/** A room whose sharing nobody consented to — what #1926 exists to surface. */
function flagged(unit: LodgingUnitRow, parties: RosterPartyRow[]): MapUnit {
  return {
    ...mapUnit(unit, parties),
    consent: {
      declinedCount: 1,
      unansweredCount: 0,
      reason: '1 family did not request sharing',
    },
  }
}

const HUE = 'hsl(160 45% 42%)'

describe('MapUnitPopover — one room', () => {
  it('names the room and its area', () => {
    render(<MapUnitPopover units={[mapUnit(row())]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Cedar Grove')).toBeInTheDocument()
  })

  it('names the occupant', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row(), [party('Johnson')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByRole('button', { name: /Johnson/ })).toBeInTheDocument()
  })

  it('names the occupant by its attending adults, not a mismatched salutation', () => {
    // kindred#2084: `display_name` is CampMinder's mailing_title, which
    // disagreed with the real attending-adult list on 26.7% of 2026's
    // rostered households. This reuses FamilyCard's own construction
    // (`householdIdentity.ts`) instead of the salutation.
    const johnson = party('Mr. and Mrs. Johnson')
    johnson.adults = [
      { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
      { adult_number: 2, display_name: 'David Johnson', relationship: 'Father' },
    ]
    render(<MapUnitPopover units={[mapUnit(row(), [johnson])]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Emma Johnson · David Johnson' })).toBeInTheDocument()
    expect(screen.queryByText('Mr. and Mrs. Johnson')).not.toBeInTheDocument()
  })

  it('says a room is empty rather than leaving it blank', () => {
    render(<MapUnitPopover units={[mapUnit(row())]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText(/empty/i)).toBeInTheDocument()
  })

  it('never renders an unknown capacity as 0', () => {
    render(
      <MapUnitPopover units={[mapUnit(row({ sleeps: null }))]} hue={HUE} onOpenParty={vi.fn()} />
    )
    // Only the positive assertion here. A `queryByText(/sleeps 0/i)` companion
    // was removed: `dt` and `dd` are separate elements, so that string can never
    // form one text node and the assertion could not fail whatever the code did.
    expect(screen.getByText(/unknown/i)).toBeInTheDocument()
  })

  it('opens the party when its name is clicked', async () => {
    const onOpenParty = vi.fn()
    const johnson = party('Johnson')
    render(
      <MapUnitPopover units={[mapUnit(row(), [johnson])]} hue={HUE} onOpenParty={onOpenParty} />
    )
    await userEvent.click(screen.getByRole('button', { name: /Johnson/ }))
    expect(onOpenParty).toHaveBeenCalledWith(johnson)
  })

  it('draws NO write-in chip on a written-into room, because bunking happens on the board', () => {
    // ⛔ RETIRED 2026-08-21 by owner ruling on #2499. This asserted the
    // OPPOSITE — that the map badges a written-into room — and it is rewritten
    // rather than adapted, because the specification changed, not the code.
    //
    // Staff bunk on the BOARD; the map is for visibility and checks. Write-in
    // occupancy is board business, so the map draws no "Write-in" chip. The
    // map's two call sites now apply the same `writeInBadgeApplies` gate the
    // unit card has used since kindred#2252, so the two surfaces agree.
    // `reservationBadge` is the shared source for this; a second copy is how
    // the three surfaces start disagreeing about what the word means. It
    // INHERITED kindred#2078's rename for free, which is the point — this
    // popover renders no availability string of its own.
    render(
      <MapUnitPopover
        units={[
          mapUnit(
            row({
              write_ins: [cover()],
              occupant_name: 'Emma Johnson',
              is_family_available: false,
            })
          ),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Write-in')).not.toBeInTheDocument()
  })

  it('says a deactivated room is inactive', () => {
    // It only reaches the board at all because somebody is still in it —
    // `boardLayout`'s own comment: "hiding it would drop them."
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_active: false }), [party('Johnson')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })

  it('says when nobody has confirmed the room amenities', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_confirmed: false }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument()
  })

  it('lists the amenities the RESOLVED coverages report', () => {
    // The five marks, on the fixture that separates them from the raw
    // columns: every raw flag is false and every resolved coverage is `all`,
    // which is exactly the shape a combined building takes on the wire.
    render(
      <MapUnitPopover
        units={[
          mapUnit(
            row({
              bathroom: 'private',
              has_power: false,
              power_coverage: 'all',
              has_ac: false,
              ac_coverage: 'all',
              has_fridge: false,
              fridge_coverage: 'all',
              is_accessible: false,
              has_ramp: '',
              ramp_coverage: 'all',
            })
          ),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.getByLabelText('Power')).toBeInTheDocument()
    expect(screen.getByLabelText('Air conditioning')).toBeInTheDocument()
    expect(screen.getByLabelText('Fridge')).toBeInTheDocument()
    expect(screen.getByLabelText('Step-free')).toBeInTheDocument()
  })

  it('reports beds needed against the capacity', () => {
    // `party_size` over-counts adults (all household adults are added whether
    // or not they attend), so this is a sizing hint, not a verdict.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ sleeps: 4 }), [party('Johnson')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('3 of 4')).toBeInTheDocument()
  })

  it('flags an occupant whose confirmed cabin does not answer their request', () => {
    // Reuses `partyAttention`, which already encodes the rule that only a
    // CONFIRMED cabin is evidence — an unset `has_power` means "nobody has
    // said", not "there is no power".
    const needsPower = party('Johnson')
    needsPower.flags = {
      needs_private_bathroom: false,
      needs_power: true,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    }
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ is_confirmed: true, has_power: false, power_coverage: 'none' }), [
            needsPower,
          ]),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/No power/)).toBeInTheDocument()
  })

  it('names the unmet occupant by its attending adults too', () => {
    const needsPower = party('Mr. and Mrs. Johnson')
    needsPower.adults = [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }]
    needsPower.flags = {
      needs_private_bathroom: false,
      needs_power: true,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    }
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ is_confirmed: true, has_power: false, power_coverage: 'none' }), [
            needsPower,
          ]),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/Emma Johnson — No power/)).toBeInTheDocument()
    expect(screen.queryByText(/Mr\. and Mrs\. Johnson/)).not.toBeInTheDocument()
  })

  it('grades an UNCONFIRMED cabin against the request, and still badges it', () => {
    /*
     * ⚠️ REVERSED BY kindred#2526. This used to assert the peek said NOTHING
     * about an unconfirmed cabin's power. Registry values are taken at face
     * value now: a cabin recorded as having no power fails a power request
     * whether or not staff have reconfirmed it this season.
     *
     * The `Unconfirmed` badge is the flag's REMAINING job and is asserted
     * alongside deliberately — the reconfirm work-down list stays, only the
     * suppression went.
     */
    const needsPower = party('Johnson')
    needsPower.flags = {
      needs_private_bathroom: false,
      needs_power: true,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    }
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ is_confirmed: false, has_power: false, power_coverage: 'none' }), [
            needsPower,
          ]),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/No power/)).toBeInTheDocument()
    expect(screen.getByText('Unconfirmed')).toBeInTheDocument()
  })

  it('prints the consent reason, as the board card does', () => {
    // The board renders `consent.reason` verbatim beside the slot. The map
    // carries the identical flag off the same slot, so the peek must say the
    // same thing rather than showing an ordinary shared room.
    render(
      <MapUnitPopover
        units={[flagged(row(), [party('Johnson'), party('Garcia')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('1 family did not request sharing')).toBeInTheDocument()
  })

  it('gives two occupants distinct keys even when the payload omits both ids', () => {
    // `household_cm_id` / `person_cm_id` are optional on the generated type, so
    // an omission is reachable through the schema even though the API's own
    // contract says exactly one is non-zero. Keyed on the ids alone both
    // occupants collapse to `household-undefined` and React reconciles two
    // different families as one row. The shared `partyKey` falls back to the
    // display name; every surface that lists parties inherits that.
    const anonymous = (name: string): RosterPartyRow => {
      const base = party(name)
      // `delete` rather than a rest-destructure: both fields are optional, and
      // this says "the payload omitted them" without binding two throwaway
      // names the linter then flags as unused.
      delete base.household_cm_id
      delete base.person_cm_id
      return base
    }
    const warn = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    render(
      <MapUnitPopover
        units={[mapUnit(row(), [anonymous('Johnson'), anonymous('Garcia')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    const messages = warn.mock.calls.map((call) => String(call[0])).join('\n')
    warn.mockRestore()
    expect(messages).not.toMatch(/same key/i)
  })
})

/**
 * THE AMENITY LIST READS WHAT THE SERVER RESOLVED, NEVER THE ROW'S OWN
 * COLUMNS.
 *
 * `mapModel` builds from `buildBoard`, so a COMBINED CONTAINER is a map slot —
 * and a container's own registry row is the one row whose amenity columns are
 * meaningless. Measured over the five containers ever drawn combined in 2026:
 * three report no power against `power_coverage: 'all'`, three report no AC
 * with AC-bearing rooms, one reports no fridge against `fridge_coverage:
 * 'all'`, and all five reported no bathroom before the resolver landed.
 *
 * The same component already graded NEEDS off the resolved fields, through
 * `partyAttention`, so this list disagreed with the red line printed two
 * elements below it in the same card.
 */
describe('MapUnitPopover — amenities, off the resolved coverages', () => {
  it('counts a SHARED bathroom as a bathroom in the unit', () => {
    // kindred#2501, owner ruling 2026-08-20: the axis is PRESENCE, not
    // exclusivity — the CampMinder question behind the family's flag asks for
    // "a bathroom that doesn't require you to leave your cabin". `shared` is a
    // bathroom INSIDE the cabin that two parties split; walking to a bathhouse
    // records as `none`. The retired `Private bathroom` / `Shared bathroom`
    // pair said which kind, which is a distinction no staff member on this
    // surface can act on.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ bathroom: 'shared' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Bathroom in unit')).toBeInTheDocument()
    expect(screen.queryByLabelText('Shared bathroom')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Private bathroom')).not.toBeInTheDocument()
  })

  it('reads the bathroom the SERVER resolved onto a container, not the container row', () => {
    // `_resolve_bathroom` fills a container's own `bathroom` from its leaves,
    // and 8 of the 15 production containers moved from `none` to `private`
    // when it landed. Nothing here re-derives it; the field is already right.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_container: true, bathroom: 'private' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Bathroom in unit')).toBeInTheDocument()
  })

  it('draws the plug for a building whose rooms are powered but whose own row is not', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ has_power: false, power_coverage: 'all' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Power')).toBeInTheDocument()
  })

  it('draws power and AC for a building where only SOME rooms have them', () => {
    // PRESENCE, the same reading `LodgingUnitCard`'s title row takes: the mark
    // says the building offers it somewhere. Whether it reaches a particular
    // family is the need glyph's question, and that one grades `some` on its
    // own scale.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ power_coverage: 'some', ac_coverage: 'some' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Power')).toBeInTheDocument()
    expect(screen.getByLabelText('Air conditioning')).toBeInTheDocument()
  })

  it('counts a shared fridge as a fridge, because the server already did', () => {
    // Owner ruling 2026-08-15: a SHARED fridge IS a fridge, which is why
    // `_resolve_fridge_coverage` ORs `has_shared_fridge` in. Read the resolved
    // field and this surface inherits the ruling instead of holding a second
    // implementation of it — the fixture's raw `has_fridge` is false.
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ has_fridge: false, has_shared_fridge: true, fridge_coverage: 'all' })),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Fridge')).toBeInTheDocument()
  })

  it('draws no step-free mark on a cabin staff assessed as having NO ramp', () => {
    // ⚠️ `has_ramp` IS A THREE-VALUE SELECT, SO `'no'` IS A TRUTHY STRING.
    // Any consumer testing it for truthiness renders "step-free" on the very
    // cabins staff assessed as explicitly having none — the exact inversion
    // the select exists to prevent.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ has_ramp: 'no', ramp_coverage: 'none' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Step-free')).not.toBeInTheDocument()
  })

  it('withholds the step-free mark when only SOME rooms are step-free', () => {
    // NOT the power/fridge reading, and the asymmetry is already ruled in
    // `needGlyphs`' `someIs`: a fridge one room over is still a fridge a
    // family can use, and a ramp one room over is not. A building advertising
    // two step-free rooms out of ten invites precisely the placement that
    // lands in one of the other eight.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ ramp_coverage: 'some' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Step-free')).not.toBeInTheDocument()
  })

  it('withholds it for a QUALIFIED ramp too, rather than overclaiming step-free', () => {
    // `partial` is the fifth grade `ramp_coverage` carries and the other three
    // dimensions cannot: a ramp with a lip. The list has one binary mark per
    // dimension and no room for degree, so "Step-free" would state more than
    // the registry recorded.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ ramp_coverage: 'partial' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Step-free')).not.toBeInTheDocument()
  })

  it('does not take `is_accessible` as the step-free answer', () => {
    /*
     * ⚠️ AN OPEN PRODUCT QUESTION, DELIBERATELY NOT SETTLED HERE. `is_accessible`
     * and `has_ramp` are two independent registry columns and they DISAGREE:
     * of the production rows recording `has_ramp: 'yes'`, two are
     * `is_accessible: true` and three are false. Which one staff mean by
     * "accessible" needs an owner, not a guess from this file.
     *
     * What is NOT open is whether this list may keep reading `is_accessible`.
     * It is a raw boolean on the row, so it carries the container trap every
     * other raw column here carried, and it has no resolver. `ramp_coverage`
     * is resolved over the leaves and is the field the step-free NEED GLYPH
     * already grades against on this same card — so it is the one reading this
     * surface can defend, and the one it takes until the question is answered.
     */
    render(
      <MapUnitPopover
        units={[mapUnit(row({ is_accessible: true, has_ramp: '', ramp_coverage: 'none' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Step-free')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Accessible')).not.toBeInTheDocument()
  })

  it('says nothing at all about a space nobody has assessed', () => {
    // `unknown` is not a soft yes. The list is an inclusion list, so silence
    // is its way of declining to assert anything.
    render(
      <MapUnitPopover
        units={[
          mapUnit(
            row({
              bathroom: 'unknown',
              power_coverage: 'unknown',
              ac_coverage: 'unknown',
              fridge_coverage: 'unknown',
              ramp_coverage: 'unknown',
            })
          ),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByLabelText('Bathroom in unit')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Power')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Air conditioning')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Fridge')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Step-free')).not.toBeInTheDocument()
  })
})

/**
 * THE OVER-CAPACITY COLOUR IS A CLAIM, AND A SPANNING PARTY WITHHOLDS IT.
 *
 * Since kindred#2010 a party holding several rooms is drawn on EACH of them,
 * so the same six people appear on two marks and there is no per-room split to
 * divide them by — `party_size` is one number for the household. Both board
 * surfaces already gate on it (`LodgingUnitCard`'s `overCapacity`, the Assign
 * modal's header); this popover asserted it with no gate at all.
 *
 * ZERO parties span in 2026's registry, so nothing is on screen today. This is
 * the latent half, pinned before it is reachable rather than after.
 */
describe('MapUnitPopover — the over-capacity mark, gated as the board gates it', () => {
  const OVERFULL = mapUnit(row({ sleeps: 2 }), [party('Johnson')])

  it('colours a room the party wholly occupies and over-fills', () => {
    render(<MapUnitPopover units={[OVERFULL]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('3 of 2')).toHaveClass('text-amber-700')
  })

  it('withholds the colour from a party drawn on more rooms than this one', () => {
    // Three people against this room's two beds is not a verdict anyone can
    // support when the household also holds the room next door. The FIGURE
    // still stands — over-stating reads as "look at this", where dropping the
    // party would read as "room for more" — and only the claim is withheld.
    render(
      <MapUnitPopover units={[{ ...OVERFULL, spanWidth: 2 }]} hue={HUE} onOpenParty={vi.fn()} />
    )
    expect(screen.getByText('3 of 2')).not.toHaveClass('text-amber-700')
  })
})

describe('MapUnitPopover — shareability (kindred#2026)', () => {
  // This popover is the ONE surface that already prints `shared by N`. Saying a
  // room is shared by two while saying nothing about whether it MAY be is the
  // drift `unitBadges`' header exists to prevent ("shared by the board's slot
  // cards and the map's unit popover so the two cannot drift").

  it('says a unit may take a second family', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ shareability: 'shareable' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Shared OK')).toBeInTheDocument()
  })

  it('flags an unclassified unit rather than letting silence read as safe', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ shareability: 'unknown' }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Sharing unset')).toBeInTheDocument()
  })

  it('stays silent on a one-family room, exactly as the board card does', () => {
    render(<MapUnitPopover units={[mapUnit(row())]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.queryByText('Shared OK')).not.toBeInTheDocument()
    expect(screen.queryByText('Sharing unset')).not.toBeInTheDocument()
  })

  it('shows BOTH the occupancy fact and the permission on a shared room', () => {
    // The pairing is the point: `shared by 2` reports what IS, the chip reports
    // what is ALLOWED. A staffer seeing the first without the second cannot
    // tell a legitimate share from a double-booking.
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ shareability: 'single_party' }), [party('Johnson'), party('Garcia')]),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText(/shared by 2/)).toBeInTheDocument()
  })
})

describe('MapUnitPopover — a cluster of rooms', () => {
  it('does not put empty rooms in the tab order', () => {
    const empty = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={empty} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(2)
    expect(screen.queryAllByRole('button')).toHaveLength(0)
  })

  it('marks an empty room "empty" in its title, readable by a mouse', () => {
    const empty = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={empty} hue={HUE} onOpenParty={vi.fn()} />)
    // The tooltip carries the FULL name — it appears with no surrounding
    // context, so the shortened form would be ambiguous. Regression: a
    // shortened label leaking into `title` reads as "1 — empty", not
    // "Cedar 1 — empty".
    const first = screen.getByTitle('Cedar 1 — empty')
    expect(first).not.toHaveTextContent('Cedar 1')
    const second = screen.getByTitle('Cedar 2 — empty')
    expect(second).not.toHaveTextContent('Cedar 2')
  })

  it('drops the building name the cluster shares, so cells differ visibly', () => {
    // A browser found this: every cell read "Cedar Lodge Ba…" / "Cedar Lodge
    // La…" and truncated away the distinguishing word.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft' })),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Back')).toBeInTheDocument()
    expect(screen.getByText('Loft')).toBeInTheDocument()
    expect(screen.queryByText(/Cedar Lodge Back/)).not.toBeInTheDocument()
    // Stripping the building name from every cell must not delete it
    // entirely — it belongs in the header instead. That header is now the
    // master summary's, not the grid's own (kindred#2183); the rule it
    // encodes is unchanged, only where the name is said once.
    expect(screen.getByText('Cedar Lodge')).toBeInTheDocument()
    expect(screen.getByText('2 · 0 taken, 2 open')).toBeInTheDocument()
  })

  it('leaves unrelated cabin names alone', () => {
    const scattered = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'birch-2', name: 'Birch 2' })),
    ]
    render(<MapUnitPopover units={scattered} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Birch 2')).toBeInTheDocument()
    // No shared prefix means no stray building name in the header either —
    // the summary falls back to the room count.
    expect(screen.getByText('2 rooms')).toBeInTheDocument()
  })

  it('says a room is shared rather than showing only the first family', () => {
    const shared = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [
        party('Johnson'),
        party('Garcia'),
      ]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={shared} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Johnson +1')).toBeInTheDocument()
  })

  it('labels a cluster cell by attending adults, not a mismatched salutation', () => {
    // kindred#2084, same construction as the single-room DetailCard above.
    const johnson = party('Mr. and Mrs. Johnson')
    johnson.adults = [{ adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' }]
    const cluster = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [johnson]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={cluster} hue={HUE} onOpenParty={vi.fn()} />)
    // Scoped to the CELL: the master summary above it names the same people
    // (kindred#2183), so an unscoped `getByText` now matches two elements and
    // would fail for a reason that has nothing to do with the salutation.
    expect(screen.getAllByTestId('map-popover-cell')[0]).toHaveTextContent('Emma Johnson')
    expect(screen.queryByText(/Mr\. and Mrs\. Johnson/)).not.toBeInTheDocument()
  })

  const units = [
    mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [party('Johnson')]),
    mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    mapUnit(row({ unit_id: 'u3', code: 'cedar-3', name: 'Cedar 3' })),
  ]

  it('summarises how many rooms and how many are taken', () => {
    // Said once, in the master summary, since kindred#2183 — the grid's own
    // duplicate header went with it. The building name these three share
    // ("Cedar") leads the summary; the counts follow.
    render(<MapUnitPopover units={units} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Cedar')).toBeInTheDocument()
    expect(screen.getByText('3 · 1 taken, 2 open')).toBeInTheDocument()
  })

  it('draws one cell per room', () => {
    render(<MapUnitPopover units={units} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(3)
  })

  it('carries a written-into or deactivated room’s status into the cluster cell', () => {
    // The grid has no room for badges, but a cell that says nothing makes a
    // held room in a house indistinguishable from a bookable one. The tooltip
    // is free space.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-2',
          name: 'Cedar 2',
          write_ins: [cover({ unit_id: 'u2', unit_code: 'cedar-2', unit_name: 'Cedar 2' })],
          is_family_available: false,
          is_active: false,
        })
      ),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    // Per #2499 the cell no longer carries the "Write-in" CHIP LABEL — but it
    // must now NAME THE OCCUPANT instead, and must still carry "Inactive",
    // which is a different fact (the room is unbookable) and the half of this
    // test that was never in question.
    expect(screen.getByTitle(/Cedar 2.*Emma Johnson.*Inactive/i)).toBeInTheDocument()
    expect(screen.queryByTitle(/Write-in/i)).not.toBeInTheDocument()
    // The cell must NOT call a room somebody sleeps in empty. Scoped to
    // Cedar 2 — Cedar 1 carries no write-in and no party, so "empty" is the
    // correct answer for it and must survive.
    expect(screen.queryByTitle(/Cedar 2.*empty/i)).not.toBeInTheDocument()
    expect(screen.getByTitle(/Cedar 1 — empty/i)).toBeInTheDocument()
  })

  it('names the occupant in a write-in-only cluster cell rather than calling it empty', () => {
    // Regression caught by review of the first cut of kindred#2499: `DetailCard`
    // and `ClusterSummary` were taught about write-in occupants and
    // `FootprintGrid` was not, so its cell still built `label`/`who`/`base`
    // from `entry.parties[0]` alone. A write-in-only room — the COMMON case,
    // since most write-ins are non-rostered staff and carry no party — fell to
    // the `${name} — empty` branch, directly beneath a summary now reporting
    // that same room as taken. One popover, two contradictory answers.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-2',
          name: 'Cedar 2',
          write_ins: [
            cover({
              unit_id: 'u2',
              unit_code: 'cedar-2',
              unit_name: 'Cedar 2',
              occupant_name: 'Liam Garcia',
            }),
          ],
          is_family_available: false,
        })
      ),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('2 · 1 taken, 1 open')).toBeInTheDocument()
    expect(screen.getByTitle(/Cedar 2.*Liam Garcia/i)).toBeInTheDocument()
    expect(screen.queryByTitle(/Cedar 2 — empty/i)).not.toBeInTheDocument()
  })

  it('states no Beds line for a cluster written into WHOLESALE, rather than \u201c0 of N\u201d', () => {
    // kindred#2540 final scan, FINDING 3. `writeInSized` sums RECORDED counts
    // only, so a cover with no count contributes 0 \u2014 and the Beds row was
    // rendered unconditionally, so a house written into whole printed
    // `Beds 0 of 4` directly beneath `Rooms 2 \u00b7 2 taken, 0 open`. One
    // popover, two contradictory answers, and every production write-in row is
    // unsized, so this WAS the live reading rather than an edge case.
    //
    // `main` said `Sleeps 4 \u00b7 0 placed` here, which was at least literally
    // true; folding write-ins into `placed` is what made silence the only
    // honest answer. `DetailCard` already gates its own Beds row exactly this
    // way, so this matches it rather than inventing a third phrasing.
    const house = [
      mapUnit(
        row({
          unit_id: 'u1',
          code: 'cedar-1',
          name: 'Cedar 1',
          write_ins: [
            cover({
              unit_id: 'u1',
              unit_code: 'cedar-1',
              unit_name: 'Cedar 1',
              occupant_name: 'Liam Garcia',
            }),
          ],
          is_family_available: false,
        })
      ),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-2',
          name: 'Cedar 2',
          write_ins: [
            cover({
              unit_id: 'u2',
              unit_code: 'cedar-2',
              unit_name: 'Cedar 2',
              occupant_name: 'Emma Johnson',
            }),
          ],
          is_family_available: false,
        })
      ),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('2 \u00b7 2 taken, 0 open')).toBeInTheDocument()
    expect(screen.queryByText('Beds')).not.toBeInTheDocument()
    expect(screen.queryByText(/0 of \d+/)).not.toBeInTheDocument()
  })

  it('still states Beds once any write-in carries a recorded count', () => {
    // The other half of FINDING 3's fix: the gate must not silence a cluster
    // that DOES have a figure to state. One recorded count is enough.
    const house = [
      mapUnit(
        row({
          unit_id: 'u1',
          code: 'cedar-1',
          name: 'Cedar 1',
          write_ins: [
            cover({
              unit_id: 'u1',
              unit_code: 'cedar-1',
              unit_name: 'Cedar 1',
              occupant_name: 'Liam Garcia',
              party_size: 2,
            }),
          ],
          is_family_available: false,
        })
      ),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('Beds')).toBeInTheDocument()
  })

  it('keeps a write-in-only cell INERT — there is no party to open behind it', () => {
    const onOpenParty = vi.fn()
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-2',
          name: 'Cedar 2',
          write_ins: [cover({ unit_id: 'u2', unit_code: 'cedar-2', unit_name: 'Cedar 2' })],
        })
      ),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(onOpenParty).not.toHaveBeenCalled()
  })

  it('says WHICH room in a cluster carries the consent flag', () => {
    // A cluster mark rings amber if ANY member is flagged, which on a
    // four-room house narrows it to four. The grid is where that resolves to
    // one room, so the flag has to survive into the cell — in the tooltip as
    // well as the border, since colour alone is not a signal.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [party('Nguyen')]),
      flagged(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' }), [
        party('Johnson'),
        party('Garcia'),
      ]),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    // kindred#2177: an occupied cell is a control, so its detail rides on the
    // reachable tooltip rather than a `title` no tablet can open.
    const cells = screen.getAllByTestId('map-popover-cell')
    const flaggedCell = cells.find((cell) =>
      (cell.getAttribute('aria-label') ?? '').includes('Cedar 2')
    )
    expect(flaggedCell).toBeDefined()
    expect(flaggedCell).not.toHaveAttribute('title')
    // The NAME, not a description: this cell is the one trigger whose bubble
    // sentence has to double as its accessible name, because the family name
    // it shows is repeated by a second control in the same popover. There is
    // no `aria-describedby` to double it with any more — kindred#2348 deleted
    // that wiring from `ui/Tooltip` outright, for every trigger, along with
    // the closed-state `sr-only` mirror it needed to resolve against. The
    // assertion below stays as the guard against it coming back.
    expect(flaggedCell).toHaveAccessibleName(/Cedar 2.*sharing not consented/i)
    expect(flaggedCell).not.toHaveAttribute('aria-describedby')
    // Eyes still get it, which is the half a `title` never gave a tablet.
    fireEvent.focus(flaggedCell as HTMLElement)
    expect(screen.getByRole('tooltip')).toHaveTextContent(/Cedar 2.*sharing not consented/i)

    const plainCell = cells.find((cell) =>
      (cell.getAttribute('aria-label') ?? '').includes('Cedar 1')
    )
    expect(plainCell).not.toHaveAccessibleName(/sharing not consented/i)
  })

  it('a room cell still PICKS its room when tapped, tooltip and all', () => {
    // The tooltip must not steal the cell's own action — it opens on hover,
    // focus and tap, and the tap goes on doing what it always did.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' }), [party('Nguyen')]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' }), [party('Johnson')]),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    const cell = screen
      .getAllByTestId('map-popover-cell')
      .find((candidate) => candidate.textContent.includes('Johnson'))
    expect(cell).toBeDefined()
    fireEvent.click(cell as HTMLElement)
    expect(screen.getByText(/← All/)).toBeInTheDocument()
  })
})

/**
 * kindred#2183 — the container's peek. Before this, `units.length === 1`
 * chose between a rich `DetailCard` and a bare `FootprintGrid`, so a
 * multi-room building could NEVER show the good card: its cells carried a
 * family label and nothing else. The owner's ruling replaced the either/or
 * with master-detail — a summary over every room, the grid beneath it as a
 * spatial picker, and today's single-room card reachable from a cell.
 */
describe('MapUnitPopover — a container, master-detail (kindred#2183)', () => {
  /** Distinct `household_cm_id`s, so `partyKey` tells the families apart. */
  function family(
    cmId: number,
    salutation: string,
    adults: string[],
    children: string[] = []
  ): RosterPartyRow {
    const base = party(salutation)
    base.household_cm_id = cmId
    base.adults = adults.map((name, index) => ({
      adult_number: index + 1,
      display_name: name,
      relationship: '',
    }))
    base.children = children.map((name) => ({
      person_cm_id: 0,
      display_name: name,
      age: 8,
      grade: 3,
    }))
    return base
  }

  /**
   * The SUMMARY's chip for the Garcias, not the grid cell that also names
   * them: a cell's accessible name lists its occupants too, so a role query
   * matches both.
   */
  function garciaChip(): HTMLElement {
    const chip = screen
      .getAllByTestId('map-popover-family')
      .find((node) => node.textContent.includes('Sofia Garcia'))
    if (!chip) throw new Error('no family chip for the Garcias')
    return chip
  }

  const JOHNSON = family(
    9001,
    'The Johnsons',
    ['Dana Johnson', 'Marcus Johnson'],
    ['Emma Johnson', 'Noah Johnson']
  )
  const GARCIA = family(9002, 'The Garcias', ['Sofia Garcia'])

  const HOUSE = [
    mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back', sleeps: 4 }), [
      JOHNSON,
    ]),
    mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft', sleeps: 2 }), [
      GARCIA,
    ]),
    mapUnit(row({ unit_id: 'u3', code: 'cedar-side', name: 'Cedar Lodge Side', sleeps: 3 })),
  ]

  it('summarises the whole building above the grid, rather than only the cells', () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    // The building name the cells no longer carry.
    expect(screen.getByText('Cedar Lodge')).toBeInTheDocument()
    expect(screen.getByText('Rooms')).toBeInTheDocument()
    expect(screen.getByText('3 · 2 taken, 1 open')).toBeInTheDocument()
    // The grid is still there — it is the cluster disambiguator, not decoration.
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(3)
  })

  it('lists every PERSON housed in the building, grouped one chip per family', () => {
    // The owner's ask verbatim: not a family label, the people. Adults and
    // children alike — a chip that named only the grown-ups would answer
    // "who is housed here" with half the household.
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    expect(
      screen.getByRole('button', {
        name: 'Dana Johnson · Marcus Johnson · Emma Johnson · Noah Johnson',
      })
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sofia Garcia' })).toBeInTheDocument()
    // The salutation is never the identity — kindred#2084's rule, inherited.
    expect(screen.queryByText(/The Johnsons/)).not.toBeInTheDocument()
  })

  it('opens the family panel when a family chip is clicked', async () => {
    const onOpenParty = vi.fn()
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={onOpenParty} />)
    await userEvent.click(screen.getByRole('button', { name: 'Sofia Garcia' }))
    expect(onOpenParty).toHaveBeenCalledWith(GARCIA)
  })

  it('totals the building’s beds and says how many are spoken for', () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    // 4 + 2 + 3 beds; both parties report `party_size: 3`.
    expect(screen.getByText('6 of 9')).toBeInTheDocument()
  })

  it('counts a family holding two rooms once, not once per room', () => {
    // ONE TOGGLE AWAY on the 2026 registry, not hypothetical. A household is
    // already let across two adjacent rooms of one house as a single merged
    // placement, and `indexPayload` puts a multi-room party on EVERY room it
    // occupies — "A party holding several rooms appears on each of them",
    // which is what stops the second room rendering empty. It does not double
    // today only because that house is drawn COMBINED, so the two rooms are
    // one card; splitting it is a scenario toggle staff have already used on
    // another house this year, and the rooms are close enough to cluster
    // under one pin, which makes this peek exactly what opens over it.
    //
    // The chip list already dedupes by `partyKey`; the bed total must too, or
    // the summary contradicts itself — one family, twice its beds, and a
    // "placed" figure that can exceed the building's own capacity.
    const spread = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back', sleeps: 2 }), [
        JOHNSON,
      ]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft', sleeps: 3 }), [
        JOHNSON,
      ]),
    ]
    render(<MapUnitPopover units={spread} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getAllByTestId('map-popover-family')).toHaveLength(1)
    // 2 + 3 beds; ONE household of 3, however many doors it is behind.
    expect(screen.getByText('3 of 5')).toBeInTheDocument()
  })

  it('folds a written-in room’s recorded count into the building’s placed figure', () => {
    // kindred#2540. `summaryWriteIns` already carries the sized counts, but
    // only for the "Occupied by" name list — the beds arithmetic above it
    // summed `families` alone, so a cluster containing a sized write-in
    // reported "0 placed" at the building level while `DetailCard` reports
    // the true count for that same room once staff drill in. One popover
    // contradicting itself, which is the defect class this whole surface
    // exists to remove. Reads `sized`, never `consumed` — see
    // `writeInDemand`'s own doc for why the two must not collapse.
    const withWriteIn = [
      HOUSE[0],
      HOUSE[1],
      mapUnit(
        row({
          unit_id: 'u3',
          code: 'cedar-side',
          name: 'Cedar Lodge Side',
          sleeps: 3,
          write_ins: [
            cover({
              unit_id: 'u3',
              unit_code: 'cedar-side',
              unit_name: 'Cedar Lodge Side',
              party_size: 2,
            }),
          ],
        })
      ),
    ]
    render(<MapUnitPopover units={withWriteIn as MapUnit[]} hue={HUE} onOpenParty={vi.fn()} />)
    // Capacity unchanged at 9 (4 + 2 + 3); 6 rostered + 2 written-in = 8 placed.
    expect(screen.getByText('8 of 9')).toBeInTheDocument()
  })

  it('counts an ancestor write-in once across every room it resolves onto', () => {
    // CodeRabbit's second review of kindred#2540. `sized` deliberately EXCLUDES
    // ancestor covers per `DetailCard` — an ancestor's count is a fact about
    // the house, not the room, so printing it on both halves of a split house
    // would spend one party twice on one screen. That rule is right for a
    // single card, but a CLUSTER is the house-level aggregate the ancestor
    // number belongs to. A house written in whole and then split draws its
    // ROOMS, not itself (`drawnUnits`); every room inherits the SAME ancestor
    // row, so the old per-room `sized` sum reported zero — not the true count
    // — for a house that has some. The fix dedupes by the cover's own
    // `unit_id` (`WriteInSource.unitId`, published once per row no matter how
    // many rooms resolve it) before summing — the same identity
    // `summaryWriteIns` already uses for the "Occupied by" name list.
    const ancestor = cover({
      unit_id: 'cedar-house',
      unit_code: 'cedar-house',
      unit_name: 'Cedar House',
      occupant_name: 'Overnight Staff',
      relation: 'ancestor',
      party_size: 5,
      unit_sleeps: 7,
    })
    const split = [
      mapUnit(
        row({
          unit_id: 'u1',
          code: 'cedar-back',
          name: 'Cedar Lodge Back',
          sleeps: 4,
          write_ins: [ancestor],
        })
      ),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-loft',
          name: 'Cedar Lodge Loft',
          sleeps: 3,
          write_ins: [ancestor],
        })
      ),
    ]
    render(<MapUnitPopover units={split} hue={HUE} onOpenParty={vi.fn()} />)
    // Capacity 4 + 3 = 7. Placed: the ONE ancestor row's `party_size` (5) —
    // not 0 (per-room `sized` drops ancestors) and not 10 (double-counted
    // once per room it resolves onto).
    expect(screen.getByText('5 of 7')).toBeInTheDocument()
  })

  it('lists BOTH occupants of one shareable cabin, and counts both', () => {
    /*
     * DARK ON ARRIVAL — `idx_lodging_write_in_unique` still forbids the second
     * row. `summaryWriteIns` deduped the cluster's covers through a `Set` on
     * `source.unitId`, and its own comment already feared exactly this
     * failure: *"two rooms can genuinely hold two different people who happen
     * to share a name, and collapsing those would hide one."* It then
     * introduced the same hiding through the id, because one unit meant one
     * row. Two occupants of Ridge D were ONE chip and one headcount.
     *
     * The dedupe is still needed and still right — a building's ancestor row
     * comes back once per drawn room and listing it per room would name one
     * occupant four times. What changed is that it keys on the ROW
     * (`entry.key`) rather than on the unit.
     */
    const shared = [
      // TWO units, because a lone unit draws `DetailCard` and it is
      // `ClusterSummary` that holds `summaryWriteIns`. The second is empty and
      // contributes capacity only.
      mapUnit(row({ unit_id: 're', code: 'ridge-e', name: 'Ridge E', sleeps: 5 })),
      mapUnit(
        row({
          unit_id: 'rd',
          code: 'ridge-d',
          name: 'Ridge D',
          sleeps: 15,
          write_ins: [
            cover({
              unit_id: 'rd',
              unit_code: 'ridge-d',
              unit_name: 'Ridge D',
              occupant_name: 'Emma Johnson',
              party_size: 3,
              unit_sleeps: 15,
            }),
            cover({
              unit_id: 'rd',
              unit_code: 'ridge-d',
              unit_name: 'Ridge D',
              occupant_name: 'Liam Garcia',
              party_size: 4,
              unit_sleeps: 15,
            }),
          ],
        })
      ),
    ]
    render(<MapUnitPopover units={shared} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getAllByTestId('map-popover-writein')).toHaveLength(2)
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    // 3 + 4 of 15 + 5 — neither party dropped by the dedupe.
    expect(screen.getByText('7 of 20')).toBeInTheDocument()
  })

  it('counts an ancestor cover and a room’s own cover separately in one cluster', () => {
    // The mixed case: deduping by row identity must not collapse two
    // DIFFERENT rows into one, nor drop the own-cover figure the pre-existing
    // sum already got right (kindred#2540's original fix, guarded above).
    const ancestor = cover({
      unit_id: 'cedar-house',
      unit_code: 'cedar-house',
      unit_name: 'Cedar House',
      occupant_name: 'Overnight Staff',
      relation: 'ancestor',
      party_size: 5,
      unit_sleeps: 7,
    })
    const own = cover({
      unit_id: 'z1',
      unit_code: 'birch-1',
      unit_name: 'Birch 1',
      occupant_name: 'Weekend Staff',
      party_size: 2,
    })
    const mixed = [
      mapUnit(
        row({
          unit_id: 'u1',
          code: 'cedar-back',
          name: 'Cedar Lodge Back',
          sleeps: 4,
          write_ins: [ancestor],
        })
      ),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-loft',
          name: 'Cedar Lodge Loft',
          sleeps: 3,
          write_ins: [ancestor],
        })
      ),
      mapUnit(
        row({ unit_id: 'z1', code: 'birch-1', name: 'Birch 1', sleeps: 2, write_ins: [own] })
      ),
    ]
    render(<MapUnitPopover units={mixed} hue={HUE} onOpenParty={vi.fn()} />)
    // Capacity 4 + 3 + 2 = 9. Placed: the ancestor row once (5) plus the
    // separate own row (2) = 7 — not 12 (the ancestor double-counted) and not
    // 5 (the own cover dropped by the dedupe).
    expect(screen.getByText('7 of 9')).toBeInTheDocument()
  })

  it('refuses a building total when one of its rooms is unmeasured', () => {
    const partial = [HOUSE[0], mapUnit(row({ unit_id: 'u9', code: 'cedar-x', sleeps: null }))]
    render(<MapUnitPopover units={partial as MapUnit[]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText(/unknown/i)).toBeInTheDocument()
    expect(screen.queryByText(/^4 · /)).not.toBeInTheDocument()
  })

  it('carries a flagged room’s consent warning onto the family chip, in words', () => {
    // A cluster mark rings amber if ANY member is flagged. The summary is the
    // first thing a staff member reads, so the warning has to survive into it
    // — and as TEXT, because colour alone is not a signal (WCAG 1.4.1).
    const withFlag = [
      flagged(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back' }), [
        JOHNSON,
        GARCIA,
      ]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft' })),
    ]
    render(<MapUnitPopover units={withFlag} hue={HUE} onOpenParty={vi.fn()} />)
    expect(garciaChip()).toHaveTextContent(/sharing not consented/i)
  })

  it('leaves an unflagged family chip free of the consent warning', () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    expect(garciaChip()).not.toHaveTextContent(/sharing not consented/i)
  })

  it('says a whole empty building is empty rather than listing nobody', () => {
    const vacant = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft' })),
    ]
    render(<MapUnitPopover units={vacant} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('2 · 0 taken, 2 open')).toBeInTheDocument()
    // Exact, not `/empty/i`: this is the SUMMARY's stand-alone "empty" text.
    expect(screen.getByText('empty')).toBeInTheDocument()
    expect(screen.queryAllByTestId('map-popover-family')).toHaveLength(0)
  })

  it('renders no sr-only " — empty" text beside an unoccupied room cell (kindred#2348)', () => {
    // Regression: a closed cell used to carry `{label}<span class="sr-only">
    // — empty</span>`, invisible text browser find-in-page still matched.
    // The cell's `title` attribute already says so for a mouse; no
    // assistive tech reads this app (`frontend/CLAUDE.md`), so nothing
    // further belongs in the DOM.
    const vacant = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-2', name: 'Cedar 2' })),
    ]
    render(<MapUnitPopover units={vacant} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.queryByText('— empty')).not.toBeInTheDocument()
  })

  it('swaps the detail to one room when its cell is picked, and back again', async () => {
    render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Cedar Lodge Loft/ }))
    // Today's single-room DetailCard, now reachable from a container.
    expect(screen.getByText('Cedar Lodge Loft')).toBeInTheDocument()
    expect(screen.getByText('Cedar Grove')).toBeInTheDocument()
    expect(screen.queryByText('3 · 2 taken, 1 open')).not.toBeInTheDocument()
    // The grid stays put — it is the picker, and picking must not remove it.
    expect(screen.getAllByTestId('map-popover-cell')).toHaveLength(3)

    await userEvent.click(screen.getByRole('button', { name: '← All of Cedar Lodge' }))
    expect(screen.getByText('3 · 2 taken, 1 open')).toBeInTheDocument()
  })

  it('falls back to the summary when the picked room leaves the cluster', async () => {
    // The popover is reconciled by POSITION, so a refetch that dissolves this
    // cluster and mints another would otherwise leave a room selected that is
    // no longer under the pin. Same latch shape as `LodgingMap`'s pinned key.
    const { rerender } = render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Cedar Lodge Loft/ }))
    expect(screen.getByText('Cedar Lodge Loft')).toBeInTheDocument()

    const elsewhere = [
      mapUnit(row({ unit_id: 'z1', code: 'birch-1', name: 'Birch 1' })),
      mapUnit(row({ unit_id: 'z2', code: 'birch-2', name: 'Birch 2' })),
    ]
    rerender(<MapUnitPopover units={elsewhere} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('2 · 0 taken, 2 open')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /← All of/ })).not.toBeInTheDocument()
  })

  it('does not restore the old pick when the original cluster comes back', async () => {
    // The other half of the latch above. Falling back to the summary while the
    // room is absent is not enough on its own: the id is still in state, so
    // clicking pin A, then pin B, then pin A again re-applies it and room 2's
    // card reappears under a click that only asked for the building. That is
    // the same "a view reopens with no click" defect `LodgingMap` fixed for
    // its own pinned/dwell keys (kindred#2137 bug 4), one level in.
    const elsewhere = [
      mapUnit(row({ unit_id: 'z1', code: 'birch-1', name: 'Birch 1' })),
      mapUnit(row({ unit_id: 'z2', code: 'birch-2', name: 'Birch 2' })),
    ]
    const { rerender } = render(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: /Cedar Lodge Loft/ }))
    rerender(<MapUnitPopover units={elsewhere} hue={HUE} onOpenParty={vi.fn()} />)
    rerender(<MapUnitPopover units={HOUSE} hue={HUE} onOpenParty={vi.fn()} />)

    expect(screen.getByText('3 · 2 taken, 1 open')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /← All of/ })).not.toBeInTheDocument()
  })

  it('still shows a lone room as a plain detail card, with no grid or summary', () => {
    render(<MapUnitPopover units={[mapUnit(row(), [JOHNSON])]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.queryAllByTestId('map-popover-cell')).toHaveLength(0)
    expect(screen.queryByText('Rooms')).not.toBeInTheDocument()
  })

  it('names the whole family on a lone room too, not only its adults', () => {
    render(<MapUnitPopover units={[mapUnit(row(), [JOHNSON])]} hue={HUE} onOpenParty={vi.fn()} />)
    expect(
      screen.getByRole('button', {
        name: 'Dana Johnson · Marcus Johnson · Emma Johnson · Noah Johnson',
      })
    ).toBeInTheDocument()
  })

  it('reports a combined house’s WHOLE capacity, not its landing-futon delta', () => {
    // kindred#2041: a container's own `sleeps` is a DELTA over its rooms. The
    // map draws a combined house as ONE mark, so its peek is a lone
    // `DetailCard` — reading the raw delta there understates a four-room
    // house as sleeping one. `buildMapModel` resolves the whole-house figure;
    // this card must read THAT.
    const house = mapUnit(
      row({
        unit_id: 'h0',
        code: 'cedar-house',
        name: 'Cedar House',
        is_container: true,
        sleeps: 1,
      })
    )
    render(
      <MapUnitPopover
        units={[{ ...house, roomCount: 4, capacity: 9 }]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('9')).toBeInTheDocument()
    expect(screen.queryByText('1')).not.toBeInTheDocument()
  })
})

describe('MapUnitPopover — the whole-building marker, extended from the board (kindred#2174)', () => {
  // `wholeBuildingKeys` is computed by `LodgingMap` from the full registry
  // (`wholeBuildingHolders(parties, units)`, kindred#2008) and handed down as
  // one prop — this popover never re-derives the grain from its own `units`,
  // which is only a cluster's members and cannot answer the question alone.

  it('badges the DetailCard tags row when the room’s occupant holds the whole building', () => {
    const johnson = party('Johnson')
    render(
      <MapUnitPopover
        units={[mapUnit(row(), [johnson])]}
        hue={HUE}
        onOpenParty={vi.fn()}
        wholeBuildingKeys={new Set([partyKey(johnson)])}
      />
    )
    expect(screen.getByText('Whole building')).toBeInTheDocument()
  })

  it('does not badge an ordinary room, with no `wholeBuildingKeys` supplied at all', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row(), [party('Johnson')])]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
  })

  it('does not badge a room whose occupant is not in the holder set', () => {
    const johnson = party('Johnson')
    render(
      <MapUnitPopover
        units={[mapUnit(row(), [johnson])]}
        hue={HUE}
        onOpenParty={vi.fn()}
        // A DIFFERENT party's key — the set is non-empty but doesn't name this one.
        wholeBuildingKeys={new Set(['household-9999'])}
      />
    )
    expect(screen.queryByText('Whole building')).not.toBeInTheDocument()
  })

  it('badges the ClusterSummary chip for the family that holds the whole building, and not the other', () => {
    const johnson = party('Johnson')
    johnson.household_cm_id = 9001
    const garcia = party('Garcia')
    garcia.household_cm_id = 9002
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-back', name: 'Cedar Lodge Back', sleeps: 2 }), [
        johnson,
      ]),
      mapUnit(row({ unit_id: 'u2', code: 'cedar-loft', name: 'Cedar Lodge Loft', sleeps: 2 }), [
        garcia,
      ]),
    ]
    render(
      <MapUnitPopover
        units={house}
        hue={HUE}
        onOpenParty={vi.fn()}
        wholeBuildingKeys={new Set([partyKey(johnson)])}
      />
    )
    const chips = screen.getAllByTestId('map-popover-family')
    const johnsonChip = chips.find((node) => node.textContent.includes('Johnson'))
    const garciaChip = chips.find((node) => node.textContent.includes('Garcia'))
    if (!johnsonChip || !garciaChip) throw new Error('expected both family chips')
    expect(johnsonChip.textContent).toContain('Whole building')
    expect(garciaChip.textContent).not.toContain('Whole building')
  })

  it('renders the whole-building badge alone, the write-in chip having been dropped', () => {
    // ⛔ RETIRED 2026-08-21 by owner ruling on #2499. This asserted the
    // OPPOSITE — that the map badges a written-into room — and it is rewritten
    // rather than adapted, because the specification changed, not the code.
    //
    // Staff bunk on the BOARD; the map is for visibility and checks. Write-in
    // occupancy is board business, so the map draws no "Write-in" chip. The
    // map's two call sites now apply the same `writeInBadgeApplies` gate the
    // unit card has used since kindred#2252, so the two surfaces agree.
    // #2078 added the write-in badge (via `reservationBadge`, unit-level, in
    // the DetailCard's status list) after this issue was filed. It is
    // orthogonal to `wholeBuildingKeys` (party-keyed) — a room can carry both
    // — and the two must render as two distinct, readable badges, not collide
    // into one string.
    const johnson = party('Johnson')
    render(
      <MapUnitPopover
        units={[
          mapUnit(
            row({
              write_ins: [cover()],
              occupant_name: 'Emma Johnson',
              is_family_available: false,
            }),
            [johnson]
          ),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
        wholeBuildingKeys={new Set([partyKey(johnson)])}
      />
    )
    // The whole-building badge is untouched by #2499 and must survive; only
    // the write-in chip goes. Asserting both keeps this test pinning the
    // thing it was written for — that these are two independent signals —
    // rather than silently narrowing to one.
    expect(screen.getByText('Whole building')).toBeInTheDocument()
    expect(screen.queryByText('Write-in')).not.toBeInTheDocument()
  })
})

/**
 * kindred#2499, owner ruling: the map treats a write-in the way the BOARD
 * does — as an occupant — rather than as a chip beside an otherwise empty
 * room.
 *
 * The board settled this in kindred#2078: "the room read as EMPTY AND CLOSED
 * when in truth it was FULL. This is the same fact, printed where the board
 * prints occupancy." Its well stacks `WriteInCard` and `FamilyCard` together,
 * because "a shared space is not a new KIND of card; it is a card with two
 * occupants in it."
 *
 * The map's "Occupied by" row is its equivalent of that well, and it said
 * `empty` for a room somebody is sleeping in. These pin the fix.
 *
 * The shared unit is `writeInEntries` — the tree-aware, server-ordered
 * resolver the board already calls — NOT the presentation: the board draws
 * cards, the map draws a compact list, and those grammars are deliberately
 * different.
 */
describe('MapUnitPopover write-in occupants (kindred#2499)', () => {
  it('names the write-in occupant instead of calling the room empty', () => {
    render(
      <MapUnitPopover
        units={[mapUnit(row({ write_ins: [cover()], is_family_available: false }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.queryByText('empty')).not.toBeInTheDocument()
  })

  it('lists a write-in and a placed family together, as one well of occupants', () => {
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ write_ins: [cover({ occupant_name: 'Liam Garcia' })] }), [party('Chen')]),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Liam Garcia')).toBeInTheDocument()
    expect(screen.getByText('Chen')).toBeInTheDocument()
  })

  it('says the occupant is not named rather than printing a blank', () => {
    // Mirrors `WriteInCard`'s UNNAMED fallback, now shared from `writeIn.ts`
    // so the two surfaces cannot word it differently.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ write_ins: [cover({ occupant_name: '' })] }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('Occupant not named')).toBeInTheDocument()
  })

  it('does NOT make the occupant look clickable — there is no panel behind one', () => {
    // `WriteInCard`'s ruling, carried across: "a card that looks interactive
    // and is not is worse than plain text." A family opens its panel; a
    // write-in has none.
    const onOpenParty = vi.fn()
    render(
      <MapUnitPopover
        units={[mapUnit(row({ write_ins: [cover()] }))]}
        hue={HUE}
        onOpenParty={onOpenParty}
      />
    )
    expect(screen.getByText('Emma Johnson').closest('button')).toBeNull()
  })

  it('counts a written-into room as taken in the cluster summary, not open', () => {
    // The count keyed on `parties.length`, and a write-in occupant is by
    // definition NOT a rostered party — so a full room was reported open,
    // contradicting kindred#2078 on the very surface that ruling was about.
    const house = [
      mapUnit(row({ unit_id: 'u1', code: 'cedar-1', name: 'Cedar 1' })),
      mapUnit(
        row({
          unit_id: 'u2',
          code: 'cedar-2',
          name: 'Cedar 2',
          write_ins: [cover({ unit_id: 'u2', unit_code: 'cedar-2', unit_name: 'Cedar 2' })],
          is_family_available: false,
        })
      ),
    ]
    render(<MapUnitPopover units={house} hue={HUE} onOpenParty={vi.fn()} />)
    expect(screen.getByText('2 · 1 taken, 1 open')).toBeInTheDocument()
  })
})

/**
 * A write-in's optional `party_size` (kindred#2503) reaching the map peek —
 * the last surface in the plan. `writeInDemand`'s own doc in `writeIn.ts`
 * carries the arithmetic; these pin the three things Task 11 changes: the
 * figure's numerator, `overCapacity`'s threshold, and the gate that used to
 * hide the figure entirely on a write-in-only room.
 *
 * Both the figure and `overCapacity` read `writeInDemand`'s `sized` —
 * mirroring `LodgingUnitCard`'s own `occupants + writeInPeople` exactly
 * (`writeInPeople` IS `sized` there too) — never `consumed`, which folds in
 * a wholesale fallback and an ancestor's whole-card claim and is capped at
 * capacity. That distinction has already caused one real finding in this
 * plan; the last test below pins it here too.
 */
describe('MapUnitPopover write-in party size in the peek figure (kindred#2503)', () => {
  it('counts written-in people in the peek figure', () => {
    // spotsNeeded (3, from `party('Johnson')`) + sized (2, the cover's own
    // recorded count).
    render(
      <MapUnitPopover
        units={[
          mapUnit(row({ sleeps: 15, write_ins: [cover({ party_size: 2 })] }), [party('Johnson')]),
        ]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('5 of 15')).toBeInTheDocument()
  })

  it('draws a figure for a cabin holding only write-ins', () => {
    // The gate used to be `parties.length > 0`, so since kindred#2525 the peek
    // listed the write-in occupant by name and then printed no number at all
    // beside them — a room the peek stayed silent about how full it was.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ sleeps: 15, write_ins: [cover({ party_size: 2 })] }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('2 of 15')).toBeInTheDocument()
  })

  it('prints no figure for a cabin holding only an UNSIZED write-in — the day-one guard', () => {
    // Every production write-in row is unsized today, so `sized` is 0 and the
    // widened gate `(parties.length > 0 || sized > 0) && capacityKnown` must
    // reduce to exactly the old gate's answer: no parties, no recorded size,
    // no figure. Regress this and every occupied-but-unsized cabin in
    // production starts printing "0 of N".
    render(
      <MapUnitPopover
        units={[mapUnit(row({ sleeps: 15, write_ins: [cover()] }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.queryByText('Beds')).not.toBeInTheDocument()
    expect(screen.queryByText(/of 15/)).not.toBeInTheDocument()
    // The occupant still gets listed — this task changes only the figure.
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('reddens on the same UNCAPPED sized figure it prints, not the capped `consumed`', () => {
    // No placed party (spotsNeeded=0), capacity 3, one write-in with a
    // hand-typed count of 5 — well above the room's own beds. `sized` is
    // deliberately uncapped (`writeInDemand`'s doc), so the figure prints the
    // true "5 of 3" rather than clamping to capacity, exactly as
    // `LodgingUnitCard`'s own `overCapacity` reads `occupants + writeInPeople`
    // (kindred#2503) rather than the separately-capped `consumed`. Printing
    // "5 of 3" without reddening would be the self-contradiction spec §6.2
    // forbids: had this card instead been wired to the capped `consumed`
    // (`Math.min(5, 3) = 3`), `0 + 3 = 3` is not greater than capacity 3 and
    // this would never redden.
    render(
      <MapUnitPopover
        units={[mapUnit(row({ sleeps: 3, write_ins: [cover({ party_size: 5 })] }))]}
        hue={HUE}
        onOpenParty={vi.fn()}
      />
    )
    expect(screen.getByText('5 of 3')).toHaveClass('text-amber-700')
  })
})
