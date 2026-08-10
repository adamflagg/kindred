/**
 * The roster table renders both grains: a household party (family camp,
 * where CampMinder enrols only the children) and a person party (adult
 * weekends, where individuals enrol directly).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RosterPartyRow } from '../../types/lodging'
import { HouseholdRosterTable } from './HouseholdRosterTable'

vi.mock('../../hooks/usePermissions', () => ({
  usePermissions: () => ({
    isAdmin: true,
    permissions: [],
    hasPermission: () => true,
    hasAnyPermission: () => true,
  }),
}))

// `medicalFetchMode.real` toggles this file's ONE `useHouseholdMedical` mock
// between the fast canned value every other suite in this file wants and the
// REAL hook, wired through the mocked `fetchHouseholdMedical` service call
// below -- so "the actual PHI fetch" describe block near the bottom of this
// file can drive the genuine fetch path without touching the rest of this
// file's tests, which never flip it. `vi.hoisted` is required: `vi.mock`
// factories run before any other module-level code, so a plain `const`
// referenced inside one would be a use-before-initialization error.
const { medicalFetchMode, mockFetchHouseholdMedical } = vi.hoisted(() => ({
  medicalFetchMode: { real: false },
  mockFetchHouseholdMedical: vi.fn(),
}))

vi.mock('../../services/lodgingApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/lodgingApi')>()
  return {
    ...actual,
    fetchHouseholdMedical: (...args: unknown[]) =>
      (mockFetchHouseholdMedical as (...a: unknown[]) => unknown)(...args),
  }
})

vi.mock('../../hooks/useWeekendRoster', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useWeekendRoster')>()
  return {
    ...actual,
    useHouseholdMedical: (year: number, householdCmId: number | null, enabled: boolean) =>
      medicalFetchMode.real
        ? actual.useHouseholdMedical(year, householdCmId, enabled)
        : { data: undefined, isLoading: false, error: null },
  }
})

// Only reached when `medicalFetchMode.real` is true — `useHouseholdMedical`
// itself is mocked away for every other test in this file, so it never
// invokes `useApiWithAuth` for them.
vi.mock('../../hooks/useApiWithAuth', () => ({
  useApiWithAuth: () => ({ fetchWithAuth: vi.fn(), isAuthenticated: true, isAuthLoading: false }),
}))

let client: QueryClient

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
})

function party(overrides: Partial<RosterPartyRow> = {}): RosterPartyRow {
  // kindred#2084: the row's visible identity is now the attending-adult list
  // (`householdIdentity.ts`), not `display_name`. Defaulting the sole adult's
  // name to match `displayName` keeps every existing `display_name` override
  // in this file behaving as the row's on-screen label, same as before the
  // identity source changed -- callers that need a specific adult roster
  // still override `adults` explicitly, which wins over this default.
  const displayName = overrides.display_name ?? 'The Johnson Family'
  return {
    grain: 'household',
    household_cm_id: 2000001,
    person_cm_id: 0,
    display_name: displayName,
    adults: [{ adult_number: 1, display_name: displayName, relationship: 'Parent' }],
    children: [{ person_cm_id: 1000001, display_name: 'Emma Johnson', age: 9, grade: 4 }],
    party_size: 2,
    unit_code: '',
    unit_name: '',
    is_merged_slot: false,
    arrival_eta: '',
    is_returning: false,
    share: {
      preference: 'unknown',
      preference_raw: '',
      proximity: [],
      request_text: '',
      needs_resolution: false,
    },
    flags: {
      needs_private_bathroom: false,
      needs_power: false,
      needs_accommodation: false,
      accommodation_is_mandatory: false,
      has_infant: false,
    },
    ...overrides,
  }
}

describe('HouseholdRosterTable', () => {
  it('shows an empty state rather than an empty table', () => {
    // "Households" would be wrong for an adult weekend, which enrols people.
    render(<HouseholdRosterTable year={2026} parties={[]} />, { wrapper })
    expect(screen.getByText('No one is enrolled for this weekend.')).toBeInTheDocument()
    expect(screen.getByText(/once registrations sync from CampMinder/)).toBeInTheDocument()
  })

  it('groups by attention, putting parties without a cabin above settled ones', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({ display_name: 'Settled Family', unit_name: 'Ridge A' }),
          party({ display_name: 'Waiting Family', unit_name: '', household_cm_id: 2000002 }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.getByText('Needs a cabin')).toBeInTheDocument()
    expect(screen.getByText('Settled')).toBeInTheDocument()

    const names = screen.getAllByText(/Family$/).map((n) => n.textContent)
    expect(names.indexOf('Waiting Family')).toBeLessThan(names.indexOf('Settled Family'))
  })

  it('does not draw section headings when every party shares one state', () => {
    // An untouched adult weekend: heading the whole roster "Needs a cabin"
    // repeats what the banner already said.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({ display_name: 'One', unit_name: '' }),
          party({ display_name: 'Two', unit_name: '', household_cm_id: 2000002 }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.queryByText('Needs a cabin')).not.toBeInTheDocument()
  })

  it('drops the Requests column entirely when no party has a request', () => {
    // Adult weekends do not fill the share fields; a dead column is worse
    // than no column.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            grain: 'person',
            display_name: 'Olivia Chen',
            children: [],
            share: {
              preference: 'unknown',
              preference_raw: '',
              proximity: [],
              request_text: '',
              needs_resolution: false,
            },
          }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.queryByText('Requests')).not.toBeInTheDocument()
  })

  it('keeps the Requests column when any party answered', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[party({ share: { preference: 'yes_share', proximity: ['with'] } })]}
      />,
      { wrapper }
    )
    expect(screen.getByText('Requests')).toBeInTheDocument()
  })

  it('renders adults and children counts for a household party', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            display_name: 'The Johnson Family', // stale salutation, no longer rendered
            adults: [{ adult_number: 1, display_name: 'Samuel Johnson', relationship: 'Parent' }],
          }),
        ]}
      />,
      { wrapper }
    )
    // kindred#2084: the row's identity is the attending-adult list, not
    // `display_name` -- and it duplicates the members line below for a
    // single-adult household, so this reads the identity through its own
    // testid rather than `getByText`, which would find both.
    expect(screen.getByTestId('household-row-name')).toHaveTextContent('Samuel Johnson')
    expect(screen.queryByText('The Johnson Family')).not.toBeInTheDocument()
    expect(screen.getByText('1 adult · 1 child')).toBeInTheDocument()
    expect(screen.getByText('Emma Johnson (9.00)')).toBeInTheDocument()
  })

  it('counts the PEOPLE printed, not the bed number, for an infant household', () => {
    // kindred#2152: `composition()` prints the members it renders below, so it
    // must never read `party.party_size`. Since #2046 that field is a BED
    // count -- the server discounts a child under 18 months -- so here it says
    // 2 while three people are named. Whichever way this row drifted the two
    // lines would contradict each other on screen.
    //
    // This also pins why `composition()` does NOT call `partyHeadcount`
    // despite wanting the people number: it needs the adult and child figures
    // BROKEN OUT to build the string, and `partyHeadcount` returns only their
    // sum. Collapsing it would turn "1 adult · 2 children" into "3".
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            party_size: 2,
            adults: [{ adult_number: 1, display_name: 'Olivia Chen', relationship: 'Parent' }],
            children: [
              { person_cm_id: 1000010, display_name: 'Mateo Chen', age: 6, grade: 1 },
              { person_cm_id: 1000011, display_name: 'Ivy Chen', age: 0.11, grade: 0 },
            ],
            flags: {
              needs_private_bathroom: false,
              needs_power: false,
              needs_accommodation: false,
              accommodation_is_mandatory: false,
              has_infant: true,
            },
          }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.getByText('1 adult · 2 children')).toBeInTheDocument()
    expect(screen.queryByText('1 adult · 1 child')).not.toBeInTheDocument()
    expect(screen.queryByText('3')).not.toBeInTheDocument()
  })

  it('does not count a blank adult slot -- family_camp_adults is not a fixed five', () => {
    // Scan finding on kindred#2084: `composition()` counted `party.adults`
    // raw, inflating the figure shown right beside the (now-filtered)
    // identity label.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            adults: [
              { adult_number: 1, display_name: 'Samuel Johnson', relationship: 'Parent' },
              { adult_number: 2, display_name: '', relationship: '' },
            ],
          }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.getByText('1 adult · 1 child')).toBeInTheDocument()
    expect(screen.queryByText('2 adults · 1 child')).not.toBeInTheDocument()
  })

  it('drops a blank adult slot from the members line rather than a dangling separator', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            adults: [
              { adult_number: 1, display_name: 'Samuel Johnson', relationship: 'Parent' },
              { adult_number: 2, display_name: '', relationship: '' },
            ],
          }),
        ]}
      />,
      { wrapper }
    )
    const membersLine = screen.getByTestId('household-row-members')
    expect(membersLine).toHaveTextContent('Samuel Johnson · Emma Johnson (9.00)')
    expect(membersLine.textContent).not.toMatch(/,\s*·/)
  })

  it('renders age in CampMinder yy.mm format through displayCampMinderAge', () => {
    // kindred#2088: the row printed `String(child.age)` verbatim. Both
    // fractional and whole ages must go through the shared helper summer
    // already uses -- two-digit months, no leading-zero years.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            children: [
              { person_cm_id: 1000001, display_name: 'Noah', age: 1.5, grade: 0 },
              { person_cm_id: 1000002, display_name: 'Ava', age: 0.06, grade: 0 },
            ],
          }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.getByText('Noah (1.50)')).toBeInTheDocument()
    expect(screen.getByText('Ava (0.06)')).toBeInTheDocument()
  })

  it('pluralises adults and children correctly', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            adults: [
              { adult_number: 1, display_name: 'Olivia Chen', relationship: 'Parent' },
              { adult_number: 2, display_name: 'Liam Garcia', relationship: 'Parent' },
            ],
            children: [
              { person_cm_id: 1000001, display_name: 'Olivia Chen', age: 9, grade: 4 },
              { person_cm_id: 1000003, display_name: 'Liam Garcia', age: 7, grade: 2 },
            ],
            party_size: 4,
          }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.getByText('2 adults · 2 children')).toBeInTheDocument()
  })

  it('renders a child of unknown age without a bare parenthesis', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            children: [
              { person_cm_id: 1000001, display_name: 'Emma Johnson', age: null, grade: null },
            ],
          }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.getByText('Emma Johnson')).toBeInTheDocument()
  })

  it('shows the assigned unit, or "Unassigned" when there is none', () => {
    const { rerender } = render(<HouseholdRosterTable year={2026} parties={[party()]} />, {
      wrapper,
    })
    expect(screen.getByText('Unassigned')).toBeInTheDocument()

    rerender(
      <HouseholdRosterTable
        year={2026}
        parties={[party({ unit_code: 'ridge-a', unit_name: 'Ridge A' })]}
      />
    )
    expect(screen.getByText('Ridge A')).toBeInTheDocument()
  })

  it('marks a merged slot so staff know two rooms were combined', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[party({ unit_name: 'Wawona', is_merged_slot: true })]}
      />,
      { wrapper }
    )
    // kindred#2177: the "two rooms combined" detail is on a reachable tooltip.
    const merged = screen.getByRole('button', { name: 'Merged' })
    expect(merged).not.toHaveAttribute('title')
    expect(merged).toHaveAccessibleDescription('Two rooms combined into one slot')
    fireEvent.focus(merged)
    expect(screen.getByRole('tooltip')).toHaveTextContent('Two rooms combined into one slot')
  })

  it('never nests a control inside the row button', () => {
    // kindred#2177's structural guard. The name cell IS a `<button>`, whose
    // content model forbids interactive descendants — the reason the two
    // badges inside it carry `sr-only` text while the "Merged" chip in the
    // next cell gets the real tooltip. A nested trigger would also eat the
    // row's own click.
    const { container } = render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            is_returning: true,
            is_merged_slot: true,
            share: {
              preference: 'no_share',
              preference_raw: 'No, prefer not to share',
              proximity: [],
              request_text: '',
              needs_resolution: false,
            },
          }),
        ]}
      />,
      { wrapper }
    )
    expect(container.querySelectorAll('button button')).toHaveLength(0)
  })

  it('spells out the returning and first-time badges in text, not a title', () => {
    // kindred#2177, and the one place the tooltip primitive is NOT the answer:
    // these two badges live INSIDE the row's own `<button>`, whose content
    // model is phrasing content with no interactive descendants. A focusable
    // trigger there would be invalid HTML and would swallow the row's click.
    // Real `sr-only` text instead — which is strictly more than the `title`
    // gave, since `title` on a `<span>` is not reliably announced at all.
    const { rerender } = render(
      <HouseholdRosterTable year={2026} parties={[party({ is_returning: true })]} />,
      { wrapper }
    )
    expect(screen.getByText('Returning')).not.toHaveAttribute('title')
    expect(screen.getByText('(stayed with us before)')).toBeInTheDocument()
    expect(screen.getByText('Returning').tagName).toBe('SPAN')

    rerender(<HouseholdRosterTable year={2026} parties={[party({ is_returning: false })]} />)
    expect(screen.getByText('First-time')).not.toHaveAttribute('title')
    expect(screen.getByText('(first time at camp)')).toBeInTheDocument()
  })

  it('flags a returning family', () => {
    render(<HouseholdRosterTable year={2026} parties={[party({ is_returning: true })]} />, {
      wrapper,
    })
    expect(screen.getByText('Returning')).toBeInTheDocument()
  })

  it('marks a first-time family when is_returning is false', () => {
    render(<HouseholdRosterTable year={2026} parties={[party({ is_returning: false })]} />, {
      wrapper,
    })
    expect(screen.getByText('First-time')).toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  it('marks a first-time family when is_returning is undefined', () => {
    const p = party()
    delete p.is_returning
    render(<HouseholdRosterTable year={2026} parties={[p as RosterPartyRow]} />, {
      wrapper,
    })
    expect(screen.getByText('First-time')).toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  // Adult weekends never compute `is_returning` server-side (person grain
  // takes the Pydantic `bool = False` default, unset rather than "no"), so
  // neither badge should render a claim the API never made.
  it('stays silent on returning status for an adult weekend guest (person grain)', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[party({ grain: 'person', display_name: 'Olivia Chen', is_returning: false })]}
      />,
      { wrapper }
    )
    expect(screen.queryByText('First-time')).not.toBeInTheDocument()
    expect(screen.queryByText('Returning')).not.toBeInTheDocument()
  })

  it('shows the arrival ETA when the family gave one', () => {
    render(
      <HouseholdRosterTable year={2026} parties={[party({ arrival_eta: 'Friday around 4pm' })]} />,
      {
        wrapper,
      }
    )
    expect(screen.getByText('Friday around 4pm')).toBeInTheDocument()
  })

  it('renders a person-grain party for an adult weekend', () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 1000004,
            display_name: 'Olivia Chen',
            adults: [{ adult_number: 1, display_name: 'Olivia Chen', relationship: '' }],
            children: [],
            party_size: 1,
          }),
        ]}
      />,
      { wrapper }
    )
    expect(screen.getByText('Olivia Chen')).toBeInTheDocument()
    expect(screen.getByText('1 adult')).toBeInTheDocument()
  })

  it('offers no medical reveal for a party that has no household', () => {
    // Adult weekends enrol the person directly, so `household_cm_id` is 0 and
    // there is nothing to look a narrative up by. The reveal would only ever
    // request /households/0/medical, so the row says what it knows instead.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 1000004,
            display_name: 'Olivia Chen',
            flags: {
              needs_private_bathroom: false,
              needs_power: false,
              needs_accommodation: false,
              accommodation_is_mandatory: false,
              has_infant: false,
            },
          }),
        ]}
      />,
      { wrapper }
    )
    // kindred#1889: a roster row carries chips only. The narrative — and any
    // trace that one exists — belongs to FamilyDetailsPanel, which shows one
    // household at a time. This row is one of 62 on the page.
    expect(screen.queryByRole('button', { name: /medical detail/i })).not.toBeInTheDocument()
    expect(screen.queryByText(/medical/i)).not.toBeInTheDocument()
  })

  it('keeps household and person parties with colliding ids as distinct rows', () => {
    // The two grains number independently, so a household cm_id can equal a
    // person cm_id. A key built from only one of them would collapse the rows.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({ household_cm_id: 7, person_cm_id: 0, display_name: 'The Johnson Family' }),
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 7,
            display_name: 'Olivia Chen',
            children: [],
          }),
        ]}
      />,
      { wrapper }
    )
    // kindred#2084: 'The Johnson Family' now also appears in the members
    // line for a single-adult household, so this reads each row's identity
    // through its own testid rather than `getByText`, which would find both.
    const names = screen.getAllByTestId('household-row-name').map((el) => el.textContent)
    expect(names).toEqual(['The Johnson Family', 'Olivia Chen'])
  })

  it('renders one table row per party, not collapsed into the header (kindred#2063)', () => {
    // `role="button"` on the row's own `<tr>` overrides the native `row`
    // role — `queryAllByRole('row')` had collapsed to 1 (the header alone),
    // and the four `<td>` cells lost their owning row.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({ display_name: 'Johnson Family', household_cm_id: 2000001 }),
          party({ display_name: 'Chen Family', household_cm_id: 2000002 }),
        ]}
      />,
      { wrapper }
    )
    // Header row + one row per party. Both parties share an attention
    // section here, so there is no extra section-heading row to account for.
    expect(screen.getAllByRole('row')).toHaveLength(3)
  })
})

describe('HouseholdRosterTable — the row opens FamilyDetailsPanel (kindred#1996)', () => {
  // kindred#1889 made the row chips-only and moved the medical narrative to
  // FamilyDetailsPanel — but the row it did that to carried no way back to
  // the panel at all. These pin the reachability fix, not the panel's own
  // content, which FamilyDetailsPanel.test.tsx already covers.
  it('opens the panel when a roster row is clicked', async () => {
    render(<HouseholdRosterTable year={2026} parties={[party()]} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /The Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
    expect(screen.getByTestId('family-panel-backdrop')).toBeInTheDocument()
  })

  it('opens the panel from the keyboard, not just a pointer click', async () => {
    render(<HouseholdRosterTable year={2026} parties={[party()]} />, { wrapper })
    screen.getByRole('button', { name: /The Johnson Family/ }).focus()
    await userEvent.keyboard('{Enter}')
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
  })

  it('opens the panel on Space, and stops the row from scrolling the page', () => {
    // Space's native behavior is "scroll the page a viewport" — the same key
    // that opens the panel. Without preventDefault(), a staff member tabbing
    // onto a row on the 62-row roster and pressing Space gets the panel AND
    // a full-viewport scroll.
    render(<HouseholdRosterTable year={2026} parties={[party()]} />, { wrapper })
    const row = screen.getByRole('button', { name: /The Johnson Family/ })
    row.focus()

    let keydownEvent: KeyboardEvent | undefined
    row.addEventListener('keydown', (event) => {
      keydownEvent = event
    })
    fireEvent.keyDown(row, { key: ' ' })

    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
    expect(keydownEvent?.defaultPrevented).toBe(true)
  })

  it('does not remount the panel when switching from one row to another', async () => {
    // Mirrors LodgingBoard's own guard (LodgingBoard.test.tsx): the panel is
    // unkeyed, so switching families updates it in place rather than sliding
    // it out and back in. This is also the row-specific trap the issue calls
    // out — a naive `<tr>` click handler can read as dead space to
    // `useDismissOnDeadSpace` and fight the reopen instead of switching.
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({ display_name: 'Johnson Family', household_cm_id: 2000001 }),
          party({ display_name: 'Chen Family', household_cm_id: 2000002 }),
        ]}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))
    const first = screen.getByTestId('family-details-panel')

    await userEvent.click(screen.getByRole('button', { name: /Chen Family/ }))
    const second = screen.getByTestId('family-details-panel')

    expect(second).toBe(first)
    expect(second).toHaveTextContent('Chen Family')
    expect(second).toHaveClass('animate-slide-in-right')
  })

  it('closes the panel on a dead-space click once the dismissal listener attaches', async () => {
    render(<HouseholdRosterTable year={2026} parties={[party()]} />, { wrapper })
    await userEvent.click(screen.getByRole('button', { name: /The Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-in-right')

    // `useDismissOnDeadSpace` attaches its listener a macrotask after the
    // panel opens (see its own docstring) — let it, or this would pass for
    // the wrong reason: nothing listening yet, rather than the guard working.
    await new Promise((resolve) => setTimeout(resolve, 0))
    fireEvent.click(document.body)
    expect(screen.getByTestId('family-details-panel')).toHaveClass('animate-slide-out-right')
  })
})

describe('HouseholdRosterTable — clears a stale selection (kindred#2062)', () => {
  // A weekend switch re-renders this table with a different `parties` prop
  // but never unmounts it, so the previously-open household stayed open over
  // the new weekend's roster — including its `FamilyDetailsPanel`, which
  // shows a medical narrative that no longer belongs to anyone on screen.
  it('closes the panel when the selected party is no longer in parties', async () => {
    const { rerender } = render(
      <HouseholdRosterTable
        year={2026}
        parties={[party({ display_name: 'Johnson Family', household_cm_id: 2000001 })]}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    rerender(
      <HouseholdRosterTable
        year={2026}
        parties={[party({ display_name: 'Chen Family', household_cm_id: 2000002 })]}
      />
    )
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()
  })

  // The trap: a refetch that returns the SAME parties (new array identity,
  // same content) must not close a panel out from under whoever has it open.
  it('keeps the panel open when parties refetches with the same content', async () => {
    const makeParties = () => [party({ display_name: 'Johnson Family', household_cm_id: 2000001 })]
    const { rerender } = render(<HouseholdRosterTable year={2026} parties={makeParties()} />, {
      wrapper,
    })
    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    rerender(<HouseholdRosterTable year={2026} parties={makeParties()} />)
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
  })
})

describe('HouseholdRosterTable — closes the panel all the way to the ORIGINAL parties (kindred#2137 bug 1)', () => {
  // The #2062 tests above stop at ONE rerender: B replaces A and the panel
  // closes. That passes against the broken implementation just as well as
  // the fixed one. The actual bug only shows up on a THIRD rerender that
  // returns to the roster the panel was originally opened against: without
  // clearing the stored selection, `partyKey` matches again and the panel
  // silently reopens with no click, re-issuing a real PHI fetch for a
  // household nobody asked to see.
  it('does not resurrect the panel when the party reappears (A -> B -> A)', async () => {
    const johnson = party({ display_name: 'Johnson Family', household_cm_id: 2000001 })
    const chen = party({ display_name: 'Chen Family', household_cm_id: 2000002 })
    const { rerender } = render(<HouseholdRosterTable year={2026} parties={[johnson]} />, {
      wrapper,
    })
    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    // B: Johnson drops out of the roster (a weekend switch).
    rerender(<HouseholdRosterTable year={2026} parties={[chen]} />)
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()

    // A: back to a roster that once again contains Johnson (switching back
    // to the first weekend, already cached this session). This is the bug.
    rerender(<HouseholdRosterTable year={2026} parties={[johnson]} />)
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()
  })
})

describe('HouseholdRosterTable — reflects the live party, not the one captured at click time (kindred#2137 bug 3)', () => {
  it('shows the freshly assigned cabin after an optimistic placement', async () => {
    const johnson = party({
      display_name: 'Johnson Family',
      household_cm_id: 2000001,
      unit_code: 'cedar-1',
      unit_name: 'Cedar 1',
    })
    const { rerender } = render(<HouseholdRosterTable year={2026} parties={[johnson]} />, {
      wrapper,
    })
    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toHaveTextContent('Cedar 1')

    // A drag placement elsewhere (`dragPlacement.ts`'s `applyPlacement`)
    // returns a NEW party object with a changed `unit_code`/`unit_name`, kept
    // at the same `partyKey`. The panel must show the new cabin, not the
    // object captured when the row was clicked.
    const movedJohnson = { ...johnson, unit_code: 'ridge-a', unit_name: 'Ridge A' }
    rerender(<HouseholdRosterTable year={2026} parties={[movedJohnson]} />)
    expect(screen.getByTestId('family-details-panel')).toHaveTextContent('Ridge A')
    expect(screen.getByTestId('family-details-panel')).not.toHaveTextContent('No cabin yet')
  })
})

describe('HouseholdRosterTable — clears the selection on a SESSION change (kindred#2138)', () => {
  // #2062's guard only clears `selected` when the household stops matching
  // `partyKey` — and `partyKey` carries no session dimension (partyKey.ts).
  // A household enrolled in BOTH weekends still matches after the switch, so
  // the #2062 tests above (which use a party that disappears) pass without
  // ever exercising this path. This one keeps the same household in
  // `parties` across the rerender and changes only `sessionCmId`.
  it('closes the panel on a session change even though the same household is still in parties', async () => {
    const johnsonInBothWeekends = () => [
      party({ display_name: 'Johnson Family', household_cm_id: 2000001 }),
    ]
    const { rerender } = render(
      <HouseholdRosterTable year={2026} sessionCmId={101} parties={johnsonInBothWeekends()} />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    // Same household, same partyKey — a different weekend's roster.
    rerender(
      <HouseholdRosterTable year={2026} sessionCmId={202} parties={johnsonInBothWeekends()} />
    )
    expect(screen.queryByTestId('family-details-panel')).not.toBeInTheDocument()
  })

  // The companion trap to #2062's own: a rerender that keeps the SAME
  // session must not close a panel out from under whoever has it open, even
  // when `parties` is a fresh array identity from a refetch.
  it('keeps the panel open when the session is unchanged, even across a parties refetch', async () => {
    const makeParties = () => [party({ display_name: 'Johnson Family', household_cm_id: 2000001 })]
    const { rerender } = render(
      <HouseholdRosterTable year={2026} sessionCmId={101} parties={makeParties()} />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()

    rerender(<HouseholdRosterTable year={2026} sessionCmId={101} parties={makeParties()} />)
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
  })
})

describe('HouseholdRosterTable — the actual PHI fetch (kindred#2139)', () => {
  // Every other test in this file mocks `useHouseholdMedical` to a constant,
  // so `MedicalNarrative`'s fetch -- the exact harm #2062 named -- is never
  // exercised by any assertion in the whole suite. This block flips
  // `medicalFetchMode.real` to drive the GENUINE `useHouseholdMedical` hook,
  // through the same mocked-service-plus-`useApiWithAuth` harness
  // `useWeekendRoster.test.tsx` already uses to drive its own hooks for
  // real.
  beforeEach(() => {
    medicalFetchMode.real = true
    mockFetchHouseholdMedical.mockReset().mockResolvedValue({
      household_cm_id: 2000001,
      year: 2026,
      allergy_info: 'Peanuts',
    })
  })

  afterEach(() => {
    medicalFetchMode.real = false
  })

  it('fetches the real medical narrative when the panel opens', async () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[party({ display_name: 'Johnson Family', household_cm_id: 2000001 })]}
      />,
      { wrapper }
    )
    expect(mockFetchHouseholdMedical).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: /Johnson Family/ }))

    await waitFor(() => {
      expect(mockFetchHouseholdMedical).toHaveBeenCalledWith(expect.anything(), 2026, 2000001)
    })
    expect(await screen.findByText('Peanuts')).toBeInTheDocument()
  })

  it('never fetches for a party with no household to look up', async () => {
    render(
      <HouseholdRosterTable
        year={2026}
        parties={[
          party({
            grain: 'person',
            household_cm_id: 0,
            person_cm_id: 1000004,
            display_name: 'Olivia Chen',
          }),
        ]}
      />,
      { wrapper }
    )
    await userEvent.click(screen.getByRole('button', { name: /Olivia Chen/ }))
    expect(screen.getByTestId('family-details-panel')).toBeInTheDocument()
    expect(mockFetchHouseholdMedical).not.toHaveBeenCalled()
  })
})
