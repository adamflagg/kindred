/**
 * The roster table renders both grains: a household party (family camp,
 * where CampMinder enrols only the children) and a person party (adult
 * weekends, where individuals enrol directly).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('../../hooks/useWeekendRoster', () => ({
  useHouseholdMedical: () => ({ data: undefined, isLoading: false, error: null }),
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
    expect(screen.getByText('Merged')).toBeInTheDocument()
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
