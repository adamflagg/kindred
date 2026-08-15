/**
 * The detail panel is what makes §3.8's omissions a DEFERRAL rather than a
 * loss — request text and the medical narrative are one click away, not gone.
 *
 * It mirrors `CamperDetailsPanel`'s interaction contract and reuses none of
 * its 1442 camper-coupled lines.
 *
 * Fictional data throughout.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { LodgingUnitRow, RosterPartyRow } from '../../types/lodging'
import { FamilyDetailsPanel } from './FamilyDetailsPanel'

const isAdmin = { value: true }

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: isAdmin.value,
    permissions: [],
    hasPermission: () => isAdmin.value,
    hasAnyPermission: () => isAdmin.value,
  }),
}))

const medicalResult = {
  value: { data: undefined, isLoading: false, error: null } as {
    data: unknown
    isLoading: boolean
    error: Error | null
  },
}

const journeyResult = {
  value: { data: undefined, isLoading: false, error: null } as {
    data: unknown
    isLoading: boolean
    error: Error | null
  },
}

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => medicalResult.value,
  useHouseholdJourney: (...args: unknown[]) => {
    journeyCalls.push(args[0] as number | null)
    return journeyResult.value
  },
}))

/** Every `householdCmId` the journey hook was handed, in call order. */
const journeyCalls: Array<number | null> = []

// One client per TEST, built outside the render path. Constructing it inside
// the wrapper body rebuilds it on every render, discarding the cache and
// starting a fresh loading pass underneath assertions that already resolved.
// Same fix as `admin/lodging/LodgingUnitsPanel.test.tsx`.
let client: QueryClient

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

// MemoryRouter added for kindred#2329: a linked child's name inside the
// household-year-members modal this panel hosts is now a `<Link>`, which
// throws outside a Router context.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

/**
 * Drives whichever `animationend` React actually listens for here — which is
 * NOT necessarily what `fireEvent.animationEnd` fires.
 *
 * jsdom has no global `AnimationEvent`, so React's own feature detection
 * (`"AnimationEvent" in window`, react-dom's event-plugin setup) reads this as
 * a browser with no unprefixed support and registers its listener for the
 * vendor-prefixed `webkitAnimationEnd` instead — jsdom's own `<div>.style`
 * exposes `WebkitAnimation`, which is what sends it down that branch.
 * `@testing-library/dom`'s `fireEvent.animationEnd` dispatches only the
 * unprefixed name, which is real DOM traffic (a plain listener sees it) but
 * never reaches `onAnimationEnd` — confirmed by hand before writing this.
 *
 * Firing BOTH names rather than hardcoding the prefixed one: React registers
 * exactly one of the two, so `onAnimationEnd` still fires exactly once
 * either way, and this survives a jsdom upgrade that starts defining
 * `AnimationEvent` (at which point React would listen for the unprefixed
 * name instead) with no maintenance.
 */
function fireAnimationEnd(el: HTMLElement) {
  fireEvent(el, new Event('animationend', { bubbles: true, cancelable: true }))
  fireEvent(el, new Event('webkitAnimationEnd', { bubbles: true, cancelable: true }))
}

const REQUEST_TEXT = 'We would like to be near the Garcia family if there is room.'

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  return {
    grain: 'household',
    household_cm_id: 101,
    display_name: 'Johnson',
    adults: [
      { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
      { adult_number: 2, display_name: 'David Johnson', relationship: 'Father' },
    ],
    children: [
      { person_cm_id: 9001, display_name: 'Noah Johnson', last_name: 'Johnson', age: 8, grade: 3 },
    ],
    party_size: 3,
    unit_code: 'cedar-1',
    unit_name: 'Cedar 1',
    is_merged_slot: false,
    arrival_eta: 'Friday 6pm',
    is_returning: true,
    share: {
      preference: 'yes_share',
      proximity: ['with'],
      request_text: REQUEST_TEXT,
      needs_resolution: false,
    },
    flags: { needs_power: true },
    ...overrides,
  }
}

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

beforeEach(() => {
  isAdmin.value = true
  medicalResult.value = { data: undefined, isLoading: false, error: null }
  journeyResult.value = { data: undefined, isLoading: false, error: null }
  journeyCalls.length = 0
})

describe('FamilyDetailsPanel — the content the card omits', () => {
  it('shows the verbatim request text, one click from the board', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText(REQUEST_TEXT)).toBeInTheDocument()
  })

  it('renders the medical narrative without a reveal click', () => {
    // kindred#1889 removed the click-to-reveal: it was gated on a flag true
    // for every household, so it gated nothing. A `bunking.manage` holder now
    // sees the text directly (`isAdmin` is true for this suite).
    medicalResult.value = {
      data: { allergy_info: 'Peanuts' },
      isLoading: false,
      error: null,
    }
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })

    expect(screen.getByText('Peanuts')).toBeInTheDocument()
  })

  it('does not render the narrative for an adult-weekend party', () => {
    // A person-grain party has no household, so there is nothing to look a
    // narrative up by. This pins the PANEL's grain gate -- `isHousehold`
    // deciding `householdCmId`, and the `> 0 ? : null` below it -- which is
    // the half that decides whether a person-grain party ever asks for
    // `/households/0/medical`. `MedicalNarrative`'s own null gate is pinned
    // separately in its suite.
    //
    // The hook mock is grain-blind on purpose: it returns a narrative for
    // ANY arguments. So the only thing that can keep this text off the panel
    // is the gate, and mutating either half turns this red -- which the
    // assertion it replaced could not do, having outlived the button it
    // looked for.
    medicalResult.value = {
      data: { allergy_info: 'Peanuts' },
      isLoading: false,
      error: null,
    }
    render(
      <FamilyDetailsPanel
        party={party({
          grain: 'person',
          household_cm_id: 0,
          person_cm_id: 5001,
          adults: [],
          children: [],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.queryByText('Peanuts')).not.toBeInTheDocument()
  })
})

describe('FamilyDetailsPanel — household identity', () => {
  /*
   * kindred#2180, owner ruling 2026-08-09: "The X Family" REPLACES the
   * attending-adult headline. The adults are not lost and are not demoted to
   * a sub-line -- they stay in the Party list alongside the children, which
   * the section below pins.
   *
   * That supersedes kindred#2084's choice ON THIS SURFACE ONLY, and it is not
   * a return of what #2084 deleted: the salutation was CampMinder's
   * `mailing_title`, which disagreed with the real adult list on 26.7% of
   * 2026's 382 rostered households. A surname derived from the children's own
   * `persons.last_name` carries none of that. The other four surfaces still
   * use `partyIdentityLabel`.
   *
   * The fixture's `display_name: 'Johnson'` deliberately matches neither the
   * adult list nor the derived label's full form, so a bare heading of
   * 'Johnson' would mean the old salutation leaked back in.
   */
  it('names the household from its children’s surnames, not the salutation or the adults', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByRole('heading', { name: 'The Johnson Family' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Johnson' })).not.toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: 'Emma Johnson · David Johnson' })
    ).not.toBeInTheDocument()
  })

  it('carries the same identity into the panel’s aria-label', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByRole('dialog', { name: 'The Johnson Family details' })).toBeInTheDocument()
  })

  it('joins two child surnames with an ampersand', () => {
    render(
      <FamilyDetailsPanel
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah Johnson', last_name: 'Johnson', age: 8 },
            { person_cm_id: 9002, display_name: 'Ava Garcia', last_name: 'Garcia', age: 5 },
          ],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByRole('heading', { name: 'The Johnson & Garcia Family' })).toBeInTheDocument()
  })

  // One of 2026's 382 rostered households already needs this form, and
  // kindred#2073's heading spans years and goes higher. Not hypothetical.
  it('commas the middle of three or more child surnames', () => {
    render(
      <FamilyDetailsPanel
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah Johnson', last_name: 'Johnson', age: 8 },
            { person_cm_id: 9002, display_name: 'Ava Garcia', last_name: 'Garcia', age: 5 },
            { person_cm_id: 9003, display_name: 'Mia Nguyen', last_name: 'Nguyen', age: 3 },
          ],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(
      screen.getByRole('heading', { name: 'The Johnson, Garcia & Nguyen Family' })
    ).toBeInTheDocument()
  })

  // ⚠️ A hyphenated surname is ONE name -- 72 of 2026's 680 distinct rostered
  // children carry one. Never "The Garcia & Lopez Family".
  it('keeps a hyphenated surname whole', () => {
    render(
      <FamilyDetailsPanel
        party={party({
          children: [
            {
              person_cm_id: 9001,
              display_name: 'Noah Garcia-Lopez',
              last_name: 'Garcia-Lopez',
              age: 8,
            },
          ],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByRole('heading', { name: 'The Garcia-Lopez Family' })).toBeInTheDocument()
  })

  // `family_camp_adults.last_name` is empty on every 2026 row, so the adults
  // can never supply the surname -- when the children cannot either, this
  // falls back to the attending-adult label rather than to "The Family".
  it('falls back to the attending adults when no child carries a surname', () => {
    render(
      <FamilyDetailsPanel
        party={party({
          children: [{ person_cm_id: 9001, display_name: 'Noah', last_name: '', age: 8 }],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(
      screen.getByRole('heading', { name: 'Emma Johnson · David Johnson' })
    ).toBeInTheDocument()
  })

  it('falls back to display_name when no adult and no child has a name on file', () => {
    render(
      <FamilyDetailsPanel
        party={party({ display_name: 'Household 4021', adults: [], children: [] })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByRole('heading', { name: 'Household 4021' })).toBeInTheDocument()
  })

  // The owner's ruling in full: the headline stops naming the adults, and the
  // adults are STILL THERE, in the members list with the kids. This is the
  // half that would go quiet if the headline change were made alone.
  it('still lists the adults in the Party section once the headline stops naming them', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    const adults = screen.getByTestId('family-panel-adults')
    expect(adults).toHaveTextContent('Emma Johnson')
    expect(adults).toHaveTextContent('David Johnson')
    expect(screen.getByRole('heading', { name: 'The Johnson Family' })).toBeInTheDocument()
  })

  it('keeps its own display_name for a person-grain party -- it IS the identity', () => {
    render(
      <FamilyDetailsPanel
        party={party({
          grain: 'person',
          household_cm_id: 0,
          person_cm_id: 5001,
          display_name: 'Priya Patel',
          adults: [{ adult_number: 1, display_name: 'Priya Patel' }],
          children: [],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByRole('heading', { name: 'Priya Patel' })).toBeInTheDocument()
  })

  it('lists adults with their relationships', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
    expect(screen.getByText('Mother')).toBeInTheDocument()
    expect(screen.getByText('David Johnson')).toBeInTheDocument()
  })

  it('drops a blank adult slot from the Party list -- family_camp_adults is not a fixed five', () => {
    // Scan finding on kindred#2084: a slot with no name on file rendered as
    // an empty <li>, the same bug the identity label and the roster row's
    // members line already had to guard against.
    render(
      <FamilyDetailsPanel
        party={party({
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: '', relationship: '' },
          ],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    // Scoped to the adults <ul> specifically -- the panel has other
    // `role="list"` blocks (AccessibilityFlagList) whose item count isn't
    // this test's concern, and the header now also reads "Emma Johnson"
    // (kindred#2084), so a plain `getByText` would be ambiguous.
    expect(screen.getByTestId('family-panel-adults').querySelectorAll('li')).toHaveLength(1)
  })

  it('lists children with ages and grades', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText('Noah Johnson')).toBeInTheDocument()
    expect(screen.getByText(/Age 8/)).toBeInTheDocument()
  })

  it('renders age in CampMinder yy.mm format through displayCampMinderAge', () => {
    // kindred#2088: the panel printed `String(child.age)` verbatim. Both
    // fractional and whole ages must go through the shared helper summer
    // already uses -- two-digit months, no leading-zero years.
    render(
      <FamilyDetailsPanel
        party={party({
          children: [
            { person_cm_id: 9001, display_name: 'Noah Johnson', age: 1.5, grade: 0 },
            { person_cm_id: 9002, display_name: 'Ava Johnson', age: 0.06, grade: 0 },
          ],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('Age 1.50')).toBeInTheDocument()
    expect(screen.getByText('Age 0.06')).toBeInTheDocument()
  })

  it('reports party size, arrival and returning status', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    expect(screen.getByText(/Friday 6pm/)).toBeInTheDocument()
    expect(screen.getByText('Returning')).toBeInTheDocument()
  })

  it('marks a first-time family when is_returning is false', () => {
    render(
      <FamilyDetailsPanel party={party({ is_returning: false })} year={2026} onClose={vi.fn()} />,
      {
        wrapper,
      }
    )
    expect(screen.getByText('First-time')).toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  it('marks a first-time family when is_returning is undefined', () => {
    const p = party()
    delete p.is_returning
    render(<FamilyDetailsPanel party={p as RosterPartyRow} year={2026} onClose={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText('First-time')).toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  // Adult weekend guests are `grain: 'person'`. `_build_person_parties` never
  // sets `is_returning` server-side, so it always arrives as the Pydantic
  // default `false` -- untracked, not "no". Neither badge should claim to
  // know a status the API never computed for this grain.
  it('stays silent on returning status for an adult weekend guest (person grain)', () => {
    render(
      <FamilyDetailsPanel
        party={party({
          grain: 'person',
          household_cm_id: 0,
          person_cm_id: 5001,
          is_returning: false,
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.queryByText('First-time')).not.toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })
})

describe('FamilyDetailsPanel — current placement', () => {
  it('names the unit and its area', () => {
    render(<FamilyDetailsPanel party={party()} unit={unit()} year={2026} onClose={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText('Cedar 1')).toBeInTheDocument()
    expect(screen.getByText('Cedar Grove')).toBeInTheDocument()
  })

  it('says a merged slot is a merge', () => {
    render(
      <FamilyDetailsPanel
        party={party({ unit_code: '', unit_name: 'Cedar 3 + Cedar 4', is_merged_slot: true })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('Cedar 3 + Cedar 4')).toBeInTheDocument()
    const merged = screen.getByRole('button', { name: 'Merged' })
    expect(merged).not.toHaveAttribute('title')
    fireEvent.focus(merged)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Two rooms combined into one slot')
  })

  it('closes only the tooltip on Escape, never the panel underneath it', () => {
    // kindred#2177 x kindred#2073. The panel's own Escape handler sits on
    // `document`; the tooltip's sits on its trigger, so it stops the event by
    // propagation before the panel ever sees it. `ui/modalStack` exists
    // because two `document` listeners cannot do that to each other.
    render(
      <FamilyDetailsPanel
        party={party({ unit_code: '', unit_name: 'Cedar 3 + Cedar 4', is_merged_slot: true })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    const merged = screen.getByRole('button', { name: 'Merged' })
    fireEvent.click(merged)
    expect(screen.getByRole('tooltip')).toBeInTheDocument()

    fireEvent.keyDown(merged, { key: 'Escape' })

    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()
    const panel = screen.getByTestId('family-details-panel')
    expect(panel).not.toHaveClass('animate-slide-out-right')
    expect(panel).toHaveClass('animate-slide-in-right')
  })

  it('says an unplaced party has no cabin yet', () => {
    render(
      <FamilyDetailsPanel
        party={party({ unit_code: '', unit_name: '' })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('No cabin yet')).toBeInTheDocument()
  })

  it('reports the fit verdict', () => {
    render(
      <FamilyDetailsPanel
        party={party({ flags: { needs_power: true } })}
        unit={unit()}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('Fit not verified')).toBeInTheDocument()
  })
})

describe('FamilyDetailsPanel — interaction contract', () => {
  it('marks itself so the board click-outside handler can spare it', () => {
    const { container } = render(
      <FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />,
      { wrapper }
    )
    expect(container.querySelector('[data-panel="family-details"]')).toBeInTheDocument()
  })

  it('lays a click-outside catcher over the page', () => {
    const { container } = render(
      <FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />,
      { wrapper }
    )
    expect(container.querySelector('.pointer-events-none.fixed.inset-0')).toBeInTheDocument()
  })

  it('closes on the close button', async () => {
    const onClose = vi.fn()
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={onClose} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /close panel/i }))
    // The slide-out animation runs first; jsdom fires animationend only when
    // driven, so the close is requested rather than immediate.
    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
  })

  it('runs the exit animation when the parent requests a close', () => {
    render(
      <FamilyDetailsPanel party={party()} year={2026} requestClose={true} onClose={vi.fn()} />,
      { wrapper }
    )
    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
  })

  it('calls onClose when the exit animation ends, but not the entrance animation', () => {
    // Break `handleAnimationEnd` and the panel goes on `animate-slide-out-right`
    // forever — the class-flip alone (the two tests above) does not catch that,
    // since `onClose` is never asserted. This is the one test in the file that
    // actually pins the close all the way through.
    const onClose = vi.fn()
    const { rerender } = render(
      <FamilyDetailsPanel party={party()} year={2026} onClose={onClose} />,
      { wrapper }
    )

    // Entering: the same handler is attached, but `exiting` is false and the
    // guard must swallow it.
    fireAnimationEnd(screen.getByTestId('family-details-panel'))
    expect(onClose).not.toHaveBeenCalled()

    // Same route as 'runs the exit animation when the parent requests a
    // close': `requestClose` flips `exiting` true and the class to
    // `animate-slide-out-right`.
    rerender(
      <FamilyDetailsPanel party={party()} year={2026} requestClose={true} onClose={onClose} />
    )
    fireAnimationEnd(screen.getByTestId('family-details-panel'))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('lets a family selected mid-close arrive open, not mid-exit', async () => {
    // The board and map stopped keying this panel per party, so it updates in
    // place instead of remounting (`LodgingBoard.test.tsx`, "does not remount
    // the panel when a second family is opened"). `isClosing` is the one thing
    // that remount used to reset for free: close the Johnsons, click the
    // Garcias inside the 300ms slide-out, and without a reset the Garcias
    // inherit the Johnsons' exit and the panel closes on them.
    //
    // `requestClose` needs no equivalent — the parent's `openParty` already
    // sets it false. This is only about the panel's own state.
    const onClose = vi.fn()
    const { rerender } = render(
      <FamilyDetailsPanel party={party()} year={2026} onClose={onClose} />,
      { wrapper }
    )

    await userEvent.click(screen.getByRole('button', { name: /close panel/i }))
    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')

    rerender(
      <FamilyDetailsPanel
        party={party({ household_cm_id: 102, display_name: 'Garcia' })}
        year={2026}
        onClose={onClose}
      />
    )

    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-in-right')
    // The animation started before the switch still ends; it must not be read
    // as this family's exit.
    fireAnimationEnd(screen.getByTestId('family-details-panel'))
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('FamilyDetailsPanel — the headcount agrees with the printed adult/child list (kindred#2152)', () => {
  /*
   * `party.party_size` became a BED count under kindred#1925/#2046: the
   * server drops blank/placeholder adult slots from it AND discounts a child
   * under 18 months at session start, so it can legitimately disagree with
   * the names this panel actually prints in the Party section below. The
   * panel's own headcount must agree with ITS list, not the raw report --
   * that's the same fix FamilyCard's badge got, applied to the third copy.
   */
  it('counts the printed adults and children rather than reading party_size', () => {
    render(<FamilyDetailsPanel party={party({ party_size: 0 })} year={2026} onClose={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText('3 people')).toBeInTheDocument()
  })

  it('shows the printed headcount even when the reported bed count is lower (the infant-discount case)', () => {
    // party_size: 2 is the bed count kindred#2046 would report for this
    // fixture's 2 adults + 1 child if the child were an infant -- the panel
    // must still show 3, agreeing with the 2 adults + 1 child list beneath
    // it, not the server's bed figure.
    render(<FamilyDetailsPanel party={party({ party_size: 2 })} year={2026} onClose={vi.fn()} />, {
      wrapper,
    })
    expect(screen.getByText('3 people')).toBeInTheDocument()
    expect(screen.queryByText('2 people')).not.toBeInTheDocument()
  })

  it('does not count a placeholder adult slot', () => {
    render(
      <FamilyDetailsPanel
        party={party({
          party_size: 0,
          adults: [
            { adult_number: 1, display_name: 'Emma Johnson', relationship: 'Mother' },
            { adult_number: 2, display_name: 'NA', relationship: '' },
          ],
        })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )
    expect(screen.getByText('2 people')).toBeInTheDocument()
  })
})

/**
 * kindred#2073. The household journey is the family-camp sibling of the
 * camper journey, and the panel is where a household is looked at one at a
 * time — the same grain argument that lets `MedicalNarrative` fetch on mount
 * here and never on a roster row.
 */
describe('the household journey', () => {
  it('renders the year-over-year record for a household', () => {
    journeyResult.value = {
      data: {
        household_cm_id: 101,
        years: [
          {
            year: 2025,
            housing: 'placed',
            cabin_name: 'Cedar Lodge - Room 2',
            enrollment: 'enrolled',
            adults: [],
            children: [],
          },
        ],
      },
      isLoading: false,
      error: null,
    }

    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })

    expect(screen.getByTestId('household-journey')).toBeInTheDocument()
    expect(screen.getByText('Cedar Lodge - Room 2')).toBeInTheDocument()
  })

  it('looks the journey up by the household CampMinder id', () => {
    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })

    expect(journeyCalls).toContain(101)
  })

  it('never fetches one for an adult weekend guest, who has no household', () => {
    render(
      <FamilyDetailsPanel
        party={party({ grain: 'person', household_cm_id: 0, person_cm_id: 5001 })}
        year={2026}
        onClose={vi.fn()}
      />,
      { wrapper }
    )

    expect(screen.queryByTestId('household-journey')).not.toBeInTheDocument()
    expect(journeyCalls).toEqual([null])
  })
})

/**
 * kindred#2073 made this panel the first one in the repo to HOST a `ui/Modal`,
 * and that is a new interaction, not just a new component.
 *
 * Both the panel and `ui/Modal` register their Escape handler on `document`,
 * so neither can stand the other down by propagation — the modal's `onClose`
 * and the panel's own would both run on a single press, and the family the
 * staff member was reading would disappear behind the dialog they were only
 * trying to dismiss. The panel yields while a modal is open.
 */
describe('Escape with a dialog open on top', () => {
  function openTheMembersModal() {
    journeyResult.value = {
      data: {
        household_cm_id: 101,
        years: [
          {
            year: 2025,
            housing: 'placed',
            cabin_name: 'Cedar Lodge - Room 2',
            enrollment: 'enrolled',
            adults: [{ adult_number: 1, display_name: 'Olivia Johnson', relationship: 'Parent' }],
            children: [
              {
                person_cm_id: 9001,
                display_name: 'Noah Johnson',
                last_name: 'Johnson',
                age: 8,
                grade: 3,
              },
            ],
          },
        ],
      },
      isLoading: false,
      error: null,
    }

    render(<FamilyDetailsPanel party={party()} year={2026} onClose={vi.fn()} />, { wrapper })
    fireEvent.click(screen.getByRole('button', { name: 'See members for 2025' }))
    expect(screen.getByTestId('modal-content')).toBeInTheDocument()
  }

  it('dismisses the modal without also dismissing the panel', () => {
    openTheMembersModal()

    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.queryByTestId('modal-content')).not.toBeInTheDocument()
    // `animate-slide-out-right` is the panel committing to its exit; the
    // `onClose` prop only fires once that animation ends, so asserting on the
    // prop alone would pass while the panel visibly slid away.
    const panel = screen.getByTestId('family-details-panel')
    expect(panel).not.toHaveClass('animate-slide-out-right')
    expect(panel).toHaveClass('animate-slide-in-right')
  })

  it('still closes the panel on Escape once the modal is gone', () => {
    openTheMembersModal()

    fireEvent.keyDown(document, { key: 'Escape' })
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
  })
})
